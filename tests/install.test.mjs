// 安装脚本：绝不删除用户已有目录。审查报告 P1 的回归测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INSTALL = join(ROOT, 'install.sh')

function install({ home, src, env = {} }) {
  return run('bash', [INSTALL], {
    env: { ...process.env, HOME: home, MEDIA_DESK_REPO: ROOT, ...(src ? { MEDIA_DESK_SRC: src } : {}), ...env },
    maxBuffer: 8 * 1024 * 1024,
  }).then(
    ({ stdout, stderr }) => ({ code: 0, out: `${stdout}${stderr}` }),
    err => ({ code: err.code ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }),
  )
}

test('目标是非 Git 目录：拒绝执行，且一个文件都不删', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-inst-'))
  const src = join(home, 'my-src')
  await mkdir(src, { recursive: true })
  await writeFile(join(src, 'important.txt'), '别删我')

  const { code, out } = await install({ home, src })
  assert.notEqual(code, 0, '应当以非零退出')
  assert.match(out, /不是 Git 仓库/)
  assert.match(out, /没有删它/)
  assert.equal(await readFile(join(src, 'important.txt'), 'utf8'), '别删我', '用户文件被删了')
})

test('目标是别的 Git 仓库：拒绝，仓库保持原样', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-inst-'))
  const src = join(home, 'other')
  await mkdir(src, { recursive: true })
  await run('git', ['init', '-q', src])
  await run('git', ['-C', src, 'commit', '-q', '--allow-empty', '-m', 'init'])

  const { code, out } = await install({ home, src })
  assert.notEqual(code, 0)
  assert.match(out, /origin 不是这个项目/)
  assert.ok(await stat(join(src, '.git')), '别人的仓库被清掉了')
})

test('MEDIA_DESK_SRC 指向 HOME 或根目录时直接拒绝', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-inst-'))
  for (const src of [home, '/']) {
    const { code, out } = await install({ home, src })
    assert.notEqual(code, 0, `${src} 应该被拒绝`)
    assert.match(out, /不该动的目录/)
  }
})

test('全新安装：克隆、挂软链、自检通过，无临时目录残留', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-inst-'))
  const { code, out } = await install({ home })
  assert.equal(code, 0, out)
  assert.match(out, /已挂载/)
  assert.match(out, /内置风格预设 15/)

  const link = join(home, '.workbuddy', 'skills', 'media-desk')
  const st = await stat(link)
  assert.ok(st.isSymbolicLink() || st.isDirectory())
  assert.ok(await stat(join(link, 'SKILL.md')))

  const { readdir } = await import('node:fs/promises')
  const parent = await readdir(join(home, '.workbuddy'))
  assert.equal(parent.some(n => n.includes('.clone-')), false, `残留了临时目录：${parent.join(',')}`)
})

test('重复执行走更新分支，不破坏已装内容', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-inst-'))
  const first = await install({ home })
  assert.equal(first.code, 0, first.out)
  const second = await install({ home })
  assert.equal(second.code, 0, second.out)
  assert.match(second.out, /已有源码/)
  assert.ok(await stat(join(home, '.workbuddy', 'skills', 'media-desk', 'SKILL.md')))
})

test('目标是已有软链时能覆盖（不算用户数据）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'desk-inst-'))
  const link = join(home, '.workbuddy', 'skills', 'media-desk')
  await mkdir(dirname(link), { recursive: true })
  const stale = join(home, 'stale')
  await mkdir(stale, { recursive: true })
  await symlink(stale, link)

  const { code, out } = await install({ home })
  assert.equal(code, 0, out)
  assert.equal((await readFile(join(link, 'SKILL.md'), 'utf8')).length > 0, true)
})
