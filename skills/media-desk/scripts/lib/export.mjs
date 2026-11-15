// 成稿导出：把一篇成稿存成一个文件夹。CLI 和本地服务共用。
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { draftFormat } from './style.mjs'

/** 把标题变成能当文件夹名的字符串。 */
export function safeName(title) {
  return String(title || '成稿').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || '成稿'
}

export function defaultExportDir(title) {
  return join(homedir(), 'Documents', '自媒体工作台', safeName(title))
}

/**
 * 写出正文、分镜脚本和全部图片。
 * @param {{root: string}} store - 数据根目录（图片在 root/files 下）。
 * @param {object} item - 条目，取 production。
 * @param {{dir?: string}} [options]
 * @returns {Promise<{dir: string, files: string[]}>}
 */
export async function exportProduction(store, item, { dir } = {}) {
  const p = item.production
  if (!p) throw new Error('这条还没有成稿')
  const outDir = dir ? resolve(dir) : defaultExportDir(p.title)
  await mkdir(outDir, { recursive: true })
  const written = []

  const format = draftFormat(p.format)
  const articleName = format === 'article' ? '文章.md' : '口播脚本.md'
  if (p.article) {
    await writeFile(join(outDir, articleName), `# ${p.title}\n\n${p.article}\n`, 'utf8')
    written.push(articleName)
  }
  if (p.shots?.length) {
    const lines = [`# ${p.title} · 分镜脚本`, '', `封面大字：${p.coverText}`, '']
    lines.push('| # | 景别 | 画面 | 口播 | 秒 |', '| --- | --- | --- | --- | --- |')
    for (const s of p.shots) lines.push(`| ${s.no} | ${s.shot} | ${s.visual || ''} | ${s.voice || ''} | ${s.seconds} |`)
    await writeFile(join(outDir, '分镜脚本.md'), `${lines.join('\n')}\n`, 'utf8')
    written.push('分镜脚本.md')
  }

  const copy = async (asset, name) => {
    if (!asset?.src) return
    const from = join(store.root, asset.src)
    if (!existsSync(from)) return
    const target = `${name}${extname(from)}`
    await copyFile(from, join(outDir, target))
    written.push(target)
  }
  await copy(p.cover, '视频封面')
  for (const [i, image] of (p.images ?? []).entries()) await copy(image, `配图${i + 1}`)
  for (const shot of p.shots ?? []) await copy(shot, `分镜${shot.no}`)

  return { dir: outDir, files: written }
}
