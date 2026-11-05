// 版本号统一入口：一条命令写完所有声明，或只校验它们是否一致。
//
//   node scripts/version.mjs 0.2.0      写入
//   node scripts/version.mjs --check    校验，不一致时 exit 1（已挂进 npm run check）
//
// 声明点各有各的消费者，漏一处不会报错、只会读到一个不同的版本：
//   Cargo.toml [workspace.package]  所有 Rust crate 继承它；界面「关于」与版本检查用
//                                   env!("CARGO_PKG_VERSION")，即编译期取这里的值
//   Cargo.lock                      cargo 依 Cargo.toml 生成的成员版本
//   src-tauri/tauri.conf.json       安装包文件名与 exe 的 FileVersion/ProductVersion
//   package.json / package-lock.json  npm 元数据
// 打 tag 时 tag 必须是 v<version>：release.yml 构建前交叉核对三处声明，不一致直接失败。
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const MEMBERS = [
  'fixture-gen',
  'git-core',
  'git-read',
  'git-write',
  'graph-layout',
  'refresh',
  'test-support',
  'gitdock-app',
]

const read = (file) => readFileSync(resolve(ROOT, file), 'utf8')

function count(values) {
  const map = {}
  for (const value of values) map[value ?? '<缺失>'] = (map[value ?? '<缺失>'] ?? 0) + 1
  return map
}

/** 在 [section] 段内替换第一个 `version = "…"`，不碰 [workspace.dependencies] 里的内联 version。 */
function inSection(text, section, body) {
  const start = text.indexOf(`[${section}]`)
  if (start < 0) throw new Error(`缺少 [${section}] 段`)
  return { head: text.slice(0, start), tail: body(text.slice(start)) }
}

function readToml(text, section) {
  const start = text.indexOf(`[${section}]`)
  if (start < 0) return count([undefined])
  return count([text.slice(start).match(/^version\s*=\s*"([^"]+)"/m)?.[1]])
}

function writeToml(text, section, version) {
  const { head, tail } = inSection(text, section, (body) => {
    if (!/^version\s*=\s*"[^"]+"/m.test(body)) throw new Error(`[${section}] 段内没有 version`)
    return body.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)
  })
  return head + tail
}

/**
 * 只替换前 `times` 个匹配：这些文件的根级 version 排在依赖表之前，
 * 后面的 `"version"` 是第三方包的版本，不该跟着我们的版本号走。
 */
function writeJson(text, version, times = 1) {
  let seen = 0
  const out = text.replace(/("version"\s*:\s*")[^"]+(")/g, (full, head, tail) =>
    ++seen <= times ? `${head}${version}${tail}` : full,
  )
  if (seen < times) throw new Error(`只找到 ${seen} 处 "version"，期望 ${times} 处`)
  return out
}

/** Cargo.lock 按成员名替换，避免命中同名第三方 crate 或依赖列表里的字符串。 */
function readLock(text) {
  const versions = []
  for (const block of text.split('[[package]]').slice(1)) {
    const name = block.match(/^name = "([^"]+)"/m)?.[1]
    if (name && MEMBERS.includes(name)) {
      versions.push(block.match(/^version = "([^"]+)"/m)?.[1])
    }
  }
  return count(versions)
}

function writeLock(text, version) {
  const pattern = new RegExp(`(name = "(?:${MEMBERS.join('|')})"\\r?\\nversion = )"[^"]+"`, 'g')
  let seen = 0
  const out = text.replace(pattern, (full, head) => {
    seen += 1
    return `${head}"${version}"`
  })
  if (seen !== MEMBERS.length) {
    throw new Error(`Cargo.lock 里改了 ${seen} 个成员，期望 ${MEMBERS.length} 个`)
  }
  return out
}

const SITES = [
  {
    file: 'Cargo.toml',
    label: 'Cargo.toml [workspace.package]',
    read: (text) => readToml(text, 'workspace.package'),
    write: (text, version) => writeToml(text, 'workspace.package', version),
  },
  {
    file: 'Cargo.lock',
    label: 'Cargo.lock（workspace 成员）',
    read: readLock,
    write: writeLock,
  },
  {
    file: 'package.json',
    label: 'package.json',
    read: (text) => count([JSON.parse(text).version]),
    write: (text, version) => writeJson(text, version),
  },
  {
    file: 'package-lock.json',
    label: 'package-lock.json（根 + packages[""]）',
    read: (text) => {
      const json = JSON.parse(text)
      return count([json.version, json.packages?.['']?.version])
    },
    write: (text, version) => writeJson(text, version, 2),
  },
  {
    file: 'src-tauri/tauri.conf.json',
    label: 'src-tauri/tauri.conf.json',
    read: (text) => count([JSON.parse(text).version]),
    write: (text, version) => writeJson(text, version),
  },
]

function collect() {
  return SITES.map((site) => ({ label: site.label, versions: site.read(read(site.file)) }))
}

function values(found) {
  const set = new Set()
  for (const { versions } of found) for (const value of Object.keys(versions)) set.add(value)
  return [...set]
}

// 标签里有中文，padEnd 按 UTF-16 长度算会导致列错位，这里按显示宽度补空格。
const displayWidth = (text) =>
  [...text].reduce((sum, ch) => sum + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uff00-\uff60]/.test(ch) ? 2 : 1), 0)

function report(found) {
  for (const { label, versions } of found) {
    const text = Object.entries(versions)
      .map(([value, n]) => `${value}${n > 1 ? ` ×${n}` : ''}`)
      .join(', ')
    // 标签里有中文，padEnd 按 UTF-16 长度算会错位，这里按显示宽度补空格。
    const pad = Math.max(2, 40 - displayWidth(label))
    console.log(`  ${label}${' '.repeat(pad)}${text}`)
  }
}

const argv = process.argv.slice(2)

if (argv.includes('--check')) {
  const found = collect()
  console.log('版本号声明：')
  report(found)
  const all = values(found)
  if (all.length !== 1) {
    console.error(`\n✗ 版本号不一致：${all.join(' / ')}`)
    console.error('  用一条命令写齐：node scripts/version.mjs <版本>')
    process.exit(1)
  }
  console.log(`\n✓ 全部为 ${all[0]}`)
  process.exit(0)
}

const [target] = argv
if (!target) {
  console.error('用法：node scripts/version.mjs <semver>  |  node scripts/version.mjs --check')
  process.exit(1)
}
if (!SEMVER.test(target)) {
  console.error(`✗ '${target}' 不是合法 semver（示例：0.1.1、1.0.0-rc.1）`)
  process.exit(1)
}

console.log('改动前：')
report(collect())
console.log(`\n写入 ${target}：`)

// 全部先在内存里改好并回读校验，再一次性落盘：任一文件没命中就整个中止，
// 不留“改了一半”的工作区。
const staged = SITES.map((site) => {
  const original = read(site.file)
  const updated = site.write(original, target)
  const after = Object.keys(site.read(updated))
  if (after.length !== 1 || after[0] !== target) {
    throw new Error(`${site.file} 写入后回读为 ${after.join('/')}，已中止且未落盘`)
  }
  return { file: site.file, original, updated }
})

for (const { file, original, updated } of staged) {
  if (original === updated) {
    console.log(`  = ${file}（已是 ${target}）`)
    continue
  }
  writeFileSync(resolve(ROOT, file), updated)
  console.log(`  ✓ ${file}`)
}

const final = values(collect())
if (final.length !== 1 || final[0] !== target) {
  console.error(`\n✗ 落盘后仍不一致：${final.join(' / ')}`)
  process.exit(1)
}
console.log(`\n✓ 五处声明统一为 ${target}（发版 tag 用 v${target}）`)
