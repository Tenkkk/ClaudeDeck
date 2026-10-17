import { open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_ATTACHMENT_BYTES } from '../shared/attachments.js'
import type { MarkdownImageRead } from '../shared/ipc.js'

function within(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function rasterType(bytes: Buffer): string | null {
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
    : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) ? 'image/gif'
    : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : null
}

/** 只返回项目内的栅格图片,不把任意文件包装成 data URL。 */
export async function readMarkdownImage(project: string, source: string): Promise<MarkdownImageRead> {
  if (typeof source !== 'string' || !source || source.length > 8192 || /[\0\r\n]/.test(source)) {
    return { ok: false, reason: 'unsupported' }
  }
  let path = source
  try {
    if (/^file:/i.test(path)) {
      const url = new URL(path)
      if (url.hostname || url.search || url.hash) return { ok: false, reason: 'out-of-scope' }
      path = fileURLToPath(url)
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) {
        return { ok: false, reason: 'unsupported' }
      }
      // Markdown 常用百分号编码空格;普通路径中的孤立百分号保持原样。
      try { path = decodeURIComponent(path) } catch { /* 不是 URL 编码 */ }
    }
    // 禁止网络路径、设备路径及 NTFS alternate data streams。
    if (/^[\\/]{2}/.test(path) || /:/.test(path.replace(/^[a-z]:/i, ''))) {
      return { ok: false, reason: 'out-of-scope' }
    }
    const root = resolve(project)
    const target = resolve(root, path)
    if (!within(root, target)) return { ok: false, reason: 'out-of-scope' }
    const realRoot = await realpath(root)
    const realTarget = await realpath(target)
    if (!within(realRoot, realTarget)) return { ok: false, reason: 'out-of-scope' }
    const file = await open(realTarget, 'r')
    try {
      const info = await file.stat()
      if (!info.isFile()) return { ok: false, reason: 'unsupported' }
      if (info.size > MAX_ATTACHMENT_BYTES) return { ok: false, reason: 'too-large' }
      // 有界读取:stat 后文件即使增长也不会无上限占用内存。
      const data = Buffer.alloc(info.size + 1)
      let length = 0
      while (length < data.length) {
        const { bytesRead } = await file.read(data, length, data.length - length, length)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > info.size) return { ok: false, reason: 'too-large' }
      const bytes = data.subarray(0, length)
      const type = rasterType(bytes)
      if (!type) return { ok: false, reason: 'unsupported' }
      return { ok: true, src: `data:${type};base64,${bytes.toString('base64')}`, path: realTarget }
    } finally {
      await file.close()
    }
  } catch {
    return { ok: false, reason: 'not-found' }
  }
}

/** 仅在用户执行菜单动作时读取网络图片,不借用渠道凭据或浏览器 Cookie。 */
export async function loadImageForAction(project: string, source: string): Promise<{
  src: string; bytes: Buffer; name: string; path?: string
}> {
  if (typeof source !== 'string' || !source) throw new Error('图片地址无效。')
  let bytes: Buffer
  let path: string | undefined
  let name = 'image'
  if (/^data:/i.test(source)) {
    if (source.length > 28 * 1024 * 1024 || !/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(source)) {
      throw new Error('图片格式不支持或超过 20MB。')
    }
    bytes = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')
  } else if (/^https:/i.test(source)) {
    if (source.length > 8192) throw new Error('图片地址过长。')
    let url = new URL(source)
    const signal = AbortSignal.timeout(15_000)
    let data: Buffer | undefined
    for (let count = 0; count <= 3; count++) {
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('仅支持不带凭据的 HTTPS 图片。')
      const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location || count === 3) throw new Error('图片重定向异常。')
        url = new URL(location, url)
        continue
      }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('网络图片无法读取。') }
      if (Number(response.headers.get('content-length')) > MAX_ATTACHMENT_BYTES) {
        await response.body.cancel()
        throw new Error('图片不能超过 20MB。')
      }
      const reader = response.body.getReader()
      const chunks: Buffer[] = []
      let length = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > MAX_ATTACHMENT_BYTES) throw new Error('图片不能超过 20MB。')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      data = Buffer.concat(chunks)
      try { name = decodeURIComponent(url.pathname.split('/').at(-1) || 'image') } catch { /* 使用默认名称 */ }
      break
    }
    if (!data) throw new Error('网络图片无法读取。')
    bytes = data
  } else {
    const result = await readMarkdownImage(project, source)
    if (!result.ok) throw new Error(result.reason === 'out-of-scope' ? '图片不在项目目录内。'
      : result.reason === 'too-large' ? '图片不能超过 20MB。' : '图片不存在、格式不支持或无法读取。')
    bytes = Buffer.from(result.src.slice(result.src.indexOf(',') + 1), 'base64')
    path = result.path
    name = basename(path || source)
  }
  const type = rasterType(bytes)
  if (!type || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('图片格式不支持或超过 20MB。')
  const extension = type === 'image/jpeg' ? 'jpg' : type.slice(6)
  const stem = name.replace(/\.[^.]*$/, '').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 160).trim() || 'image'
  return { bytes, path, name: `${stem}.${extension}`, src: `data:${type};base64,${bytes.toString('base64')}` }
}
