/** npm run build && node scripts/attachments.mjs
 * 附件存储/文档解析与真实 Electron 桥接回归;SDK 使用 fixture,不请求模型。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateRawSync, deflateSync, crc32 } from 'node:zlib'
import { build } from 'esbuild'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright'

const ROOT = resolve(import.meta.dirname, '..')
const TEMP = mkdtempSync(join(tmpdir(), 'claudedeck-attachments-'))
const WORKSPACE = join(TEMP, 'project')
const OTHER = join(TEMP, 'other')
const USER_DATA = join(TEMP, 'user-data')
const REPORT = join(TEMP, 'closed.json')
for (const path of [WORKSPACE, OTHER, USER_DATA]) mkdirSync(path)
writeFileSync(join(USER_DATA, 'config.json'), JSON.stringify({
  projects: [WORKSPACE, OTHER].map((path) => ({ path, name: path === WORKSPACE ? '项目A' : '项目C' })),
  activeWorkspace: WORKSPACE, permissionMode: 'default',
}))

function zip(entries) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const path = Buffer.from(name), value = Buffer.from(text), packed = deflateRawSync(value)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(value), 14); local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(value.length, 22); local.writeUInt16LE(path.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc32(value), 16); central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(value.length, 24); central.writeUInt16LE(path.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, path, packed); centrals.push(central, path)
    offset += local.length + path.length + packed.length
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
const DOCX = zip({ 'word/document.xml': '<w:document><w:p><w:r><w:t>中文 &amp; 文档</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:document>' })
const PPTX = zip({ 'ppt/slides/slide2.xml': '<a:p><a:r><a:t>第二页</a:t></a:r></a:p>', 'ppt/slides/slide1.xml': '<a:p><a:r><a:t>第一页</a:t></a:r></a:p>' })
const XLSX = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="数据表" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>中文名称</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c><c r="C1"><f>B1*2</f><v>84</v></c><c r="D1" t="inlineStr"><is><t>内联</t></is></c></row></worksheet>',
})
function pngChunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6
const pixels = Buffer.from([0, 160, 90, 50, 255, 160, 90, 50, 255, 0, 160, 90, 50, 255, 160, 90, 50, 255])
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))])
const LONG = '长文本资料\n'.repeat(2000)
const DOCUMENT_PATH = join(TEMP, '测试文档.docx')
writeFileSync(DOCUMENT_PATH, DOCX)

const MODULE = join(TEMP, 'attachments.mjs')
await build({ entryPoints: [join(ROOT, 'src/main/attachments.ts')], outfile: MODULE, bundle: true, platform: 'node', format: 'esm' })
const { AttachmentStore } = await import(pathToFileURL(MODULE))
const helpers = join(TEMP, 'helpers.mjs')
await build({ entryPoints: [join(ROOT, 'src/shared/attachments.ts')], outfile: helpers, bundle: true, platform: 'node', format: 'esm' })
const { parseAttachmentPrompt } = await import(pathToFileURL(helpers))
const store = new AttachmentStore(join(TEMP, 'unit-storage'))
const pasted = await store.add(1, WORKSPACE, '粘贴.txt', Buffer.from(LONG), true)
assert.equal(store.preview(1, WORKSPACE, pasted.id).text, LONG)
const doc = await store.fromFile(1, WORKSPACE, DOCUMENT_PATH)
assert.match(store.preview(1, WORKSPACE, doc.id).text, /中文 & 文档\n第二段/)
const slides = await store.add(1, WORKSPACE, 'slides.pptx', PPTX)
assert.match(store.preview(1, WORKSPACE, slides.id).text, /第一页[\s\S]*第二页/)
const cells = await store.add(1, WORKSPACE, '表.xlsx', XLSX)
assert.match(store.preview(1, WORKSPACE, cells.id).text, /数据表[\s\S]*A1: 中文名称[\s\S]*B1: 42[\s\S]*公式: B1\*2[\s\S]*D1: 内联/)
const image = await store.add(1, WORKSPACE, '图.png', PNG)
const pdf = await store.add(1, WORKSPACE, '文件.pdf', Buffer.from('%PDF-1.4\n%%EOF'))
const prepared = store.prepare(1, WORKSPACE, [pasted.id, doc.id, image.id, pdf.id], '请分析')
assert.equal(prepared.images.length, 1)
assert.equal(prepared.images[0].data, PNG.toString('base64'))
assert.equal(prepared.prompt.includes(LONG), false)
assert.equal(prepared.prompt.includes('content.txt'), true)
assert.deepEqual(parseAttachmentPrompt(prepared.prompt), { text: '请分析', attachments: prepared.summaries })
assert.deepEqual(parseAttachmentPrompt('普通消息'), { text: '普通消息' })
assert.deepEqual(readFileSync(DOCUMENT_PATH), DOCX)
assert.throws(() => store.prepare(2, WORKSPACE, [doc.id], ''), /凭证/)
assert.throws(() => store.prepare(1, OTHER, [doc.id], ''), /凭证/)
assert.throws(() => store.prepare(1, WORKSPACE, ['../secret'], ''), /凭证/)
assert.throws(() => store.prepare(1, WORKSPACE, Array(9).fill(doc.id), ''), /最多/)
assert.throws(() => store.prepare(1, WORKSPACE, [doc.id, doc.id], ''), /最多/)
await assert.rejects(store.add(1, WORKSPACE, '../bad.txt', Buffer.from('data')), /名称/)
await assert.rejects(store.add(1, WORKSPACE, 'fake.png', Buffer.from('not an image')), /格式/)
await assert.rejects(store.add(1, WORKSPACE, 'audio.mp3', Buffer.from('data')), /格式/)
await assert.rejects(store.add(1, WORKSPACE, 'bad.txt', Buffer.from([255, 255, 0])), /文字/)
await assert.rejects(store.add(1, WORKSPACE, 'empty.txt', Buffer.from('   ')), /文字/)
await assert.rejects(store.add(1, WORKSPACE, 'large.txt', Buffer.alloc(21 * 1024 * 1024, 65)), /20MB/)
await assert.rejects(store.add(1, WORKSPACE, 'large.png', Buffer.alloc(6 * 1024 * 1024, 65)), /5MB/)
await assert.rejects(store.add(1, WORKSPACE, 'encrypted.pdf', Buffer.from('%PDF-1.4 /Encrypt')), /加密/)
await assert.rejects(store.add(1, WORKSPACE, 'corrupt.docx', Buffer.from('bad')), /文档/)
const bomb = zip({ 'word/document.xml': 'x' })
const central = bomb.indexOf(Buffer.from([80, 75, 1, 2]))
bomb.writeUInt32LE(21 * 1024 * 1024, central + 24)
await assert.rejects(store.add(1, WORKSPACE, 'bomb.docx', bomb), /过大/)
const utf16 = await store.add(1, WORKSPACE, 'utf16.txt', Buffer.concat([Buffer.from([255, 254]), Buffer.from('中文', 'utf16le')]))
assert.equal(store.preview(1, WORKSPACE, utf16.id).text, '中文')
store.commit(1, WORKSPACE, [doc.id])
await store.remove(1, WORKSPACE, doc.id)
assert.ok(existsSync(join(TEMP, 'unit-storage', doc.id)))
await store.remove(1, WORKSPACE, pasted.id)
assert.equal(existsSync(join(TEMP, 'unit-storage', pasted.id)), false)
store.dispose()
assert.ok(existsSync(join(TEMP, 'unit-storage', doc.id)))
assert.equal(existsSync(join(TEMP, 'unit-storage', image.id)), false)
console.log('PASS 本机 Office/文本解析、原文件不变、图片/PDF、SDK 元数据往返、超限/伪造凭证/压缩炸弹及清理')

const ENTRY = join(TEMP, 'main.cjs')
await build({
  entryPoints: [join(ROOT, 'src/main/index.ts')], outfile: ENTRY,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(ENTRY).href) },
  banner: { js: `require = require('node:module').createRequire(${JSON.stringify(join(ROOT, 'package.json'))});` },
  plugins: [{ name: 'attachment-fixtures', setup(builder) {
    builder.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({ path: join(ROOT, 'scripts/fixtures/session-sdk.mjs') }))
    builder.onResolve({ filter: /^\.\/doctor\.js$/ }, () => ({ path: 'doctor', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const runDoctor = async () => ({cliFound:true,credentialsConfigured:true}); export const installCli = async () => ({ok:true,output:''});` }))
    builder.onLoad({ filter: /src[\\/]main[\\/]index\.ts$/ }, ({ path }) => ({ loader: 'ts', contents: readFileSync(path, 'utf8')
      .replace("join(__dirname, '../preload/index.mjs')", JSON.stringify(join(ROOT, 'out/preload/index.mjs')))
      .replace('sessions.send(text, sendImages, prepared.summaries, prepared.prompt)', "if (globalThis.attachmentSendFail) throw new Error('模拟发送失败'); sessions.send(text, sendImages, prepared.summaries, prepared.prompt)")
      .replace('mainWindow?.show()', 'undefined') }))
  } }],
})
const server = await createServer({ configFile: false, root: join(ROOT, 'src/renderer'), plugins: [react()], server: { host: '127.0.0.1', port: 0, fs: { allow: [ROOT] } } })
let app
try {
  console.log('检查 Electron 附件界面…')
  await server.listen()
  app = await electron.launch({ args: [ENTRY, `--user-data-dir=${USER_DATA}`], cwd: ROOT, timeout: 60_000,
    env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${server.httpServer.address().port}`, CLAUDEDECK_TEST_REPORT: REPORT, CLAUDEDECK_TEST_WORKSPACE: WORKSPACE } })
  const page = await app.firstWindow({ timeout: 60_000 })
  console.log('Electron 测试窗口已连接')
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  assert.equal(policy, "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'")
  assert.ok(readFileSync(join(ROOT, 'out/renderer/index.html'), 'utf8').includes(policy))
  const decodedImage = async (locator) => {
    const dimensions = await locator.evaluate(async (image) => {
      await image.decode()
      return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }
    })
    assert.equal(dimensions.complete, true)
    assert.ok(dimensions.width > 0 && dimensions.height > 0, '图片必须实际加载而非仅存在标签')
  }
  const input = page.locator('.composer textarea')
  const ready = () => page.waitForFunction(() => document.querySelector('.composer-wrap')?.getAttribute('aria-busy') === 'false')
  const settled = () => page.waitForFunction(() => !Array.from(document.querySelectorAll('.attachment-detail')).some((el) => el.textContent === '正在处理…'))
  const open = async (id) => { await page.locator(`.session-row[title="测试会话${id}"]`).click(); await ready() }
  const paste = async (text) => { await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), text); await input.focus(); await page.keyboard.press('Control+V') }
  const drop = async (files) => page.locator('.composer').evaluate((el, files) => {
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? '' }))
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, files)
  await ready(); await open('A')
  assert.ok(await page.locator('.attachment-add svg').evaluate((el) => el.getBoundingClientRect().width >= 14))
  console.log('会话A已准备好,检查粘贴边界')
  await paste('x'.repeat(10_000))
  assert.equal((await input.inputValue()).length, 10_000)
  assert.equal(await page.locator('.attachment-card').count(), 0)
  await input.fill('已有草稿')
  await paste(LONG)
  await page.locator('.attachment-card').waitFor(); await settled()
  assert.equal(await input.inputValue(), '已有草稿')
  await page.getByRole('button', { name: /预览 粘贴文本/ }).click()
  await page.locator('.attachment-dialog pre').waitFor()
  assert.equal(await page.locator('.attachment-dialog pre').textContent(), LONG)
  await page.keyboard.press('Tab')
  assert.equal(await page.locator('.attachment-dialog').evaluate((el) => el.contains(document.activeElement)), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.attachment-dialog').count(), 0)
  await page.getByRole('button', { name: /预览 粘贴文本/ }).click()
  await page.getByRole('button', { name: '放回输入框' }).click()
  assert.equal(await input.inputValue(), '已有草稿' + LONG)
  assert.equal(await page.locator('.attachment-card').count(), 0)
  console.log('PASS 10,000 字符边界、已有草稿不变、TXT 预览/Esc/原文还原')

  await input.fill('')
  await app.evaluate(({ clipboard, nativeImage }, bytes) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) throw new Error('测试 PNG 无法解码')
    clipboard.clear(); clipboard.writeImage(image)
  }, [...PNG])
  await input.focus(); await page.keyboard.press('Control+V')
  await page.locator('.attachment-card').waitFor(); await settled()
  assert.equal(await page.locator('.attachment-preview img').count(), 1)
  await decodedImage(page.locator('.attachment-preview img'))
  await page.locator('.attachment-remove').click()
  console.log('PASS 系统剪贴板 PNG 图片粘贴、实际解码与移除')

  const webp = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 2; canvas.height = 2
    const context = canvas.getContext('2d')
    context.fillStyle = '#a65a32'; context.fillRect(0, 0, 2, 2)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp'))
    if (!blob || blob.type !== 'image/webp') throw new Error('测试 WebP 无法编码')
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await drop([{ name: '预览测试.webp', bytes: webp }]); await settled()
  await decodedImage(page.locator('.attachment-preview img'))
  await page.getByRole('button', { name: '预览 预览测试.webp', exact: true }).click()
  await page.locator('.attachment-large-image').waitFor()
  await decodedImage(page.locator('.attachment-large-image'))
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    await page.screenshot({ path: join(TEMP, `attachment-webp-${theme}.png`) })
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.getByRole('button', { name: '关闭附件预览' }).click()
  await page.locator('.attachment-remove').click()
  console.log('PASS WebP 缩略图与大图实际解码、亮暗预览,CSP 其他权限保持不变')

  await input.fill('会话A的草稿')
  await drop([{ name: '截图.png', bytes: [...PNG] }, { name: '资料.md', bytes: [...Buffer.from('文档资料\n<script>不会执行</script>')] }])
  await settled()
  assert.equal(await page.locator('.attachment-card').count(), 2)
  await open('B')
  assert.equal(await input.inputValue(), '')
  assert.equal(await page.locator('.attachment-card').count(), 0)
  await input.fill('会话B的草稿')
  await open('A')
  assert.equal(await input.inputValue(), '会话A的草稿')
  assert.equal(await page.locator('.attachment-card').count(), 2)
  await page.getByRole('button', { name: '预览 截图.png', exact: true }).click()
  await page.locator('.attachment-large-image').waitFor()
  await decodedImage(page.locator('.attachment-large-image'))
  await page.getByRole('button', { name: '关闭附件预览' }).click()
  console.log('PASS 图片/文本拖放、图片预览与跨会话草稿隔离')

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, DOCUMENT_PATH)
  await page.getByRole('button', { name: '添加附件', exact: true }).click()
  await page.getByRole('button', { name: '预览 测试文档.docx', exact: true }).waitFor(); await settled()
  await page.getByRole('button', { name: '预览 测试文档.docx', exact: true }).click()
  await page.locator('.attachment-dialog pre').waitFor()
  assert.match(await page.locator('.attachment-dialog pre').textContent(), /中文 & 文档/)
  await page.getByRole('button', { name: '关闭附件预览' }).click()
  console.log('PASS 真实主进程文件选择桥接、DOCX 预览')

  await drop([{ name: '语音.mp3', bytes: [1, 2] }]); await settled()
  assert.ok(await page.locator('.attachment-file-error').filter({ hasText: '不支持' }).count())
  assert.equal(await page.locator('.composer [data-state="send"]').isDisabled(), true)
  await page.getByRole('button', { name: '移除 语音.mp3', exact: true }).click()
  await app.evaluate(() => { globalThis.attachmentSendFail = true })
  await page.locator('.composer [data-state="send"]').click()
  await page.locator('.error-line').filter({ hasText: '模拟发送失败' }).waitFor()
  assert.equal(await input.inputValue(), '会话A的草稿')
  assert.equal(await page.locator('.attachment-card').count(), 3)
  await app.evaluate(() => { globalThis.attachmentSendFail = false })
  console.log('PASS 不支持格式错误、禁发与发送失败保留全部草稿')

  await input.fill('')
  await page.locator('.composer [data-state="send"]').click()
  await page.waitForFunction(() => document.querySelectorAll('.message-attachment').length === 3)
  const sdkMessage = await app.evaluate(() => globalThis.sessionFixture.instances.findLast((q) => q.id === 'A').messages.at(-1))
  assert.equal(sdkMessage.origin.kind, 'human')
  assert.equal(sdkMessage.message.content.filter((b) => b.type === 'image').length, 1)
  const prompt = sdkMessage.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  assert.equal(parseAttachmentPrompt(prompt).attachments.length, 3)
  assert.equal(await page.locator('.msg-user').last().textContent().then((text) => text.includes('不会执行')), false)
  assert.equal(await page.locator('.attachment-card').count(), 0)
  await app.evaluate((_electron, message) => {
    const fixtures = globalThis.sessionFixture
    fixtures.history = { A: [{ uuid: 'attachment-message', message: message.message }] }
    fixtures.instances.findLast((q) => q.id === 'A').push({ type: 'result', subtype: 'success' })
  }, sdkMessage)
  await open('B'); await open('A')
  assert.equal(await page.locator('.message-attachment').count(), 3)
  assert.equal(await page.locator('.msg-user').last().textContent().then((text) => text.includes('<claudedeck-attachments')), false)
  await page.evaluate(() => window.api.sessions.remove('A'))
  await page.locator('.project-row[aria-current="true"]').hover()
  await page.locator('.project-row[aria-current="true"] ~ .project-add').click(); await ready()
  await open('A')
  assert.equal(await page.locator('.message-attachment').count(), 3)
  console.log('PASS 纯附件发送、原生 image block、origin、后台恢复与 SDK 历史附件还原')

  const longName = '很长的文件名称'.repeat(15) + '.txt'
  await drop([{ name: longName, bytes: [...Buffer.from('内容')] }]); await settled()
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [940, 1200, 1600]) {
      await page.setViewportSize({ width, height: 800 })
      assert.equal(await page.locator('.composer').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true)
      assert.equal(await page.locator('.attachment-cards').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true)
      assert.ok(await page.locator('.attachment-add svg').evaluate((el) => el.getBoundingClientRect().width >= 14))
    }
    await page.screenshot({ path: join(TEMP, `attachments-${theme}.png`) })
  }
  await page.locator('.composer').evaluate((el) => { el.style.width = '360px' })
  assert.equal(await page.locator('.composer').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true)
  assert.deepEqual(errors, [])
  console.log('PASS 亮暗主题与 940/1200/1600px 无横向溢出,页面无异常')
} catch (err) {
  if (app) {
    const page = await app.firstWindow()
    await page.screenshot({ path: join(TEMP, 'failure.png') }).catch(() => {})
    console.error(await page.locator('body').innerText().catch(() => '页面不可读取'))
  }
  throw err
} finally { await app?.close(); await server.close() }
console.log(`附件回归完成,临时目录:${TEMP}`)
