// 本地校验与 CI 共用入口：顺序执行版本号、i18n、IPC、Node 测试、前端构建、clippy 与 Rust 测试。
// 前端构建放在 cargo 之前，确保 src-tauri 编译期嵌入 dist 资源时目录已存在。
// 用法：node scripts/verify.mjs [--skip-build]
import { spawnSync } from 'node:child_process'

const skipBuild = process.argv.includes('--skip-build')

const steps = [
  // 版本号有四处声明 + Cargo.lock，任一遗漏只会在打包后才暴露，这里最便宜就先挡住。
  { name: '版本号一致性', command: 'node', args: ['scripts/version.mjs', '--check'] },
  // i18n 门禁：zh/en 资源同构、使用的 key 必须定义、硬编码中文扫描。
  { name: 'i18n 完整性', command: 'node', args: ['scripts/check-i18n.mjs'] },
  // IPC 门禁：Tauri 命令名/实参写错只在运行时抛错，编译期完全无感。
  { name: 'IPC 契约', command: 'node', args: ['scripts/check-ipc-args.mjs'] },
  // Node 原生测试：覆盖纯 TS 模块，无需额外测试运行器或构建产物。
  { name: 'node --test', command: 'node', args: ['--test'] },
  // npm 许可证门禁：与 Rust deny.toml 白名单对齐，拦截 GPL/未知许可证。
  { name: 'npm 许可证', command: 'node', args: ['scripts/check-npm-licenses.mjs'] },
  // npm 在 Windows 下是 .cmd，须经 shell 执行；参数静态，不涉及用户输入。
  ...(skipBuild
    ? []
    : [{ name: 'npm run build', command: 'npm run build', args: [], shell: true }]),
  { name: 'cargo fmt --check', command: 'cargo', args: ['fmt', '--all', '--check'] },
  {
    name: 'cargo clippy',
    command: 'cargo',
    args: ['clippy', '--workspace', '--all-targets', '--', '-D', 'warnings'],
  },
  { name: 'cargo test', command: 'cargo', args: ['test', '--workspace'] },
]

const started = Date.now()
const results = []

for (const step of steps) {
  const begin = Date.now()
  console.log(`\n=== ${step.name} ===`)
  const outcome = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    shell: step.shell ?? false,
  })
  const passed = outcome.status === 0
  results.push({ name: step.name, passed, seconds: ((Date.now() - begin) / 1000).toFixed(1) })
  if (!passed) {
    console.error(`\n✗ ${step.name} 失败（exit ${outcome.status ?? outcome.error}）`)
    break
  }
}

console.log('\n=== 校验汇总 ===')
for (const result of results) {
  console.log(`${result.passed ? '✓' : '✗'} ${result.name} (${result.seconds}s)`)
}
console.log(`总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`)

if (results.some((result) => !result.passed) || results.length !== steps.length) {
  process.exit(1)
}
