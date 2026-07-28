/**
 * 生成应用图标:build/icon.svg、build/icon.png(512)、build/icon-32.png。
 *
 *   npm run icon
 *
 * 几何只在这里定义一次,SVG 和 PNG 都由它出 —— 两份手写的迟早会分叉。
 * electron-builder 拿 512 的 PNG 去生成 Windows 的 .ico。
 *
 * ## 为什么自己写 PNG 而不是渲染 SVG
 *
 * 试过用 Electron 起个窗口截图:隐藏窗口拿不到帧,挪到屏幕外显示也一样卡住。
 * 而这个图形只有圆角矩形和圆,自己按公式算覆盖率反而是确定的 —— 不依赖
 * 合成器、不看时序、不引任何图形库(sharp 那类还带原生模块,又是一处
 * 平台相关的构建风险)。
 *
 * ## 图形本身
 *
 * 画的是这个应用最认得出来的那件事:左边一条侧栏、右边一片对话区,
 * 也就是「deck」指的那块面板;右侧那颗点是界面里的呼吸点(§02)。
 *
 * 任务栏上它只有 16px,所以全部用实心块、块间留出缩小后仍有约 1px 的间隙。
 * 不画 Claude 的星芒 —— 那是 Anthropic 的商标,这是个非官方项目。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build')
mkdirSync(OUT, { recursive: true })

/** 设计终稿第 01 节的两个颜色 */
const CLAY = [0xa7, 0x5f, 0x38]
const PAPER = [0xfa, 0xf7, 0xf2]

/** 画布 512 下的几何。改这里,SVG 和 PNG 一起变。 */
const G = {
  size: 512,
  bg: { x: 0, y: 0, w: 512, h: 512, r: 112 },
  sidebar: { x: 100, y: 128, w: 68, h: 256, r: 20 },
  main: { x: 200, y: 128, w: 212, h: 256, r: 20 },
  dot: { cx: 306, cy: 256, r: 36 },
}

/** 圆角矩形的有符号距离:负数在内部 */
function sdRoundRect(px, py, { x, y, w, h, r }) {
  const cx = x + w / 2
  const cy = y + h / 2
  const qx = Math.abs(px - cx) - (w / 2 - r)
  const qy = Math.abs(py - cy) - (h / 2 - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

function sdCircle(px, py, { cx, cy, r }) {
  return Math.hypot(px - cx, py - cy) - r
}

/**
 * 每个像素取 4×4 子采样。图标全是曲边,不做抗锯齿的话圆角会有明显的台阶,
 * 缩到 32px 尤其难看。
 */
const SS = 4

function render(size) {
  const scale = size / G.size
  const rgba = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgHit = 0
      let paperHit = 0
      let clayDotHit = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // 子采样点换算回 512 的设计坐标
          const X = (px + (sx + 0.5) / SS) / scale
          const Y = (py + (sy + 0.5) / SS) / scale

          if (sdRoundRect(X, Y, G.bg) < 0) bgHit++
          const inPanels =
            sdRoundRect(X, Y, G.sidebar) < 0 || sdRoundRect(X, Y, G.main) < 0
          if (inPanels) paperHit++
          if (inPanels && sdCircle(X, Y, G.dot) < 0) clayDotHit++
        }
      }

      const n = SS * SS
      const alpha = bgHit / n
      // 纸色的覆盖率要扣掉挖出来的那颗点
      const paper = Math.max(0, paperHit - clayDotHit) / n
      const out = (py * size + px) * 4

      if (alpha <= 0) continue
      // 先陶土底,再把纸色按覆盖率叠上去
      for (let c = 0; c < 3; c++) {
        rgba[out + c] = Math.round(CLAY[c] * (1 - paper) + PAPER[c] * paper)
      }
      rgba[out + 3] = Math.round(alpha * 255)
    }
  }
  return rgba
}

/** 最小实现的 PNG 编码:IHDR + IDAT + IEND,真彩带 alpha */
function toPng(rgba, size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const cr = Buffer.alloc(4)
    cr.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, cr])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 真彩 + alpha
  // 10..12 压缩/滤波/隔行,全部为 0

  // 每行前面一个滤波字节,这里一律用 0(不滤波)
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function toSvg() {
  const rr = (o, fill) =>
    `  <rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="${o.r}" fill="${fill}" />`
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  return `<!-- 由 scripts/make-icon.mjs 生成,不要手改 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${rr(G.bg, hex(CLAY))}
${rr(G.sidebar, hex(PAPER))}
${rr(G.main, hex(PAPER))}
  <circle cx="${G.dot.cx}" cy="${G.dot.cy}" r="${G.dot.r}" fill="${hex(CLAY)}" />
</svg>
`
}

writeFileSync(join(OUT, 'icon.svg'), toSvg())
for (const size of [512, 256, 32]) {
  const name = size === 512 ? 'icon.png' : `icon-${size}.png`
  writeFileSync(join(OUT, name), toPng(render(size), size))
  console.log(`build/${name}  ${size}x${size}`)
}
console.log('build/icon.svg')
