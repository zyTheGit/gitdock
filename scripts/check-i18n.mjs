// i18n 完整性门禁：资源同构、使用 key 存在性、硬编码中文扫描。
// 用法：node scripts/check-i18n.mjs（verify.mjs 第 2 步调用）
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NS_SOURCE = 'src/i18n/index.ts'
const LOCALE_DIR = 'src/i18n/locales'
const SRC_DIR = 'src'

// 约定保留的中文（不阻塞）：Issue 模板语言待产品裁决；键位匹配字面量「点击」非文案。
const CHINESE_FILE_ALLOWLIST = new Set(['src/features/settings/FeedbackDialog.tsx'])
const CHINESE_LINE_ALLOWLIST = [/点击:\s*["']settings\./, /["']Ctrl["'],\s*["']点击["']/]

// 恰好形如「域.key」但不是 i18n key 的标识符（如 BindableAction 枚举值）。
const NON_I18N_KEYS = new Set(['terminal.toggle'])

const errors = []
const warnings = []

function listFiles(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name).split('\\').join('/')
    if (statSync(path).isDirectory()) {
      if (dir === SRC_DIR && name === 'i18n') continue
      listFiles(path, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

// --- 1. 命名空间清单（从 index.ts 提取，避免脚本与注册漂移） ---
const nsMatch = readFileSync(NS_SOURCE, 'utf8').match(/MESSAGE_NAMESPACES\s*=\s*\[([^\]]+)\]/)
if (!nsMatch) {
  console.error('✗ 无法从 src/i18n/index.ts 提取 MESSAGE_NAMESPACES')
  process.exit(1)
}
const namespaces = [...nsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
const nsSet = new Set(namespaces)

// --- 2. 资源 key 提取（扁平对象；值换行书写时 key 单独成行，只匹配 2 空格缩进的顶层成员） ---
function resourceKeys(locale) {
  const keys = new Map()
  for (const ns of namespaces) {
    const file = join(LOCALE_DIR, locale, `${ns}.ts`)
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      errors.push(`${locale} 缺少资源文件 ${file}`)
      keys.set(ns, new Set())
      continue
    }
    const set = new Set()
    for (const line of source.split('\n')) {
      const m = line.match(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):(?:\s|$)/)
      if (m) set.add(m[1])
    }
    keys.set(ns, set)
  }
  return keys
}

const zhKeys = resourceKeys('zh-CN')
const enKeys = resourceKeys('en')

// --- 3. zh/en 同构 ---
for (const ns of namespaces) {
  const zh = zhKeys.get(ns)
  const en = enKeys.get(ns)
  for (const key of zh) {
    if (!en.has(key)) errors.push(`en/${ns}.ts 缺失 key：${ns}.${key}`)
  }
  for (const key of en) {
    if (!zh.has(key)) errors.push(`zh-CN/${ns}.ts 缺失 key：${ns}.${key}`)
  }
}

// --- 4. 使用 key 存在性（含映射表字面量；t()/tLoose()/i18next.t() 均为字符串字面量） ---
const KEY_LITERAL = /["']([a-z][a-zA-Z0-9]*)\.([a-zA-Z][a-zA-Z0-9]*)["']/g
// defaultNS 短 key 用法：t("language") 不带命名空间前缀，等价 common.language。
const SHORT_KEY_LITERAL = /\bt\(\s*["']([a-zA-Z][a-zA-Z0-9]*)["']/g
const usedKeys = new Set()
const files = listFiles(SRC_DIR, [])
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  let inBlock = false
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      return
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    for (const m of line.matchAll(KEY_LITERAL)) {
      const full = `${m[1]}.${m[2]}`
      if (nsSet.has(m[1]) && !NON_I18N_KEYS.has(full)) {
        usedKeys.add(full)
      }
    }
    for (const m of line.matchAll(SHORT_KEY_LITERAL)) {
      if (zhKeys.get('common')?.has(m[1])) {
        usedKeys.add(`common.${m[1]}`)
      }
    }
  })
}
for (const used of usedKeys) {
  const [ns, key] = used.split('.')
  if (!zhKeys.get(ns)?.has(key)) {
    errors.push(`使用了未定义的 key：${used}（zh-CN/${ns}.ts 中不存在）`)
  }
}

// --- 5. 冗余 key 警告（定义未使用；errors 域经 byCode 动态拼接，静态不可见，豁免） ---
const definedKeys = new Set()
for (const ns of namespaces) {
  for (const key of zhKeys.get(ns)) definedKeys.add(`${ns}.${key}`)
}
for (const defined of definedKeys) {
  if (!usedKeys.has(defined) && !defined.startsWith('errors.')) {
    warnings.push(`定义未使用：${defined}`)
  }
}

// --- 6. 硬编码中文扫描（排除注释与白名单） ---
const CJK = /[\u4e00-\u9fff]/
for (const file of files) {
  if (CHINESE_FILE_ALLOWLIST.has(file)) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  let inBlock = false
  let inJsx = false
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      return
    }
    if (inJsx) {
      if (trimmed.includes('*/')) inJsx = false
      return
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    if (/^\{\/\*.*\*\/\},?\s*$/.test(trimmed)) return
    if (trimmed.startsWith('{/*')) {
      inJsx = true
      return
    }
    if (CJK.test(line) && !CHINESE_LINE_ALLOWLIST.some((pattern) => pattern.test(line))) {
      errors.push(`${file}:${index + 1} 残留中文：${trimmed.slice(0, 60)}`)
    }
  })
}

// --- 汇总 ---
console.log(`命名空间 ${namespaces.length} 个；定义 key ${definedKeys.size}；使用 key ${usedKeys.size}`)
if (warnings.length > 0) {
  console.log(`\n警告（定义未使用，需人工确认是否动态引用）：`)
  for (const warning of warnings) console.log(`  ⚠ ${warning}`)
}
if (errors.length > 0) {
  console.error(`\n✗ i18n 完整性检查失败（${errors.length} 项）：`)
  for (const error of errors) console.error(`  ✗ ${error}`)
  process.exit(1)
}
console.log('✓ i18n 完整性检查通过')