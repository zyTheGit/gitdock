// 通过 WebView2 远程调试端口读取页面状态：用于无头验证 Tauri 前端。
// 用法：node scripts/cdp.mjs "<js 表达式>" [--reload] [--screenshot out.png] [--wait ms]
// 需要以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动应用。
const args = process.argv.slice(2)
const expression = args.find((a) => !a.startsWith('--')) ?? 'document.body.innerText'
const flag = (name) => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const waitMs = Number(option('--wait', '0'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json())
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target', targets)
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
const events = []

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') {
    events.push(msg)
  }
})

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

await send('Runtime.enable')
await send('Log.enable')
if (flag('--reload')) {
  await send('Page.enable')
  await send('Page.reload', { ignoreCache: true })
}
if (waitMs > 0) await sleep(waitMs)

const result = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
})
if (result.result?.exceptionDetails) {
  console.error('evaluate failed:', JSON.stringify(result.result.exceptionDetails, null, 2))
} else {
  console.log(JSON.stringify(result.result?.result?.value ?? null, null, 2))
}

for (const e of events) {
  if (e.method === 'Runtime.consoleAPICalled') {
    console.log('console.' + e.params.type, e.params.args.map((a) => a.value ?? a.description).join(' '))
  } else if (e.method === 'Runtime.exceptionThrown') {
    console.log('exception', e.params.exceptionDetails.text, e.params.exceptionDetails.exception?.description ?? '')
  } else {
    console.log('log', e.params.entry.level, e.params.entry.text)
  }
}

const shot = option('--screenshot', null)
if (shot) {
  const image = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(shot, Buffer.from(image.result.data, 'base64'))
  console.log('screenshot:', shot)
}
ws.close()
