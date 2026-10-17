/** node scripts/tool-image-compat.mjs —— 仅本机模拟渠道,不使用真实凭据或付费模型。 */
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createToolImageBridge, isLocalImageChannel, replaceToolImages } from '../src/main/tool-image-compat.ts'

const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }
for (const url of ['http://localhost:7863', 'http://127.0.0.1:7863', 'http://[::1]:7863/channel']) assert.equal(isLocalImageChannel(url), true)
for (const url of [undefined, '', 'invalid', 'https://api.anthropic.com', 'http://remote.example', 'http://127.0.0.1.evil.example', 'http://user:secret@localhost', 'http://localhost?query=1']) assert.equal(isLocalImageChannel(url), false)
const body = {
  model: 'fixture-model', stream: true, system: 'keep-system',
  messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'fixture.png' } }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'read-1', is_error: true, content: [{ type: 'text', text: '保留文字' }, image, { type: 'text', text: '后续说明' }] },
      image, { type: 'text', text: '保留用户上传图片' },
    ] },
    { role: 'user', content: '好了吗' },
  ],
}
const original = JSON.stringify(body)
const transformed = replaceToolImages(body)
assert.equal(transformed.count, 1)
assert.equal(JSON.stringify(body), original)
assert.deepEqual(transformed.body.messages[1].content[1], image)
assert.equal(transformed.body.messages[1].content[0].tool_use_id, 'read-1')
assert.equal(transformed.body.messages[1].content[0].is_error, true)
assert.equal(transformed.body.messages[1].content[0].content[0].text, '保留文字')
assert.equal(transformed.body.messages[1].content[0].content[2].text, '后续说明')
assert.match(transformed.body.messages[1].content[0].content[1].text, /未交给模型读取/)
assert.strictEqual(replaceToolImages({ messages: [] }).count, 0)
assert.strictEqual(replaceToolImages('not-json').body, 'not-json')

const exact = 'tool_result: unsupported text content block "image"'
let mode = 'reject-image'
const received = []
let aborted = 0
let sdkTurns = 0
const upstream = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const bytes = Buffer.concat(chunks)
  let payload
  try { payload = JSON.parse(bytes.toString('utf8')) } catch {}
  received.push({ url: req.url, headers: req.headers, bytes, payload })
  if (mode === 'sdk' && !req.url.includes('/v1/messages')) { res.writeHead(200).end('{}'); return }
  if (mode === 'wait') {
    res.on('close', () => { aborted++ })
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('event: waiting\ndata: {}\n\n')
    return
  }
  const hasImage = replaceToolImages(payload).count > 0
  if ((['reject-image', 'sdk'].includes(mode) && hasImage) || ['always-error', 'generic', 'unauthorized', 'compressed', 'huge'].includes(mode)) {
    const error = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error',
      message: mode === 'generic' ? 'user: unsupported text content block "image"' : exact,
      ...(mode === 'huge' ? { details: 'x'.repeat(2 * 1024 * 1024) } : {}),
    } })
    res.writeHead(mode === 'unauthorized' ? 401 : 400, { 'content-type': 'application/json',
      ...(mode === 'compressed' ? { 'content-encoding': 'gzip' } : {}) })
    res.end(mode === 'compressed' ? gzipSync(error) : error)
    return
  }
  if (mode === 'sdk') {
    const tool = sdkTurns++ === 0
    const block = tool
      ? { type: 'tool_use', id: 'fixture-read-image', name: 'Read', input: { file_path: join(sdkWorkspace, 'fixture.png') } }
      : { type: 'text', text: 'fixture completed without seeing image' }
    const message = { id: `fixture-message-${sdkTurns}`, type: 'message', role: 'assistant',
      model: payload.model, content: [block], stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 } }
    if (!payload.stream) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message)); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = (value) => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
    event({ type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    event({ type: 'content_block_start', index: 0, content_block: tool ? { ...block, input: {} } : { type: 'text', text: '' } })
    event({ type: 'content_block_delta', index: 0, delta: tool
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
      : { type: 'text_delta', text: block.text } })
    event({ type: 'content_block_stop', index: 0 })
    event({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } })
    event({ type: 'message_stop' })
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'fixture-response' })
  res.write('event: message_start\ndata: {"text":"first"}\n\n')
  setTimeout(() => res.end('event: message_stop\ndata: {}\n\n'), 15)
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
let notices = 0
const bridge = await createToolImageBridge(`http://127.0.0.1:${upstream.address().port}/channel`, () => { notices++ })
const other = await createToolImageBridge(`http://127.0.0.1:${upstream.address().port}/other`, () => {})
let sdkWorkspace
const send = async (payload = body, base = bridge.baseUrl, path = '/v1/messages?beta=true', headers = {}) => {
  const result = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json',
    'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) })
  return { status: result.status, text: await result.text(), headers: result.headers }
}
try {
  let result = await send()
  assert.equal(result.status, 200)
  assert.equal(received.length, 2)
  assert.equal(notices, 1)
  assert.equal(received[0].bytes.toString('utf8'), original)
  assert.deepEqual(received[1].payload, transformed.body)
  assert.equal(received[1].url, '/channel/v1/messages?beta=true')
  assert.equal(received[1].headers['x-api-key'], 'fixture-key')
  assert.equal(result.headers.get('request-id'), 'fixture-response')
  assert.match(result.text, /message_start[\s\S]*message_stop/)
  assert.equal(JSON.stringify(body), original)
  console.log('PASS 历史/新工具图片、混合文字、用户图片、固定路径、鉴权及 SSE')

  // 同渠道切回支持图片的模型/修复渠道后,不记住之前的降级。
  mode = 'supported'
  const start = received.length
  result = await send()
  assert.equal(received.length, start + 1)
  assert.equal(received.at(-1).bytes.toString('utf8'), original)
  assert.equal(notices, 1)
  await send(body, other.baseUrl)
  assert.equal(received.at(-1).url, '/other/v1/messages?beta=true')
  console.log('PASS 支持图片原样发送、不缓存能力、会话隔离')

  for (const [testMode, status, requests] of [['always-error', 400, 2], ['compressed', 400, 2], ['generic', 400, 1], ['unauthorized', 401, 1], ['huge', 400, 1]]) {
    mode = testMode
    const before = received.length
    result = await send()
    assert.equal(result.status, status)
    assert.equal(received.length - before, requests, testMode)
    if (testMode === 'huge') assert.match(result.text, /"details":"x{100}/)
  }
  mode = 'always-error'
  const noImage = received.length
  await send({ messages: [{ role: 'user', content: [image] }] })
  assert.equal(received.length, noImage + 1)
  const countTokens = received.length
  await send(body, bridge.baseUrl, '/v1/messages/count_tokens')
  assert.equal(received.length, countTokens + 1)
  const malformed = received.length
  await send('{bad-json')
  assert.equal(received.length, malformed + 1)
  console.log('PASS 精确错误匹配、最多一次重试、压缩/超大错误、非目标请求直通')

  const beforeSecurity = received.length
  assert.equal((await send(body, new URL(bridge.baseUrl).origin)).status, 403)
  assert.equal((await send(body, bridge.baseUrl, '/v1/messages', { origin: 'https://untrusted.example' })).status, 403)
  assert.equal(received.length, beforeSecurity)
  const oversize = await send(' '.repeat(64 * 1024 * 1024 + 1))
  assert.equal(oversize.status, 413)
  assert.equal(received.length, beforeSecurity)
  console.log('PASS 路径令牌/跨源拦截、64MB 上限且不向上游发送')

  mode = 'wait'
  const controller = new AbortController()
  const stream = await fetch(bridge.baseUrl + '/v1/messages', { method: 'POST', body: original, signal: controller.signal })
  const reader = stream.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /waiting/)
  controller.abort()
  await assert.rejects(reader.read())
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(aborted, 1)
  const pending = await fetch(bridge.baseUrl + '/v1/messages', { method: 'POST', body: original })
  const pendingReader = pending.body.getReader()
  await pendingReader.read()
  bridge.close()
  await assert.rejects(pendingReader.read())
  await assert.rejects(fetch(bridge.baseUrl + '/v1/messages'))
  console.log('PASS 首块及时输出、取消传递、退出关闭连接及监听')

  if (process.argv.includes('--sdk')) {
    // 真实 SDK/CLI,使用独立配置与模拟接口,绝不继承用户 API 凭据或 MCP。
    const { query, getSessionMessages } = await import('@anthropic-ai/claude-agent-sdk')
    const configDir = mkdtempSync(join(tmpdir(), 'claudedeck-image-sdk-'))
    sdkWorkspace = join(configDir, 'workspace')
    mkdirSync(sdkWorkspace)
    // 还原真实机器的冲突:用户配置把启动环境里的兼容地址改回原渠道。
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ env: {
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      ANTHROPIC_API_KEY: 'fixture-not-a-real-key',
    } }))
    mkdirSync(join(sdkWorkspace, '.claude'))
    for (const name of ['settings.json', 'settings.local.json']) {
      writeFileSync(join(sdkWorkspace, '.claude', name), JSON.stringify({ env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.address().port}/${name === 'settings.local.json' ? 'local' : 'project'}`,
      } }))
    }
    writeFileSync(join(sdkWorkspace, 'fixture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=', 'base64'))
    const sdkBridge = await createToolImageBridge(`http://127.0.0.1:${upstream.address().port}`, () => {})
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ANTHROPIC_|CLAUDE_|OPENAI_|.*PROXY)/i.test(key)))
    Object.assign(env, { CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_BASE_URL: sdkBridge.baseUrl,
      ANTHROPIC_API_KEY: 'fixture-not-a-real-key', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1' })
    mode = 'sdk'
    const options = { cwd: sdkWorkspace, env, model: 'claude-sonnet-4-6',
      ...(process.argv.includes('--unpatched') ? {} : { settings: { env: { ANTHROPIC_BASE_URL: sdkBridge.baseUrl } } }),
      tools: ['Read'], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, maxTurns: 3 }
    let sessionId
    let live
    const savedConfig = process.env.CLAUDE_CONFIG_DIR
    try {
      for (const resume of [false, true]) {
        const firstRequest = received.length
        live = query({ prompt: 'Read fixture.png then report whether you saw it.', options: { ...options, ...(resume ? { resume: sessionId } : {}) } })
        const timeout = setTimeout(() => live.close(), 30000)
        try {
          let result
          try {
            for await (const event of live) {
              if (event.type === 'system' && event.subtype === 'init') sessionId = event.session_id
              if (event.type === 'result') result = event
            }
          } catch (err) {
            if (!process.argv.includes('--unpatched')) throw err
            assert.match(err.message, /tool_result: unsupported text content block "image"/)
          }
          assert.equal(result?.subtype, 'success', JSON.stringify(result))
          if (process.argv.includes('--unpatched')) {
            assert.equal(result?.is_error, true, '未修补路径应被用户 settings.env 覆盖并复现 400')
            assert.match(result?.result ?? '', /tool_result: unsupported text content block "image"/)
            assert.equal(received.slice(firstRequest).some((item) => (JSON.stringify(item.payload) ?? '').includes('未交给模型读取')), false)
            console.log('PASS 复现原缺陷:用户 settings.env 绕过兼容层,返回相同 400')
            break
          }
          assert.equal(result?.is_error, false, JSON.stringify(result))
          assert.ok(received.slice(firstRequest).filter((item) => item.payload?.messages).every((item) =>
            item.url.startsWith('/v1/messages') && item.payload.model === 'claude-sonnet-4-6'), '临时设置仅固定兼容路由,模型不变')
          assert.ok(received.slice(firstRequest).some((item) => replaceToolImages(item.payload).count > 0), '真实请求应含原始工具图片')
          assert.ok(received.slice(firstRequest).some((item) => (JSON.stringify(item.payload) ?? '').includes('未交给模型读取')), '重试请求应含兼容说明')
        } finally { clearTimeout(timeout); live.close() }
      }
      process.env.CLAUDE_CONFIG_DIR = configDir
      const history = await getSessionMessages(sessionId, { dir: sdkWorkspace })
      assert.ok(history.some((entry) => replaceToolImages({ messages: [entry.message] }).count > 0), '原始历史必须保留图片')
      console.log(process.argv.includes('--unpatched') ? 'PASS 未修补时仍保留历史原图'
        : 'PASS 用户/项目/本地配置不再绕过兼容层、模型不变、真实 SDK Read/恢复及原图保留(仅模拟 API)')
    } finally {
      live?.close()
      sdkBridge.close()
      if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = savedConfig
    }
  }
} finally {
  bridge.close()
  other.close()
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
}
console.log('工具图片兼容回归通过,未请求真实模型。')
