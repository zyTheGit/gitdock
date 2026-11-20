// npm 依赖许可证门禁：枚举 package-lock.json 中的全部包，读取其 node_modules
// package.json 的 license 字段（缺失时回退 lock 记录），白名单与 Rust deny.toml 对齐。
// 命中白名单外许可证时以非零退出码结束并打印包名与许可证值。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// 与 deny.toml [licenses] allow 保持一致；Unlicense 为规划文档显式补充的宽松许可。
const ALLOWED = [
  'MIT',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'ISC',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  'CC0-1.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'MPL-2.0',
  'Zlib',
  '0BSD',
  'CDLA-Permissive-2.0',
  'Unlicense',
].map((license) => license.toLowerCase())

// 仅允许出现在构建期 dev 依赖中的许可证：caniuse-lite（browserslist ← vite 传递依赖）
// 为 CC-BY-4.0 数据许可，不随产物分发；生产依赖命中时仍拒绝。
const DEV_ONLY_ALLOWED = ['CC-BY-4.0']

const coreAllowed = new Set(ALLOWED)
const devAllowed = new Set([...ALLOWED, ...DEV_ONLY_ALLOWED.map((l) => l.toLowerCase())])

function licenseValue(pkg, lockEntry) {
  const raw = pkg.license ?? lockEntry?.license ?? pkg.licenses ?? lockEntry?.licenses
  if (!raw) return null
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw.map((item) => item?.type ?? item).join(' OR ')
  return raw.type ?? null
}

/** SPDX 表达式求值：OR 任一分支允许即可，AND 分支内须全部允许。 */
export function isAllowed(expr, { dev = false } = {}) {
  const allowedSet = dev ? devAllowed : coreAllowed
  const normalized = expr.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalized) return false
  return normalized.split(' or ').some((branch) =>
    branch
      .split(' and ')
      .map((id) => id.trim())
      .every((id) => allowedSet.has(id)),
  )
}

function main() {
  let lock
  try {
    lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  } catch (error) {
    console.error(`✗ 无法读取 package-lock.json：${error.message}`)
    process.exit(1)
  }

  const entries = Object.entries(lock.packages ?? {}).filter(
    ([path, entry]) => path.startsWith('node_modules/') && !entry.link,
  )

  const rejected = []
  const missing = []
  const skipped = []

  for (const [path, lockEntry] of entries) {
    const pkgJsonPath = join(root, path, 'package.json')
    const name = lockEntry.name ?? path.replace(/^node_modules\//, '')
    const version = lockEntry.version ?? '?'
    const dev = lockEntry.dev === true
    if (!existsSync(pkgJsonPath)) {
      // 平台相关可选依赖未安装时不在产物内，跳过而不误报。
      const fallback = licenseValue({}, lockEntry)
      if (fallback && !isAllowed(fallback, { dev })) rejected.push({ name, version, license: fallback })
      else skipped.push(name)
      continue
    }
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    } catch (error) {
      rejected.push({ name, version, license: `package.json 解析失败：${error.message}` })
      continue
    }
    const license = licenseValue(pkg, lockEntry)
    if (!license) {
      missing.push({ name, version })
    } else if (!isAllowed(license, { dev })) {
      rejected.push({ name, version, license })
    }
  }

  console.log(`npm 许可证检查：扫描 ${entries.length} 个包（跳过未安装 ${skipped.length} 个）`)

  if (missing.length > 0) {
    console.error(`\n✗ ${missing.length} 个包缺少 license 字段：`)
    for (const { name, version } of missing) console.error(`  - ${name}@${version}`)
  }
  if (rejected.length > 0) {
    console.error(`\n✗ ${rejected.length} 个包使用了白名单外许可证：`)
    for (const { name, version, license } of rejected) {
      console.error(`  - ${name}@${version}: ${license}`)
    }
    console.error('\n白名单见 scripts/check-npm-licenses.mjs，新增许可须与 deny.toml 同步评审。')
  }

  if (missing.length > 0 || rejected.length > 0) process.exit(1)
  console.log('✓ npm 许可证检查通过')
}

main()
