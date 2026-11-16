// 门禁：ipc.ts 里的 command 名与实参 key 必须能被 Rust 命令接住。
// Tauri 把 JS 侧 camelCase 映射成 snake_case 后按形参名取值，名字对不上不会在编译期报错，
// 只在运行时抛 “invalid args ... missing required key”（v0.2.4 目录对比即因此翻车），这里提前挡住。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const problems = []

function readRustFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...readRustFiles(path))
    else if (path.endsWith('.rs')) files.push(path)
  }
  return files
}

// 按顶层逗号切分形参，忽略 HashMap<K, V> 之类的泛型逗号。
function splitParams(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if ('<([{'.includes(ch)) depth += 1
    else if ('>)]}'.includes(ch)) depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

const injected = /^(state|window|app|webview|webview_window|self)\s*:/
const commands = new Map()
for (const file of readRustFiles(join(root, 'src-tauri/src'))) {
  const source = readFileSync(file, 'utf8')
  const fnRe = /#\[tauri::command\][\s\S]{0,200}?\bfn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->\s*[^{]+)?\{/g
  for (const match of source.matchAll(fnRe)) {
    const params = splitParams(match[2])
      .filter((param) => !injected.test(param))
      .map((param) => param.split(':')[0].trim())
    commands.set(match[1], params)
  }
}

const camelToSnake = (name) => name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
const ipcSource = readFileSync(join(root, 'src/shared/ipc.ts'), 'utf8')
const callRe = /call<[^>\n]*>\("([a-z_]+)"(?:,\s*\{([^}]*)\})?\)/g
let calls = 0
for (const match of ipcSource.matchAll(callRe)) {
  calls += 1
  const [, command, args] = match
  const params = commands.get(command)
  if (!params) {
    problems.push(`ipc.ts 调用了 Rust 侧不存在的 command：${command}`)
    continue
  }
  const keys = args
    ? args.split(',').map((part) => part.split(':')[0].trim()).filter(Boolean)
    : []
  for (const key of keys) {
    if (params.includes(key) || params.includes(camelToSnake(key))) continue
    problems.push(
      `${command}: ipc.ts 传入 "${key}"，Rust 形参只有 [${params.join(', ')}]` +
        '（camelCase 会映射成 snake_case，请两侧改名对齐）',
    )
  }
}

if (calls === 0) problems.push('未解析到任何 ipc 调用，检查 src/shared/ipc.ts 是否被改动')
if (problems.length > 0) {
  console.error('✗ IPC 契约检查失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`✓ IPC 契约：${calls} 个 command 的实参 key 与 Rust 形参一致`)
