// 生成应用图标的源 PNG（1024x1024，深色底 + 简易提交图谱），
// 再交给 `tauri icon` 派生各平台图标；不依赖任何绘图库。
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SIZE = 1024
const pixels = new Uint8Array(SIZE * SIZE * 4)

const bg = [24, 24, 37]
const nodes = [
  { x: 0.30, y: 0.28, r: 0.055, c: [137, 180, 250] },
  { x: 0.30, y: 0.50, r: 0.055, c: [166, 227, 161] },
  { x: 0.30, y: 0.72, r: 0.055, c: [137, 180, 250] },
  { x: 0.70, y: 0.39, r: 0.055, c: [245, 194, 231] },
  { x: 0.70, y: 0.61, r: 0.055, c: [250, 179, 135] },
]
const edges = [
  [0, 1],
  [1, 2],
  [0, 3],
  [3, 4],
  [4, 2],
  [1, 4],
]

const at = (i, j) => (j * SIZE + i) * 4

function blend(i, j, color, alpha) {
  if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) return
  const k = at(i, j)
  pixels[k] = Math.round(pixels[k] * (1 - alpha) + color[0] * alpha)
  pixels[k + 1] = Math.round(pixels[k + 1] * (1 - alpha) + color[1] * alpha)
  pixels[k + 2] = Math.round(pixels[k + 2] * (1 - alpha) + color[2] * alpha)
  pixels[k + 3] = 255
}

// 圆角方形底
const radius = SIZE * 0.19
for (let j = 0; j < SIZE; j++) {
  for (let i = 0; i < SIZE; i++) {
    const cx = Math.min(Math.max(i, radius), SIZE - 1 - radius)
    const cy = Math.min(Math.max(j, radius), SIZE - 1 - radius)
    const dx = i - cx
    const dy = j - cy
    const inside = dx * dx + dy * dy <= radius * radius
    if (inside) {
      const k = at(i, j)
      pixels[k] = bg[0]
      pixels[k + 1] = bg[1]
      pixels[k + 2] = bg[2]
      pixels[k + 3] = 255
    }
  }
}

const lineWidth = SIZE * 0.022
for (const [a, b] of edges) {
  const p = nodes[a]
  const q = nodes[b]
  const x1 = p.x * SIZE
  const y1 = p.y * SIZE
  const x2 = q.x * SIZE
  const y2 = q.y * SIZE
  const steps = 1200
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const x = x1 + (x2 - x1) * t
    const y = y1 + (y2 - y1) * t
    for (let dy = -Math.ceil(lineWidth); dy <= lineWidth; dy++) {
      for (let dx = -Math.ceil(lineWidth); dx <= lineWidth; dx++) {
        const d = Math.hypot(dx, dy)
        if (d <= lineWidth) blend(Math.round(x) + dx, Math.round(y) + dy, p.c, 0.75 * (1 - d / lineWidth))
      }
    }
  }
}

for (const n of nodes) {
  const cx = n.x * SIZE
  const cy = n.y * SIZE
  const r = n.r * SIZE
  const outer = r * 1.55
  for (let j = Math.floor(cy - outer); j <= Math.ceil(cy + outer); j++) {
    for (let i = Math.floor(cx - outer); i <= Math.ceil(cx + outer); i++) {
      const d = Math.hypot(i - cx, j - cy)
      if (d <= outer) {
        const alpha = d <= r ? 1 : 0.28 * (1 - (d - r) / (outer - r))
        blend(i, j, n.c, alpha)
      }
    }
  }
}

function crc32(buf) {
  let c
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let j = 0; j < SIZE; j++) {
  raw[j * (SIZE * 4 + 1)] = 0
  Buffer.from(pixels.buffer, j * SIZE * 4, SIZE * 4).copy(raw, j * (SIZE * 4 + 1) + 1)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2] ?? 'src-tauri/icons/source.png'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`icon source written: ${out}`)
