// ============================================================
//  Bo cong cu e2e: mo Electron that (ban build trong dist/) voi userData rieng,
//  dieu khien qua Chrome DevTools Protocol (chuot that, keo tha that, doc DOM).
//  Khong them dependency: dung WebSocket co san cua Node 22.
// ============================================================
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const repo = path.resolve(__dirname, '..')
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function ffmpeg(args) {
  const r = spawnSync(ffmpegPath, ['-y', '-v', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
}
function probeStreams(file) {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  return String(r.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}
/** Muc am luong RMS (0..1) cua doan [start, start+0.2s] trong file audio/video. */
function rmsAt(file, start, duration = 0.2) {
  const r = spawnSync(ffmpegPath, ['-v', 'error', '-ss', String(start), '-t', String(duration), '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'])
  if (r.status !== 0 || !r.stdout?.length) return 0
  let sum = 0, count = 0
  for (let i = 0; i + 1 < r.stdout.length; i += 2) { const n = r.stdout.readInt16LE(i) / 32768; sum += n * n; count++ }
  return count ? Math.sqrt(sum / count) : 0
}
/** RMS cua mot kenh (0 = trai, 1 = phai) trong khoang [start, start + duration] giay. */
function channelRmsAt(file, channel, start, duration = 0.5) {
  const r = spawnSync(ffmpegPath, ['-v', 'error', '-ss', String(start), '-t', String(duration), '-i', file, '-vn', '-af', `pan=mono|c0=c${channel}`, '-ar', '8000', '-f', 's16le', 'pipe:1'])
  if (r.status !== 0 || !r.stdout?.length) return 0
  let sum = 0, count = 0
  for (let i = 0; i + 1 < r.stdout.length; i += 2) { const n = r.stdout.readInt16LE(i) / 32768; sum += n * n; count++ }
  return count ? Math.sqrt(sum / count) : 0
}
/** Mau [r,g,b] cua mot diem anh tai thoi diem t (giay) cua file video. */
function pixelAt(file, x, y, t = 1) {
  const r = spawnSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return r.status === 0 && r.stdout?.length >= 3 ? [...r.stdout.subarray(0, 3)] : []
}
function probeDuration(file) {
  const r = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  return Number(String(r.stdout).trim())
}

/** Sinh bo media nho dung chung cho cac kich ban (khong luu vao git). */
function makeFixtures() {
  const dir = path.join(repo, '.testout', 'e2e')
  fs.mkdirSync(dir, { recursive: true })
  const f = (name) => path.join(dir, name)
  const once = (name, args) => { if (!fs.existsSync(f(name))) ffmpeg([...args, f(name)]) }
  const v264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30']
  once('video-a.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=5:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', ...v264, '-c:a', 'aac', '-shortest'])
  once('video-b.mp4', ['-f', 'lavfi', '-i', 'testsrc2=duration=4:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4', ...v264, '-c:a', 'aac', '-shortest'])
  once('video-silent.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=30', ...v264])
  once('image.png', ['-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1'])
  once('tone-a.wav', ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=3'])
  once('tone-b.wav', ['-f', 'lavfi', '-i', 'sine=frequency=500:duration=3'])
  const norm = (name) => f(name).replace(/\\/g, '/')
  return { dir, videoA: norm('video-a.mp4'), videoB: norm('video-b.mp4'), videoSilent: norm('video-silent.mp4'), image: norm('image.png'), toneA: norm('tone-a.wav'), toneB: norm('tone-b.wav') }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (error) { reject(error) } })
    }).on('error', reject)
  })
}

let nextPort = 9300 + Math.floor(Math.random() * 400)

/**
 * Mo app. options:
 *  project  - project v4/v5 de dat san vao thu muc recovery (app se de nghi khoi phuc)
 *  dialogs  - map kenh hop thoai -> gia tri tra ve (TAOCLIP_E2E_DIALOGS, xem electron/main.cjs)
 */
async function launchApp({ project = null, dialogs = {} } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-e2e-'))
  if (project) require(path.join(repo, 'electron', 'recovery-store.cjs')).writeRecovery(path.join(userData, 'recovery'), project)
  const port = nextPort++
  const env = { ...process.env, TAOCLIP_E2E_DIALOGS: JSON.stringify(dialogs) }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_ENV
  const child = spawn(path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [repo, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { env, stdio: 'ignore' })
  const app = new App(child, userData, port)
  await app.connect()
  return app
}

class App {
  constructor(child, userData, port) {
    this.child = child; this.userData = userData; this.port = port
    this.errors = []; this.mediaResponses = []; this.seq = 0; this.pending = new Map()
  }

  async connect() {
    let target
    for (let i = 0; i < 80 && !target; i++) {
      await sleep(400)
      try { target = (await getJson(`http://127.0.0.1:${this.port}/json`)).find((t) => t.type === 'page' && /index\.html/.test(t.url)) } catch {}
    }
    if (!target) throw new Error('Khong ket noi duoc cua so Electron (CDP)')
    this.ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject })
    this.ws.onmessage = (message) => {
      const data = JSON.parse(message.data)
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id); this.pending.delete(data.id)
        if (data.error) reject(new Error(data.error.message)); else resolve(data.result)
      } else if (data.method === 'Network.responseReceived' && String(data.params.response.url).startsWith('taoclip-media://')) {
        const h = Object.fromEntries(Object.entries(data.params.response.headers).map(([k, v]) => [k.toLowerCase(), v]))
        this.mediaResponses.push({ url: data.params.response.url, status: data.params.response.status, contentRange: h['content-range'], acceptRanges: h['accept-ranges'], type: data.params.response.mimeType })
      } else if (data.method === 'Runtime.exceptionThrown') {
        const detail = data.params.exceptionDetails
        this.errors.push(detail.exception?.description || detail.text)
      } else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
        this.errors.push(data.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
      }
    }
    await this.send('Runtime.enable')
    await this.send('Page.enable')
    await this.send('Network.enable')
  }

  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Chay bieu thuc/IIFE trong trang va tra gia tri (await promise). Nem loi neu trang nem loi. */
  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }

  async waitFor(expression, { timeout = 15000, interval = 150, label = expression } = {}) {
    const start = Date.now()
    let last
    while (Date.now() - start < timeout) {
      try { last = await this.eval(expression); if (last) return last } catch (error) { last = error.message }
      await sleep(interval)
    }
    throw new Error(`Het gio cho: ${label} (gia tri cuoi: ${JSON.stringify(last)})`)
  }

  rect(selector, index = 0) {
    return this.eval(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const box = el.closest('.cc-tlscroll'); if (box) { const limit = box.getBoundingClientRect().top + 70; const now = el.getBoundingClientRect(); if (now.top < limit) box.scrollTop -= limit - now.top } const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  }
  async center(selector, index = 0) {
    const r = await this.rect(selector, index)
    if (!r) throw new Error('Khong thay phan tu: ' + selector)
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }
  mouse(type, x, y, extra = {}) {
    return this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1, ...extra })
  }
  async click(selector, index = 0) {
    const { x, y } = await this.center(selector, index)
    await this.mouse('mouseMoved', x, y); await this.mouse('mousePressed', x, y); await this.mouse('mouseReleased', x, y)
  }
  async rightClick(selector, index = 0) {
    const { x, y } = await this.center(selector, index)
    await this.mouse('mouseMoved', x, y)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
  }
  /** Mo menu chuot phai tren phan tu va bam muc co `data-ctx` = id (menu dong lai sau khi chon). */
  async menu(selector, index, ctxId) {
    await this.rightClick(selector, index)
    await this.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu chuot phai' })
    await this.click(`.cc-ctxmenu [data-ctx="${ctxId}"]`)
    await this.waitFor(`!document.querySelector('.cc-ctxmenu')`, { label: 'menu dong' })
  }
  /** Bam vao thuoc thoi gian tai thoi diem t (giay): dat dau phat. */
  async seekTo(t, pps = 80) {
    // Khong dung rect() (no cuon timeline): tinh x tu vi tri cuon hien tai, tru cot tieu de dinh o ben trai
    const point = await this.eval(`(() => { const scroller = document.querySelector('.cc-tlscroll'); scroller.scrollLeft = 0; const box = scroller.getBoundingClientRect(); const ruler = document.querySelector('.cc-ruler').getBoundingClientRect(); return { x: Math.round(box.left + 96 + ${t} * ${pps} - scroller.scrollLeft), y: Math.round(ruler.top + ruler.height / 2) } })()`)
    await this.mouse('mouseMoved', point.x, point.y); await this.mouse('mousePressed', point.x, point.y); await this.mouse('mouseReleased', point.x, point.y)
    const shown = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
    await this.waitFor(`(document.querySelector('.cc-tlbar .cur')?.innerText || '').startsWith(${JSON.stringify(shown)})`, { label: `dau phat ${shown}`, timeout: 6000 })
  }
  /** Bam phan tu dau tien khop selector va co chua `text` (chuot that). */
  async clickText(selector, text) {
    const index = await this.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].findIndex((el) => el.textContent.includes(${JSON.stringify(text)}))`)
    if (index < 0) throw new Error(`Khong thay '${text}' trong ${selector}`)
    await this.click(selector, index)
  }
  async dragBy(from, to, steps = 8) {
    await this.mouse('mouseMoved', from.x, from.y); await this.mouse('mousePressed', from.x, from.y)
    for (let i = 1; i <= steps; i++) await this.mouse('mouseMoved', Math.round(from.x + (to.x - from.x) * i / steps), Math.round(from.y + (to.y - from.y) * i / steps))
    await this.mouse('mouseReleased', to.x, to.y)
  }
  async key(key, modifiers = 0) {
    const code = key.length === 1 ? 'Key' + key.toUpperCase() : key
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, text: key.length === 1 && !modifiers ? key : undefined })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers })
  }

  /** Tha file tu he dieu hanh (duong dan that) vao toa do x,y. */
  async dropFiles(files, x, y) {
    const data = { items: [], files, dragOperationsMask: 1 }
    await this.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data })
    await this.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data })
    await this.send('Input.dispatchDragEvent', { type: 'drop', x, y, data })
  }

  /**
   * Tha file (duong dan that) hoac asset thu vien vao mot lane: ban dragEnter/dragOver o giua cua so de cac vung "tao track moi" hien ra,
   * roi tha tai thoi diem `time` (giay) cua lane `rowSelector` (hoac tai tam phan tu neu rowSelector la vung tao track).
   */
  async dropOnLane({ files = [], assets = [], row, time = 0, pps = 80 }) {
    const items = assets.map((asset) => ({ mimeType: 'application/x-taoclip-asset', data: JSON.stringify(asset) }))
    const data = { items, files, dragOperationsMask: 1 }
    await this.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 640, y: 300, data })
    await this.send('Input.dispatchDragEvent', { type: 'dragOver', x: 640, y: 300, data })
    await sleep(250)
    const lane = await this.rect(`${row} .cc-tlane`) || await this.rect(row)
    if (!lane) throw new Error('Khong thay lane: ' + row)
    const x = Math.round(row.includes('data-newtrack') ? lane.x + lane.width / 2 : lane.x + time * pps)
    const y = Math.round(lane.y + lane.height / 2)
    await this.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data })
    await this.send('Input.dispatchDragEvent', { type: 'drop', x, y, data })
  }

  /** Bang thuoc tinh chia tab: bat tab chua o data-prop = name (giu nguyen neu o do dang hien). Tra ve true neu tim thay. */
  async reveal(name) {
    const selector = `.cc-insp [data-prop="${name}"]`
    if (await this.count(selector)) return true
    const tabs = await this.count('.cc-insp [data-tab]')
    for (let i = 0; i < tabs; i++) {
      await this.click('.cc-insp [data-tab]', i)
      await sleep(80)
      if (await this.count(selector)) return true
    }
    return false
  }
  hasProp(name) { return this.reveal(name) }

  /** Cac thao tac doc nhanh trang thai app. */
  text(selector) { return this.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`) }
  count(selector) { return this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`) }

  async restoreProject() {
    await this.waitFor(`!!document.querySelector('.cc-recover')`, { label: 'banner khoi phuc' })
    await this.click('.cc-recover .cc-export')
    await this.waitFor(`document.querySelectorAll('.cc-clip').length > 0`, { label: 'clip tren timeline' })
    // Tua truoc khi video xem truoc nap xong se bi su kien timeupdate ghi de, nen cho video san sang (neu clip dau la video)
    await this.waitFor(`(() => { const v = document.querySelector('.cc-frame video'); return !v || v.readyState >= 2 })()`, { label: 'video xem truoc san sang', timeout: 20000 })
  }

  close() {
    try { this.ws?.close() } catch {}
    try { spawnSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F']) } catch {}
    try { fs.rmSync(this.userData, { recursive: true, force: true }) } catch {}
  }
}

/** Project v4 toi thieu tro toi cac file fixture. */
function projectOf(fixtures, extra = {}) {
  return {
    version: 4, projectId: 'e2e-' + Math.random().toString(36).slice(2), name: 'E2E',
    clips: [
      { id: 'c1', path: fixtures.videoA, name: 'video-a.mp4', kind: 'video', in: 0, out: 5, speed: 1 },
      { id: 'c2', path: fixtures.videoB, name: 'video-b.mp4', kind: 'video', in: 0, out: 4, speed: 1 }
    ],
    ...extra
  }
}

module.exports = { repo, sleep, ffmpeg, probeDuration, probeStreams, pixelAt, rmsAt, channelRmsAt, makeFixtures, launchApp, projectOf }
