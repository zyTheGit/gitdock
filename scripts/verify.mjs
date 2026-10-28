// 本地校验与 CI 共用入口：顺序执行前端构建、格式检查、clippy 与 Rust 测试。
// 前端构建放在最前，确保 src-tauri 编译期嵌入 dist 资源时目录已存在。
// 用法：node scripts/verify.mjs [--skip-build]
import { spawnSync } from 'node:child_process'

const skipBuild = process.argv.includes('--skip-build')

const steps = [
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
