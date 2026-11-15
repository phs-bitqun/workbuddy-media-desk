// 静态检查：不引第三方工具，用 Node 自己守规则。CI 每次都会跑。
//
// 为什么不用 ESLint：这个包刻意保持零依赖，装 ESLint 要带一整套工具链和
// package.json + node_modules，而它能抓的问题对这个小代码库收益有限。
// 这里覆盖的是真正会出事的几类：语法错误、坏掉的 import 路径、
// 清单里指向不存在的文件、行尾/换行/编码污染、误提交的密钥。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['.git', 'node_modules'])
const TEXT_EXT = new Set(['.mjs', '.js', '.css', '.html', '.md', '.json', '.yml', '.sh', '.txt'])

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else out.push(full)
  }
  return out
}

const allFiles = await walk(ROOT)
const textFiles = allFiles.filter(f => TEXT_EXT.has(extname(f)))
const rel = f => f.slice(ROOT.length + 1)

test('每个 JS 文件语法都能过（node --check）', async () => {
  const jsFiles = allFiles.filter(f => ['.mjs', '.js'].includes(extname(f)))
  assert.ok(jsFiles.length >= 10, `只找到 ${jsFiles.length} 个 JS 文件，路径可能不对`)
  const bad = []
  await Promise.all(jsFiles.map(async (file) => {
    try {
      await run(process.execPath, ['--check', file])
    } catch (err) {
      bad.push(`${rel(file)}\n${err.stderr ?? err.message}`)
    }
  }))
  assert.deepEqual(bad, [])
})

test('相对的 import 路径都指向真实存在的文件', async () => {
  const bad = []
  for (const file of allFiles.filter(f => extname(f) === '.mjs')) {
    const src = await readFile(file, 'utf8')
    for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]/gm)) {
      const target = resolve(dirname(file), m[1])
      try {
        await stat(target)
      } catch {
        bad.push(`${rel(file)} → ${m[1]}`)
      }
    }
    for (const m of src.matchAll(/^\s*import\s*['"](\.[^'"]+)['"]/gm)) {
      const target = resolve(dirname(file), m[1])
      try {
        await stat(target)
      } catch {
        bad.push(`${rel(file)} → ${m[1]}`)
      }
    }
  }
  assert.deepEqual(bad, [], `引用不存在的文件：${bad.join(', ')}`)
})

test('plugin.json 里声明的路径都存在', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, '.codebuddy-plugin', 'plugin.json'), 'utf8'))
  const declared = [
    ...(manifest.agents ?? []).map(p => ['agents', p]),
    ...(manifest.skills ?? []).map(p => ['skills', p]),
    ...(manifest.avatar ? [['avatar', manifest.avatar]] : []),
  ]
  assert.ok(declared.length >= 3, '清单里声明的条目太少，检查一下 plugin.json')
  const missing = []
  for (const [kind, p] of declared) {
    try {
      await stat(join(ROOT, p.replace(/^\.\//, '')))
    } catch {
      missing.push(`${kind}: ${p}`)
    }
  }
  assert.deepEqual(missing, [])
  assert.equal(manifest.name, 'workbuddy-media-desk')
  assert.equal(manifest.plugin, manifest.name, 'plugin 字段应与 name 一致，否则安装目录对不上')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
})

test('介绍页引用的本地图片都在 docs/ 里', async () => {
  const html = await readFile(join(ROOT, 'docs', 'index.html'), 'utf8')
  const srcs = [...html.matchAll(/<img[^>]+src="([^"#]+)"/g)].map(m => m[1])
  assert.ok(srcs.length >= 3, `只找到 ${srcs.length} 张图`)
  const missing = []
  for (const src of srcs) {
    if (/^https?:/.test(src)) continue
    try {
      await stat(join(ROOT, 'docs', src))
    } catch {
      missing.push(src)
    }
  }
  assert.deepEqual(missing, [])
})

test('文档里的相对链接都能解析', async () => {
  const bad = []
  for (const file of textFiles.filter(f => extname(f) === '.md')) {
    const src = await readFile(file, 'utf8')
    for (const m of src.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link = m[1]
      if (/^(https?:|mailto:|#)/.test(link)) continue
      try {
        await stat(resolve(dirname(file), link.split('#')[0]))
      } catch {
        bad.push(`${rel(file)} → ${link}`)
      }
    }
  }
  assert.deepEqual(bad, [], `断链：${bad.join(', ')}`)
})

test('文本文件没有 CRLF、BOM、行尾空格、制表符，且以换行结尾', async () => {
  const bad = []
  for (const file of textFiles) {
    const raw = await readFile(file)
    if (raw.length === 0) continue
    if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) bad.push(`${rel(file)}：带 BOM`)
    if (raw.includes(Buffer.from('\r\n'))) bad.push(`${rel(file)}：CRLF 换行`)
    if (raw[raw.length - 1] !== 0x0a) bad.push(`${rel(file)}：结尾缺换行`)
    const text = raw.toString('utf8')
    text.split('\n').forEach((line, i) => {
      if (line !== line.trimEnd()) bad.push(`${rel(file)}:${i + 1}：行尾空格`)
      if (line.includes('\t')) bad.push(`${rel(file)}:${i + 1}：制表符`)
    })
  }
  assert.deepEqual(bad, [], bad.slice(0, 10).join('\n'))
})

test('库代码不直接用 console，输出统一走 CLI 的 say/json', async () => {
  const bad = []
  for (const file of allFiles.filter(f => f.includes('media-desk/scripts/lib'))) {
    if (extname(file) !== '.mjs') continue
    const src = await readFile(file, 'utf8')
    if (/console\.log\(/.test(src)) bad.push(rel(file))
  }
  assert.deepEqual(bad, [], `这些文件里出现了 console.log：${bad.join(', ')}`)
})

test('没有把密钥或私钥提交进来', async () => {
  const patterns = [
    ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/],
    ['OpenAI 风格 key', /sk-[A-Za-z0-9]{20,}/],
    ['AWS key', /AKIA[0-9A-Z]{16}/],
    ['私钥', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ]
  const hits = []
  for (const file of textFiles) {
    const text = await readFile(file, 'utf8')
    for (const [label, re] of patterns) {
      if (re.test(text)) hits.push(`${rel(file)}：疑似${label}`)
    }
  }
  assert.deepEqual(hits, [])
})

test('安装脚本是可执行的', async () => {
  const info = await stat(join(ROOT, 'install.sh'))
  if (process.platform === 'win32') return // Windows 上不看 mode
  assert.ok(info.mode & 0o100, 'install.sh 丢了可执行位（chmod +x）')
})
