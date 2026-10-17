import { randomBytes } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

const MAX_REQUEST_BYTES = 64 * 1024 * 1024
const MAX_ERROR_BYTES = 1024 * 1024
export const TOOL_IMAGE_NOTICE = '当前渠道不接受工具结果中的图片,已改为文字说明继续。模型未读取这些图片;需要视觉判断时,请切换到支持图片工具结果的渠道。'
const IMAGE_PLACEHOLDER = '[ClaudeDeck 图片兼容提示:当前渠道拒绝工具结果中的图片。此图片未交给模型读取,不得声称看过图片或推断其视觉内容;如需视觉判断,请告知用户切换支持图片工具结果的渠道。原图仍保留在本机会话历史中。]'

type RecordValue = Record<string, unknown>
function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 只转换模型请求副本中的工具图片,不改用户图片、原始历史或其他内容。 */
export function replaceToolImages(body: unknown): { body: unknown; count: number } {
  let count = 0
  if (!object(body) || !Array.isArray(body.messages)) return { body, count }
  const messages = body.messages.map((message: unknown) => {
    if (!object(message) || message.role !== 'user' || !Array.isArray(message.content)) return message
    const content = message.content.map((block: unknown) => {
      if (!object(block) || block.type !== 'tool_result' || !Array.isArray(block.content)) return block
      return { ...block, content: block.content.map((part: unknown) => {
        if (!object(part) || part.type !== 'image') return part
        count++
        return { type: 'text', text: IMAGE_PLACEHOLDER }
      }) }
    })
    return { ...message, content }
  })
  return { body: count ? { ...body, messages } : body, count }
}

function rejectedToolImage(response: IncomingMessage, bytes: Buffer): boolean {
  if (response.statusCode !== 400) return false
  try {
    const encoding = response.headers['content-encoding']
    const decoded = encoding === 'gzip' ? gunzipSync(bytes, { maxOutputLength: MAX_ERROR_BYTES })
      : encoding === 'deflate' ? inflateSync(bytes, { maxOutputLength: MAX_ERROR_BYTES })
      : encoding === 'br' ? brotliDecompressSync(bytes, { maxOutputLength: MAX_ERROR_BYTES }) : bytes
    const error: unknown = JSON.parse(decoded.toString('utf8'))
    if (!object(error)) return false
    const message = object(error.error) ? error.error.message : error.message
    return typeof message === 'string' && /^tool_result:\s*unsupported text content block ["']image["']\s*$/i.test(message)
  } catch {
    return false
  }
}

function headersWithoutHop(headers: OutgoingHttpHeaders): OutgoingHttpHeaders {
  const result = { ...headers }
  const connection = result.connection
  if (typeof connection === 'string') {
    for (const name of connection.split(',')) delete result[name.trim().toLowerCase()]
  }
  for (const name of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']) delete result[name]
  return result
}

export interface ToolImageBridge {
  baseUrl: string
  close: () => void
}

/** 不接管远程渠道的代理/证书语义;只兼容显式配置的本机中转。 */
export function isLocalImageChannel(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl)
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}

/** 固定上游 + 随机路径令牌,不开放可指定目的地的代理,不落盘任何请求。 */
export async function createToolImageBridge(baseUrl: string, notice: () => void): Promise<ToolImageBridge> {
  const upstream = new URL(baseUrl)
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) {
    throw new Error('图片兼容层需要不含用户名、密码、查询或片段的 HTTP(S) 渠道地址。')
  }
  const prefix = `/${randomBytes(32).toString('hex')}`
  const pending = new Set<ReturnType<typeof httpRequest>>()
  const server = createServer(async (req, res) => {
    const path = req.url ?? ''
    if (!path.startsWith(`${prefix}/`) || req.headers.origin) {
      res.writeHead(403).end()
      return
    }
    const target = new URL(upstream.href)
    target.pathname = upstream.pathname.replace(/\/$/, '') + path.slice(prefix.length).split('?')[0]
    target.search = path.includes('?') ? path.slice(path.indexOf('?')) : ''
    const headers = headersWithoutHop(req.headers)
    let active: ReturnType<typeof httpRequest> | undefined
    req.on('error', () => active?.destroy())
    res.on('close', () => { if (!res.writableFinished) active?.destroy() })
    const fail = (status: number, message: string): void => {
      if (res.destroyed) return
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(status, { 'content-type': 'application/json' })
        .end(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }))
    }
    const forward = (body?: Buffer): Promise<IncomingMessage> => new Promise((resolve, reject) => {
      const outgoing = { ...headers }
      if (body) outgoing['content-length'] = body.length
      active = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers: outgoing }, resolve)
      pending.add(active)
      const request = active
      request.on('close', () => pending.delete(request))
      request.on('error', reject)
      if (body) request.end(body)
      else req.pipe(request)
    })
    const relay = (response: IncomingMessage, buffered?: Buffer): void => {
      res.writeHead(response.statusCode ?? 502, headersWithoutHop(response.headers))
      response.on('error', () => res.destroy())
      if (buffered) res.end(buffered)
      else response.pipe(res)
    }
    try {
      // 其他控制/额度请求直通;不缓存或解释它们的正文。
      const messagesRequest = req.method === 'POST' && target.pathname.endsWith('/v1/messages')
        && (!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity')
      if (!messagesRequest) { relay(await forward()); return }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_REQUEST_BYTES) { fail(413, '图片兼容请求超过 64MB,请减少图片或新建会话。'); return }
        chunks.push(chunk)
      }
      if (res.destroyed) return
      const bytes = Buffer.concat(chunks)
      let transformed: ReturnType<typeof replaceToolImages> | undefined
      try { transformed = replaceToolImages(JSON.parse(bytes.toString('utf8'))) } catch { /* 非 JSON 原样返回渠道结果 */ }
      const first = await forward(bytes)
      if (res.destroyed) { first.destroy(); return }
      if (first.statusCode !== 400 || !transformed?.count) { relay(first); return }
      const errors: Buffer[] = []
      let errorSize = 0
      // 有界读取 400,过大时原样流回,不把错误响应无限保存在内存。
      for await (const chunk of first) {
        errorSize += chunk.length
        errors.push(chunk)
        if (errorSize > MAX_ERROR_BYTES) {
          res.writeHead(400, headersWithoutHop(first.headers))
          for (const item of errors) res.write(item)
          for await (const rest of first) res.write(rest)
          res.end()
          return
        }
      }
      const errorBytes = Buffer.concat(errors)
      if (!rejectedToolImage(first, errorBytes)) { relay(first, errorBytes); return }
      if (res.destroyed) return
      // 只有明确拒绝图片的 400 才重试一次;不重新执行工具、不修改历史。
      notice()
      const second = await forward(Buffer.from(JSON.stringify(transformed.body), 'utf8'))
      if (res.destroyed) { second.destroy(); return }
      relay(second)
    } catch {
      active?.destroy()
      fail(502, '图片兼容层无法连接已配置渠道,请检查渠道服务与网络。')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  server.on('error', () => { /* 单次连接错误由请求处理,不打印渠道或凭据 */ })
  server.unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('图片兼容层未能建立本机监听。')
  return {
    baseUrl: `http://127.0.0.1:${address.port}${prefix}`,
    close: () => {
      for (const request of pending) request.destroy()
      pending.clear()
      server.close()
      server.closeAllConnections()
    },
  }
}
