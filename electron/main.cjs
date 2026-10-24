const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { Readable } = require('stream')

// Media/thumbnail cuc bo duoc phuc vu qua taoclip-media:// thay vi file://.
// Khi chay dev, trang la http://localhost:5173 nen Chromium chan nap file:// ("Media load rejected by URL safety check");
// giao thuc rieng nay chay giong nhau o dev va ban dong goi. Phai dang ky truoc khi app ready.
const MEDIA_SCHEME = 'taoclip-media'
const MEDIA_EXT = /\.(mp4|mov|mkv|avi|webm|m4v|ts|mp3|wav|m4a|aac|ogg|flac|wma|jpe?g|png|webp|bmp|gif)$/i
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

const MEDIA_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif'
}

// Phuc vu file cuc bo co ho tro HTTP Range (206 + Content-Range) de the <video>/<audio> tua duoc tren file lon
function registerMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1))
      if (!path.isAbsolute(filePath) || !MEDIA_EXT.test(filePath)) return new Response('Forbidden', { status: 403 })
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) return new Response('Not found', { status: 404 })
      const size = stat.size
      const headers = { 'Content-Type': MEDIA_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' }
      if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '')
      let start = 0, end = size - 1, status = 200
      if (match && (match[1] || match[2])) {
        if (match[1] === '') start = Math.max(0, size - Number(match[2])) // "bytes=-N": N byte cuoi
        else { start = Number(match[1]); if (match[2]) end = Math.min(size - 1, Number(match[2])) }
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        status = 206
      }
      headers['Content-Length'] = String(end - start + 1)
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), { status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

// Kiem thu e2e (e2e/lib.cjs): TAOCLIP_E2E_DIALOGS la JSON {kenh: gia tri tra ve} de bo qua hop thoai he dieu hanh
const E2E_DIALOGS = (() => { try { return JSON.parse(process.env.TAOCLIP_E2E_DIALOGS || '{}') } catch { return {} } })()
const e2eDialog = (name) => (Object.prototype.hasOwnProperty.call(E2E_DIALOGS, name) ? { value: E2E_DIALOGS[name] } : null)

// --- FFmpeg / FFprobe (dong goi san, khong can cai he thong) ---
const os = require('os')
const ops = require('./ffmpeg-ops.cjs')
const caps = require('./captions.cjs')
const projectStore = require('./project-store.cjs')
const portableProject = require('./portable-project.cjs')
const outputStore = require('./output-store.cjs')
const recoveryStore = require('./recovery-store.cjs')
const settingsStore = require('./settings.cjs')
const stickers = require('./stickers.cjs')
const logoLibrary = require('./logo-library.cjs')
// Mau logo co san: dev doc tu src/renderer/public, ban dong goi doc tu dist (nam trong asar, fs van doc duoc)
logoLibrary.configure(app.getPath('userData'), app.isPackaged
  ? path.join(__dirname, '..', 'dist', 'logos', 'presets')
  : path.join(__dirname, '..', 'src', 'renderer', 'public', 'logos', 'presets'))
settingsStore.configure({ app, safeStorage })
const PREVIEW_PROXY_JOBS = new Map()
const DOWNLOAD_JOBS = new Map()
const TTS_JOBS = new Map()
let ffmpegPath = require('ffmpeg-static')
let ffprobePath = require('ffprobe-static').path

// Khi dong goi production, binary nam trong app.asar.unpacked
ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked')
ops.configure(ffmpegPath, ffprobePath)

const isDev = process.env.NODE_ENV === 'development'
let gpuEncoder = 'cpu' // tu do khi app san sang

// Thu muc cache model transformers.js (Whisper/TTS) - PHAI ghi duoc.
// Mac dinh transformers ghi vao node_modules/.../.cache => trong app.asar (file) => ENOTDIR.
const tfCacheDir = () => path.join(app.getPath('userData'), 'ai-models')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: 'TaoClip',
    // Windows: bo thanh tieu de trang mac dinh, header toi cua app tu lam thanh tieu de; nut thu/phong/dong la overlay
    // Overlay bat dau tu dong 1 cua so (do do sat tren) nen cao 46 thay vi 48 de khong che duong vien duoi header (.cc-top 48px, border-bottom 1px)
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#16161a', symbolColor: '#f2f3f5', height: 46 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Bo menu mac dinh (File/Edit/View...) - app tu co UI rieng
  win.removeMenu()

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
    // Khong con menu nen tu gan phim tat DevTools / Reload khi dev
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        win.webContents.toggleDevTools()
      } else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
        win.webContents.reload()
      }
    })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  registerMediaProtocol()
  createWindow()
  ops.detectBestEncoder().then((e) => { gpuEncoder = e }).catch(() => {})
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Cho UI biet encoder GPU kha dung
ipcMain.handle('system:encoder', () => gpuEncoder)

// Mo Explorer va chon san file (sau khi xuat / luu du an)
ipcMain.handle('shell:showInFolder', (_e, p) => { shell.showItemInFolder(path.resolve(p)) })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------- IPC: thao tac file & video ----------------

// Chon file video
ipcMain.handle('dialog:openVideo', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Chon video',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] }]
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
})

// Lay metadata video (thoi luong, do phan giai...)
ipcMain.handle('video:probe', async (_e, filePath) => {
  return ops.probe(filePath)
})
ipcMain.handle('media:inspect', async (_e, filePath) => ops.inspectMedia(filePath))
ipcMain.handle('video:filterPreview', async (_e, request) => {
  if (!request || typeof request.input !== 'string' || !fs.existsSync(request.input)) throw new Error('Tệp nguồn filter không tồn tại.')
  const folder = path.join(app.getPath('temp'), 'taoclip-filter-preview')
  await fs.promises.mkdir(folder, { recursive: true })
  const output = path.join(folder, `frame-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  try {
    await ops.renderFilterPreview({ input: request.input, time: request.time, filterKey: request.filterKey, intensity: request.intensity, output })
    return `data:image/png;base64,${(await fs.promises.readFile(output)).toString('base64')}`
  } finally { try { await fs.promises.rm(output, { force: true }) } catch {} }
})
ipcMain.handle('video:createPreviewProxy', async (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Đường dẫn media không hợp lệ.')
  const source = path.resolve(filePath)
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Không tìm thấy media nguồn để tạo proxy.')
  const info = await ops.probe(source)
  if (!info.hasVideo) throw new Error('Media nguồn không có luồng hình để tạo proxy.')
  const fingerprint = ops.previewProxyFingerprint(source)
  const cacheDir = path.join(app.getPath('userData'), 'preview-proxies')
  const output = path.join(cacheDir, `${fingerprint}.mp4`)
  try { if (fs.statSync(output).size > 0) return output } catch {}
  if (PREVIEW_PROXY_JOBS.has(fingerprint)) return PREVIEW_PROXY_JOBS.get(fingerprint)
  const job = (async () => {
    fs.mkdirSync(cacheDir, { recursive: true })
    const stage = path.join(cacheDir, `${fingerprint}.${process.pid}.${Date.now()}.stage.mp4`)
    try {
      await ops.createPreviewProxy(source, stage)
      try { fs.renameSync(stage, output) } catch (error) {
        if (!fs.existsSync(output)) throw error
        fs.rmSync(stage, { force: true })
      }
      return output
    } finally { try { fs.rmSync(stage, { force: true }) } catch {} }
  })().finally(() => PREVIEW_PROXY_JOBS.delete(fingerprint))
  PREVIEW_PROXY_JOBS.set(fingerprint, job)
  return job
})

// Tao dai thumbnail cho timeline
ipcMain.handle('video:thumbnails', async (_e, filePath, count) => {
  return ops.generateThumbnails(filePath, count || 12)
})

ipcMain.handle('video:prioritizeCache', (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return false
  ops.prioritizeCache(filePath)
  return true
})

// Tao anh waveform (dang song am thanh) cho timeline
ipcMain.handle('video:waveform', async (_e, filePath) => {
  try { return await ops.generateWaveform(filePath) } catch (e) { return null }
})

// Phat hien khoang lang -> tra ve cac doan giu lai + thong ke
ipcMain.handle('video:detectSilence', async (_e, filePath, opts) => {
  const info = await ops.probe(filePath)
  if (!info.hasAudio) throw new Error('Clip này không có track âm thanh để phân tích im lặng.')
  const threshold = Number(String(opts?.noise ?? '-30dB').replace(/dB$/i, ''))
  const minSilence = Number(opts?.minSilence ?? 0.4), pad = Number(opts?.pad ?? 0.06)
  if (!Number.isFinite(threshold) || threshold < -60 || threshold > -10 || !Number.isFinite(minSilence) || minSilence < 0.1 || minSilence > 5 || !Number.isFinite(pad) || pad < 0 || pad > 1) {
    throw new Error('Cấu hình phân tích im lặng không hợp lệ.')
  }
  const options = { noise: `${threshold}dB`, minSilence, pad }
  const detected = await ops.detectSilence(filePath, options)
  const silences = detected.map((silence) => ({ ...silence, end: silence.end == null ? info.duration : silence.end }))
  const keep = ops.computeKeep(info.duration, silences, options.pad)
  const kept = keep.reduce((a, s) => a + (s.end - s.start), 0)
  return { keep, silences, removed: silences.length, saved: Math.max(0, info.duration - kept), kept, duration: info.duration, options }
})

// Tao phu de tu dong bang Whisper (local). opts.clips -> ca timeline; nguoc lai 1 file
ipcMain.handle('captions:generate', async (event, filePath, opts) => {
  const whisper = require('./whisper.cjs') // nap muon (transformers nang)
  whisper.configure(tfCacheDir())
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-cap-'))
  try {
    const wav = path.join(tmpDir, 'a.wav')
    event.sender.send('captions:progress', { phase: 'audio' })
    if (opts?.audioSource === 'voice') {
      await ops.buildVoiceSourceWav({ tracks: opts.audioItems || [], totalDuration: opts.totalDuration, output: wav })
    } else if (opts?.clips?.length) await ops.buildTimelineAudioWav(opts.clips, wav, opts.editPlan)
    else await ops.extractAudioWav(filePath, wav)
    const segs = await whisper.transcribe(wav, {
      language: opts && Object.prototype.hasOwnProperty.call(opts, 'language') ? opts.language : 'vietnamese',
      model: (opts && opts.model) || 'Xenova/whisper-base',
      onStatus: (s) => event.sender.send('captions:progress', s)
    })
    event.sender.send('captions:progress', { phase: 'done' })
    return segs
  } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
})

// Freeze frame: khung hinh day du kich thuoc tai thoi diem nguon -> PNG trong userData (cache theo file + thoi diem)
ipcMain.handle('video:freezeFrame', async (_event, filePath, time) => {
  const input = String(filePath || '')
  const t = Number(time)
  if (!input || !fs.existsSync(input) || !Number.isFinite(t) || t < 0) throw new Error('Tham so freeze frame khong hop le.')
  const dir = path.join(app.getPath('userData'), 'generated', 'freeze')
  fs.mkdirSync(dir, { recursive: true })
  const stat = fs.statSync(input)
  const key = crypto.createHash('sha256').update(`${path.resolve(input)}|${stat.size}|${stat.mtimeMs}|${t.toFixed(3)}`).digest('hex').slice(0, 24)
  const output = path.join(dir, `${key}.png`)
  if (!fs.existsSync(output) || fs.statSync(output).size <= 0) await ops.extractFullFrame(input, t, output)
  return output
})

// Luu am thanh cua mot doan (clip / item) thanh WAV / MP3 / M4A
ipcMain.handle('audio:saveAs', async (_event, request) => {
  const input = String(request?.input || '')
  if (!input || !fs.existsSync(input)) throw new Error('Khong tim thay file nguon.')
  const start = Number(request?.start) || 0
  const end = request?.end == null ? null : Number(request.end)
  const speed = Number(request?.speed) > 0 ? Number(request.speed) : 1
  const stub = e2eDialog('saveAudio')
  let target
  if (stub) target = stub.value
  else {
    const res = await dialog.showSaveDialog({
      title: 'Lưu âm thanh', defaultPath: String(request?.defaultName || 'audio.wav'),
      filters: [{ name: 'WAV', extensions: ['wav'] }, { name: 'MP3', extensions: ['mp3'] }, { name: 'M4A (AAC)', extensions: ['m4a'] }]
    })
    target = res.canceled ? null : res.filePath
  }
  if (!target) return null
  if (path.resolve(target).toLowerCase() === path.resolve(input).toLowerCase()) throw new Error('Không thể ghi đè file nguồn.')
  await ops.saveAudioRange({ input, start, end, speed, output: target })
  return target
})

// Chon noi luu file xuat
ipcMain.handle('dialog:saveVideo', async (_e, defaultName) => {
  const stub = e2eDialog('saveVideo'); if (stub) return stub.value
  const res = await dialog.showSaveDialog({
    title: 'Luu video',
    defaultPath: defaultName || 'taoclip-export.mp4',
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  })
  if (res.canceled || !res.filePath) return null
  return res.filePath
})

ipcMain.handle('captions:saveSrt', async (_e, captions) => {
  const res = await dialog.showSaveDialog({ title: 'Xuất phụ đề SRT', defaultPath: 'taoclip-captions.srt', filters: [{ name: 'SubRip', extensions: ['srt'] }] })
  if (res.canceled || !res.filePath) return null
  const data = caps.toSrt(Array.isArray(captions) ? captions : [])
  const temp = `${res.filePath}.${process.pid}.tmp`
  const backup = `${res.filePath}.${process.pid}.bak`
  let movedOld = false
  try {
    fs.writeFileSync(temp, data, 'utf8')
    if (fs.existsSync(res.filePath)) { fs.renameSync(res.filePath, backup); movedOld = true }
    fs.renameSync(temp, res.filePath)
    if (movedOld) fs.rmSync(backup, { force: true })
  } catch (error) {
    try { fs.rmSync(temp, { force: true }) } catch {}
    if (movedOld && !fs.existsSync(res.filePath)) { try { fs.renameSync(backup, res.filePath) } catch {} }
    throw error
  }
  return res.filePath
})

ipcMain.handle('captions:openSrt', async () => {
  const res = await dialog.showOpenDialog({ title: 'Nhập phụ đề SRT', properties: ['openFile'], filters: [{ name: 'SubRip', extensions: ['srt'] }] })
  if (res.canceled || !res.filePaths.length) return null
  const file = res.filePaths[0]
  const stat = fs.statSync(file)
  if (stat.size > 10 * 1024 * 1024) throw new Error('Tệp SRT vượt quá 10 MB.')
  return { filePath: file, captions: caps.parseSrt(fs.readFileSync(file, 'utf8')) }
})

// Chon file am thanh (nhac nen)
ipcMain.handle('dialog:openAudio', async () => {
  const stub = e2eDialog('openAudio'); if (stub) return stub.value
  const res = await dialog.showOpenDialog({
    title: 'Chon nhac nen',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
})
ipcMain.handle('dialog:openAudioFiles', async () => {
  const stub = e2eDialog('openAudioFiles'); if (stub) return stub.value
  const res = await dialog.showOpenDialog({ title: 'Chọn các đoạn âm thanh', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }] })
  return res.canceled ? [] : res.filePaths
})

// Long tieng AI (TTS) -> tao file audio giu lai trong phien.
// opts.engine: 'local' (mms-tts-vie, offline) | 'google' (Google Cloud TTS)
ipcMain.handle('tts:modelStatus', async () => {
  const tts = require('./tts.cjs')
  return tts.getModelStatus(path.join(app.getPath('userData'), 'models', 'transformers'))
})

ipcMain.handle('tts:generate', async (event, text, opts = {}) => {
  const engine = opts.engine === 'google' ? 'google' : 'local'
  const sourceText = String(text || '').trim()
  if (!sourceText) throw new Error('Nhập nội dung cần đọc.')
  if (sourceText.length > 50000) throw new Error('TTS giới hạn 50.000 ký tự cho mỗi lượt.')
  const key = engine === 'google' ? settingsStore.getApiKey() : ''
  if (engine === 'google' && !key) throw new Error('Chưa cấu hình Google API key trong phiên này.')
  const config = { engine, voice: opts.voice || '', langCode: opts.langCode || 'vi-VN', rate: Number(opts.rate ?? 1), pitch: Number(opts.pitch ?? 0),
    keyFingerprint: key ? crypto.createHash('sha256').update(key).digest('hex') : '' }
  if (engine === 'google' && (!config.voice || config.rate < 0.25 || config.rate > 2 || config.pitch < -20 || config.pitch > 20)) {
    throw new Error('Cấu hình Google TTS không hợp lệ.')
  }
  const cacheKey = crypto.createHash('sha256').update(JSON.stringify({ text: sourceText, ...config })).digest('hex')
  if (TTS_JOBS.has(cacheKey)) return TTS_JOBS.get(cacheKey)
  const work = (async () => {
    const dir = path.join(app.getPath('userData'), 'generated', 'tts')
    fs.mkdirSync(dir, { recursive: true })
    const output = path.join(dir, `${cacheKey}.${engine === 'google' ? 'mp3' : 'wav'}`)
    if (fs.existsSync(output)) {
      try {
        const info = await ops.probe(output)
        if (info.hasAudio && info.duration > 0) {
          event.sender.send('tts:progress', { phase: 'cached' })
          return { path: output, duration: info.duration, cached: true }
        }
      } catch {}
      try { fs.rmSync(output, { force: true }) } catch {}
    }
    const tempDir = fs.mkdtempSync(path.join(dir, '.job-'))
    const staged = path.join(tempDir, `asset.${engine === 'google' ? 'mp3' : 'wav'}`)
    try {
      if (engine === 'google') {
        const g = require('./tts-google.cjs'), splitter = require('./tts-text.cjs')
        const chunks = splitter.splitGoogleText(sourceText)
        const files = []
        for (let i = 0; i < chunks.length; i++) {
          event.sender.send('tts:progress', { phase: 'chunk', index: i + 1, total: chunks.length })
          const part = path.join(tempDir, `part-${i}.mp3`)
          await g.synthesize(chunks[i].trim(), part, { apiKey: key, voiceName: config.voice, langCode: config.langCode, rate: config.rate, pitch: config.pitch })
          files.push(part)
        }
        if (files.length === 1) fs.copyFileSync(files[0], staged)
        else await ops.concatAudioFiles({ inputs: files, output: staged })
      } else {
        const tts = require('./tts.cjs')
        await tts.synthesize(sourceText, staged, { modelCacheDir: path.join(app.getPath('userData'), 'models', 'transformers'),
          onStatus: (status) => event.sender.send('tts:progress', status) })
      }
      const info = await ops.probe(staged)
      if (!info.hasAudio || !Number.isFinite(info.duration) || info.duration <= 0) throw new Error('TTS chưa tạo được audio hợp lệ.')
      fs.renameSync(staged, output)
      event.sender.send('tts:progress', { phase: 'done' })
      return { path: output, duration: info.duration, cached: false }
    } finally { try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {} }
  })()
  TTS_JOBS.set(cacheKey, work)
  try { return await work } finally { TTS_JOBS.delete(cacheKey) }
})

// Doi giong video (re-dub): TTS tung cau phu de -> ghep 1 track long tieng khop timeline.
// payload: { segments:[{start,end,text}] (thoi gian OUTPUT), totalDur, tts:{engine,voice,rate,pitch,langCode} }
ipcMain.handle('redub:generate', async (event, payload) => {
  const { segments = [], totalDur = 0, tts: ttsCfg = {} } = payload || {}
  const segs = segments
    .filter((s) => s.text && s.text.trim() && s.end - s.start > 0.05)
    .sort((a, b) => a.start - b.start)
  if (!segs.length) throw new Error('Khong co cau nao de doc')
  if (!(totalDur > 0)) throw new Error('Thieu thoi luong timeline')
  const send = (s) => event.sender.send('redub:progress', s)
  const outDir = path.join(os.tmpdir(), 'taoclip-tts')
  fs.mkdirSync(outDir, { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-redub-'))
  try {
    let g = null, key = null, ttsLocal = null
    if (ttsCfg.engine === 'google') {
      g = require('./tts-google.cjs')
      key = require('./settings.cjs').getApiKey()
      if (!key) throw new Error('Chua cau hinh Google API key')
    } else {
      ttsLocal = require('./tts.cjs')
    }
    const parts = []
    for (let i = 0; i < segs.length; i++) {
      send({ phase: 'tts', done: i, total: segs.length })
      const s = segs[i]
      const f = path.join(tmpDir, `seg${i}.` + (g ? 'mp3' : 'wav'))
      if (s.audioPath) {
        const assetRoot = path.resolve(app.getPath('userData'), 'generated', 'tts') + path.sep
        const assetPath = path.resolve(String(s.audioPath))
        if (!assetPath.startsWith(assetRoot) || !fs.existsSync(assetPath)) throw new Error(`Audio câu ${i + 1} không còn tồn tại trong kho TTS.`)
        fs.copyFileSync(assetPath, f)
      } else if (g) await g.synthesize(s.text, f, { apiKey: key, voiceName: ttsCfg.voice, langCode: ttsCfg.langCode || 'vi-VN', rate: ttsCfg.rate ?? 1, pitch: ttsCfg.pitch ?? 0 })
      else await ttsLocal.synthesize(s.text, f, { modelCacheDir: path.join(app.getPath('userData'), 'models', 'transformers'), onStatus: (st) => { if (st.phase === 'download') send(st) } })
      // slot = cho trong toi da cua cau nay (den cau ke tiep / het timeline)
      const next = segs[i + 1]
      parts.push({ path: f, start: s.start, slot: Math.max(0.3, (next ? next.start : totalDur) - s.start) })
    }
    send({ phase: 'mix' })
    const out = path.join(outDir, 'redub-' + Date.now() + '.wav')
    await ops.buildRedubTrack({ parts, totalDur, output: out })
    let duration = totalDur
    try { duration = (await ops.probe(out)).duration || totalDur } catch (e) {}
    send({ phase: 'done' })
    return { path: out, duration, segments: segs.length }
  } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
})

// Google TTS: liet ke giong doc (dung key da luu)
ipcMain.handle('tts:voices', async (_e, langCode) => {
  const settings = require('./settings.cjs')
  const key = settings.getApiKey()
  if (!key) throw new Error('Chua cau hinh Google API key')
  const g = require('./tts-google.cjs')
  return g.listVoices(key, langCode || 'vi-VN')
})

// Cai dat: luu / kiem tra Google API key (khong tra key ra renderer)
ipcMain.handle('settings:setApiKey', (_e, key) => {
  const settings = require('./settings.cjs')
  return settings.setApiKey(key)
})
ipcMain.handle('settings:hasApiKey', () => {
  const settings = require('./settings.cjs')
  return settings.hasApiKey()
})
ipcMain.handle('settings:apiKeyStatus', () => require('./settings.cjs').getStatus())

// Tai video tu link (YouTube/TikTok/... qua yt-dlp) ve Downloads\TaoClip -> tra ve path
ipcMain.handle('dl:video', async (event, url) => {
  const key = 'active'
  if (DOWNLOAD_JOBS.has(key)) throw new Error('Đang có một lượt tải video chạy.')
  const dl = require('./downloader.cjs')
  dl.configure(path.join(app.getPath('userData'), 'bin'), ffmpegPath)
  const request = url && typeof url === 'object' ? url : { url }
  const outDir = request.outDir || path.join(app.getPath('downloads'), 'TaoClip')
  if (typeof outDir !== 'string' || !path.isAbsolute(outDir)) throw new Error('Thư mục tải không hợp lệ.')
  const controller = new AbortController()
  controller.senderId = event.sender.id
  DOWNLOAD_JOBS.set(key, controller)
  const send = (s) => { if (!event.sender.isDestroyed()) event.sender.send('dl:progress', s) }
  try {
    return await dl.download(request.url, outDir, { maxRes: request.maxRes, signal: controller.signal, onStatus: send, onProgress: (p) => send({ phase: 'download', progress: p }) })
  } finally { if (DOWNLOAD_JOBS.get(key) === controller) DOWNLOAD_JOBS.delete(key) }
})
ipcMain.handle('dl:cancel', (event) => {
  const controller = DOWNLOAD_JOBS.get('active')
  if (controller?.senderId !== event.sender.id) return false
  if (!controller) return false
  controller.abort(); return true
})
ipcMain.handle('dl:chooseDirectory', async () => {
  const result = await dialog.showOpenDialog({ title: 'Chọn thư mục tải video', defaultPath: path.join(app.getPath('downloads'), 'TaoClip'), properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// AI doi nen (local RVM ONNX): xu ly doan [start, start+dur] cua 1 video -> file mp4 moi
// opts: { input, start, dur, bg: {type:'blur'|'color'|'image', color?, path?} }
function configureAiVideo() {
  const aiv = require('./ai-video.cjs')
  aiv.configure(ffmpegPath, path.join(app.getPath('userData'), 'models'))
  return aiv
}
function normalizeAiBackground(background) {
  if (!background || background.type === 'blur') return { type: 'blur' }
  if (background.type === 'color' && /^#?[0-9a-f]{6}$/i.test(String(background.color || ''))) return { type: 'color', color: background.color }
  if (background.type === 'image' && typeof background.path === 'string' && path.isAbsolute(background.path) && fs.existsSync(background.path)) return { type: 'image', path: background.path }
  throw new Error('Nền thay thế không hợp lệ.')
}
let aiModelJob = null
let aiOperationController = null
ipcMain.handle('ai:cancel', () => { if (!aiOperationController) return false; aiOperationController.abort(); return true })
ipcMain.handle('ai:modelStatus', () => configureAiVideo().getModelStatus())
ipcMain.handle('ai:ensureModel', async (event) => {
  if (aiModelJob) throw new Error('Model AI đang được tải/cài đặt.')
  const aiv = configureAiVideo()
  const controller = new AbortController(); aiOperationController = controller
  const send = (s) => { if (!event.sender.isDestroyed()) event.sender.send('ai:progress', s) }
  aiModelJob = aiv.ensureModel(send, { signal: controller.signal })
  try { await aiModelJob; send({ phase: 'model-ready' }); return aiv.getModelStatus() }
  finally { aiModelJob = null; if (aiOperationController === controller) aiOperationController = null }
})
ipcMain.handle('ai:replaceBg', async (event, opts) => {
  if (aiOperationController) throw new Error('Đang có một tác vụ thay nền AI chạy.')
  const aiv = configureAiVideo() // nap muon (onnxruntime nang)
  ops.setEncoder(gpuEncoder) // composite dung GPU neu co
  const sourceInfo = await ops.probe(opts.input)
  if (!sourceInfo.hasVideo) throw new Error('Nguồn thay nền không có video.')
  const start = Number(opts.start ?? 0), dur = Number(opts.dur)
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(dur) || dur <= 0 || start + dur > sourceInfo.duration + 0.05) throw new Error('Đoạn thay nền nằm ngoài thời lượng nguồn.')
  const bg = normalizeAiBackground(opts.bg)
  const dir = path.join(app.getPath('userData'), 'generated', 'ai')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `bg-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`)
  const staged = outputStore.createStagingPath(out, 'replace-background')
  const send = (s) => { if (!event.sender.isDestroyed()) event.sender.send('ai:progress', s) }
  const controller = new AbortController(); aiOperationController = controller
  try {
    await aiv.replaceBackground({ input: opts.input, start, dur, bg,
      output: staged, procWidth: opts.procWidth, fps: opts.fps || sourceInfo.fps, signal: controller.signal, onStatus: send, onProgress: (p) => send({ phase: 'process', progress: p }) })
    const result = await ops.probe(staged)
    if (!result.hasVideo || !result.width || !result.height || Math.abs(result.duration - Number(opts.dur)) > 0.5 ||
        result.width !== sourceInfo.width || result.height !== sourceInfo.height || result.hasAudio !== sourceInfo.hasAudio) {
      throw new Error('Kết quả thay nền không khớp độ phân giải, thời lượng hoặc audio nguồn.')
    }
    outputStore.publishOutput(staged, out)
    return { path: out, duration: result.duration, width: result.width, height: result.height }
  } catch (error) { outputStore.discardOutput(staged); throw error }
  finally { if (aiOperationController === controller) aiOperationController = null }
})
ipcMain.handle('ai:previewBg', async (event, opts) => {
  if (aiOperationController) throw new Error('Đang có một tác vụ thay nền AI chạy.')
  const start = Number(opts?.start), dur = Number(opts?.dur)
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(dur) || dur < 1 || dur > 3) throw new Error('Preview thay nền cần thời lượng 1–3 giây và vị trí hợp lệ.')
  const bg = normalizeAiBackground(opts.bg)
  const aiv = configureAiVideo(); ops.setEncoder('cpu')
  const source = await ops.probe(opts.input)
  if (!source.hasVideo || start + dur > source.duration + 0.05) throw new Error('Đoạn preview nằm ngoài thời lượng clip.')
  const dir = path.join(app.getPath('userData'), 'generated', 'ai', 'previews')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `preview-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`)
  const staged = outputStore.createStagingPath(out, 'background-preview')
  const send = (s) => { if (!event.sender.isDestroyed()) event.sender.send('ai:progress', s) }
  const controller = new AbortController(); aiOperationController = controller
  try {
    await aiv.replaceBackground({ input: opts.input, start, dur, bg, output: staged,
      procWidth: opts.procWidth, fps: opts.fps || source.fps, signal: controller.signal, onStatus: send, onProgress: (p) => send({ phase: 'process', progress: p }) })
    const result = await ops.probe(staged)
    if (!result.hasVideo || Math.abs(result.duration - dur) > 0.5 || result.width !== source.width || result.height !== source.height) throw new Error('Preview thay nền không hợp lệ hoặc không khớp nguồn.')
    outputStore.publishOutput(staged, out)
    return { path: out, duration: result.duration }
  } catch (error) { outputStore.discardOutput(staged); throw error }
  finally { if (aiOperationController === controller) aiOperationController = null }
})

// AI doi khuon mat (local insightface ONNX): swap mat trong doan [start, start+dur] cua 1 video.
// opts: { input, start, dur, sourceImage } -> file mp4 moi
ipcMain.handle('ai:faceSwap', async (event, opts) => {
  if (aiOperationController) throw new Error('Một tác vụ AI khác đang chạy.')
  const controller = new AbortController(); aiOperationController = controller
  const base = path.join(app.getPath('userData'), 'generated', 'ai')
  const dir = opts.preview ? path.join(base, 'previews') : base
  let staged
  try {
    const start = Number(opts.start) || 0
    const dur = Number(opts.dur)
    if (opts.preview && (!Number.isFinite(dur) || dur < 1 || dur > 3)) throw new Error('Preview đổi mặt phải dài từ 1 đến 3 giây.')
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(dur) || dur <= 0) throw new Error('Khoảng xử lý đổi mặt không hợp lệ.')
    const source = await ops.probe(opts.input)
    if (!source.hasVideo || start + dur > source.duration + 0.05) throw new Error('Khoảng xử lý đổi mặt nằm ngoài thời lượng clip.')
    fs.mkdirSync(dir, { recursive: true })
    const out = path.join(dir, `face-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`)
    const jobId = `face:${event.sender.id}:${Date.now()}`
    staged = outputStore.createStagingPath(out, jobId)
    const fsw = require('./face-swap.cjs') // nap muon (model nang ~745MB)
    fsw.configure(ffmpegPath, path.join(app.getPath('userData'), 'models'))
    ops.setEncoder(gpuEncoder)
    const send = (s) => { if (!event.sender.isDestroyed()) event.sender.send('face:progress', s) }
    const r = await fsw.swapFaceVideo({
      input: opts.input, start, dur, fps: source.fps || 30, sourceImage: opts.sourceImage,
      output: staged, signal: controller.signal, onStatus: send, onProgress: (p) => send({ phase: 'process', progress: p })
    })
    if (!r.swapped) throw Object.assign(new Error('NO_TARGET_FACE'), { code: 'NO_TARGET_FACE' })
    const result = await ops.probe(staged)
    if (!result.hasVideo || Math.abs(result.duration - r.frames / r.fps) > 0.5 || result.width !== source.width - (source.width % 2) || result.height !== source.height - (source.height % 2)) {
      throw new Error('Kết quả hoán đổi khuôn mặt không vượt qua kiểm tra video.')
    }
    outputStore.publishOutput(staged, out)
    return { path: out, duration: result.duration, frames: r.frames, swapped: r.swapped, framesWithFace: r.framesWithFace, framesWithoutFace: r.framesWithoutFace }
  } catch (e) {
    if (staged) outputStore.discardOutput(staged)
    if (e.code === 'NO_SOURCE_FACE' || e.code === 'MULTIPLE_SOURCE_FACES' || e.code === 'MULTIPLE_TARGET_FACES' || e.code === 'NO_TARGET_FACE' || e.code === 'CANCELLED') throw new Error(e.code)
    throw e
  } finally { if (aiOperationController === controller) aiOperationController = null }
})

// Chon anh khuon mat nguon
ipcMain.handle('dialog:openFaceImage', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Chon anh khuon mat', properties: ['openFile'],
    filters: [{ name: 'Anh', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
})

// Luu du an (.taoclip = JSON)
ipcMain.handle('project:save', async (_e, data, currentPath) => {
  const stub = e2eDialog('saveProject')
  const res = stub ? { canceled: !stub.value, filePath: stub.value } : await dialog.showSaveDialog({
    title: 'Luu du an', defaultPath: typeof currentPath === 'string' && currentPath ? currentPath : 'taoclip-project.taoclip',
    filters: [{ name: 'TaoClip Project', extensions: ['taoclip'] }]
  })
  if (res.canceled || !res.filePath) return null
  projectStore.writeProject(res.filePath, data)
  return res.filePath
})

ipcMain.handle('project:write', (_e, filePath, data) => {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Đường dẫn dự án không hợp lệ.')
  return projectStore.writeProject(filePath, data)
})

// Mo du an
ipcMain.handle('project:open', async () => {
  const stub = e2eDialog('openProject')
  const res = stub ? { canceled: !stub.value, filePaths: stub.value ? [stub.value] : [] } : await dialog.showOpenDialog({
    title: 'Mo du an', properties: ['openFile'],
    filters: [{ name: 'TaoClip Project', extensions: ['taoclip'] }]
  })
  if (res.canceled || !res.filePaths.length) return null
  const filePath = res.filePaths[0]
  return { filePath, project: portableProject.resolveProjectPaths(projectStore.readProject(filePath), path.dirname(filePath)) }
})

ipcMain.handle('project:collect', async (_e, data, currentPath) => {
  const res = await dialog.showSaveDialog({
    title: 'Thu thập media và lưu dự án',
    defaultPath: typeof currentPath === 'string' && currentPath ? currentPath : 'taoclip-project.taoclip',
    filters: [{ name: 'TaoClip Project', extensions: ['taoclip'] }]
  })
  if (res.canceled || !res.filePath) return null
  return portableProject.collectProject(data, res.filePath)
})

ipcMain.handle('recovery:write', (_event, project) => recoveryStore.writeRecovery(path.join(app.getPath('userData'), 'recovery'), project))
ipcMain.handle('recovery:latest', () => recoveryStore.getLatestPendingRecovery(path.join(app.getPath('userData'), 'recovery')))
ipcMain.handle('recovery:dismiss', (_event, projectId, revision) => recoveryStore.dismissRecovery(path.join(app.getPath('userData'), 'recovery'), projectId, revision))

// Cho phep chon NHIEU video cung luc
ipcMain.handle('dialog:openVideos', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Chon video', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] }]
  })
  if (res.canceled || !res.filePaths.length) return []
  return res.filePaths
})

ipcMain.handle('dialog:openImportMedia', async () => {
  const stub = e2eDialog('openImportMedia'); if (stub) return stub.value
  const res = await dialog.showOpenDialog({
    title: 'Nhập video hoặc ảnh', properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video và ảnh', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'] },
      { name: 'Tất cả file', extensions: ['*'] }
    ]
  })
  return res.canceled ? [] : res.filePaths
})

// Cho phep chon NHIEU anh cung luc (slideshow)
ipcMain.handle('dialog:openImages', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Chon anh', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Anh', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }]
  })
  if (res.canceled || !res.filePaths.length) return []
  return res.filePaths
})

// Relink a missing project asset without discarding its timeline entry.
ipcMain.handle('dialog:relinkMedia', async (_e, kind) => {
  const image = kind === 'image'
  const audio = kind === 'audio'
  const res = await dialog.showOpenDialog({
    title: 'Tìm lại media bị thiếu', properties: ['openFile'],
    filters: [{ name: image ? 'Ảnh' : audio ? 'Âm thanh' : 'Video', extensions: image
      ? ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']
      : audio ? ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'wma']
        : ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] }]
  })
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
})

// Core export: 1 clip video -> exportVideo (giu smart-cut/auto-cut);
// nhieu clip HOAC co anh (slideshow) -> exportClips (ghep tung doan)
async function coreExport(opts, output, onProgress) {
  const colorFilter = ops.buildColorFilter(opts.filterKey || 'none', opts.filterIntensity ?? 100)
  const useClips = opts.clips && (opts.clips.length > 1 || opts.clips.some((c) => c.kind === 'image' || c.audioDetached || c.audioMuted || c.enhance || (c.volume != null && Math.abs(Number(c.volume) - 1) > 1e-6)))
  if (useClips) return ops.exportClips({ clips: opts.clips, output, ratio: opts.ratio, colorFilter, transition: opts.transition, editPlan: opts.editPlan, onProgress })
  const c = opts.clips && opts.clips[0]
  return ops.exportVideo({
    ...opts, colorFilter, output, onProgress,
    input: c ? c.input : opts.input,
    start: c ? c.in : opts.start, end: c ? c.out : opts.end, speed: c ? c.speed : opts.speed,
    cropMode: c?.cropMode || 'fit', cropX: c?.cropX ?? 0.5, cropY: c?.cropY ?? 0.5
  })
}

// Thu vien logo: chon file tren may (PNG/SVG) de renderer doc; luu/liet ke/xoa nam trong logo-library.cjs
ipcMain.handle('logos:pick', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Chọn logo (PNG hoặc SVG)', properties: ['openFile'],
    filters: [{ name: 'Logo', extensions: ['png', 'svg'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const file = res.filePaths[0]
  if (fs.statSync(file).size > logoLibrary.MAX_BYTES) throw new Error('Logo quá lớn (tối đa 8 MB).')
  return { name: path.basename(file, path.extname(file)), ext: path.extname(file).slice(1).toLowerCase(), base64: fs.readFileSync(file).toString('base64') }
})
ipcMain.handle('logos:list', () => logoLibrary.list())
ipcMain.handle('logos:save', (_event, payload) => logoLibrary.save(payload || {}))
ipcMain.handle('logos:remove', (_event, id) => logoLibrary.remove(String(id || '')))
ipcMain.handle('logos:usePreset', (_event, id) => logoLibrary.usePreset(id))

// Huy lan xuat dang chay (kill ffmpeg + bo cac buoc sau)
ipcMain.handle('export:cancel', (_event, jobId) => ops.cancelJob(jobId))

// Watermark (logo goc, hien suot video) thanh item V2: o vuong canh L = size x canh ngan nhat khung, hinh can trong o theo ax/ay,
// le = margin x canh ngan nhat. Cung cong thuc voi WatermarkPreview o renderer (cqmin).
function watermarkOverlay(wm, width, height) {
  const short = Math.min(width, height)
  const side = wm.size * short
  const margin = wm.margin * short
  const center = (anchor, length) => (anchor === 0 ? margin + side / 2 : anchor === 1 ? length - margin - side / 2 : length / 2)
  return {
    path: wm.path, name: wm.name || 'watermark', kind: 'image', start: 0, in: 0, out: 1e6, speed: 1, zIndex: 1e6,
    x: center(wm.anchorX, width) / width, y: center(wm.anchorY, height) / height, width: side / width, height: side / height,
    opacity: wm.opacity, ax: wm.anchorX, ay: wm.anchorY, fadeIn: wm.fadeIn, fadeOut: wm.fadeOut
  }
}

// Xuat video: core (cat/toc do/khung/loc mau/ghep clip) -> khac phu de -> tron am thanh
ipcMain.handle('video:export', async (event, opts) => {
  const sourcePaths = [
    ...(Array.isArray(opts?.clips) ? opts.clips.map((clip) => clip?.input) : []),
    ...(Array.isArray(opts?.videoOverlays) ? opts.videoOverlays.filter((item) => !item?.sticker).map((item) => item?.path) : []),
    ...(opts?.watermark?.path ? [opts.watermark.path] : []),
    ...(Array.isArray(opts?.audioItems) ? opts.audioItems.map((item) => item?.path) : []),
    ...(opts?.music ? [opts.music.path] : []), ...(opts?.voice ? [opts.voice.path] : []),
    ...(opts?.bgAudio ? [opts.bgAudio] : [])
  ]
  const target = outputStore.validateExportPaths(sourcePaths, opts?.output)
  const jobId = typeof opts.jobId === 'string' && opts.jobId ? opts.jobId : `export:${event.sender.id}:${Date.now()}`
  const job = ops.beginJob(jobId)
  let staging = outputStore.createStagingPath(target, jobId)
  const metadataStaging = opts.aiEdited ? outputStore.createStagingPath(target, `${jobId}-ai-metadata`) : null
  try {
    return await ops.runJob(job, async () => {
      let result
      let gpuFallback = false
      try {
        result = await runExport(event, { ...opts, output: staging })
      } catch (error) {
        const gpuFailure = opts.useGpu !== false && gpuEncoder !== 'cpu' && !job.cancelled &&
          /(?:h264_(?:nvenc|qsv|amf)|no capable devices|cannot load .* encoder|failed to initialise|failed to initialize|device setup failed|unsupported device|encoder.*not found)/i.test(String(error?.message || error))
        if (!gpuFailure) throw error
        outputStore.discardOutput(staging)
        staging = outputStore.createStagingPath(target, `${jobId}-cpu-retry`)
        gpuFallback = true
        event.sender.send('video:export:stage', { jobId, stage: 'gpu-fallback-cpu' })
        result = await runExport(event, { ...opts, useGpu: false, output: staging })
      }
      if (job.cancelled) { const e = new Error('CANCELLED'); e.cancelled = true; throw e }
      let publishStage = staging
      if (metadataStaging) {
        await ops.writeAiEditMetadata({ input: staging, output: metadataStaging })
        publishStage = metadataStaging
      }
      const stat = fs.statSync(publishStage)
      const media = await ops.probe(publishStage)
      if (!stat.isFile() || stat.size <= 0 || !media.width || !media.height || !Number.isFinite(media.duration) || media.duration <= 0) {
        throw new Error('File xuất không vượt qua kiểm tra định dạng video.')
      }
      await ops.decodeOutput(publishStage)
      outputStore.publishOutput(publishStage, target)
      if (publishStage !== staging) outputStore.discardOutput(staging)
      return { ...result, output: target, gpuFallback }
    })
  } catch (e) {
    outputStore.discardOutput(staging)
    if (metadataStaging) outputStore.discardOutput(metadataStaging)
    if (job.cancelled || e.cancelled) return { cancelled: true }
    throw e
  } finally { ops.endJob(jobId) }
})

async function runExport(event, opts) {
  const report = (pct) => event.sender.send('video:export:progress', { jobId: opts.jobId, progress: pct })
  const stage = (name) => event.sender.send('video:export:stage', { jobId: opts.jobId, stage: name })
  ops.setEncoder(opts.useGpu !== false ? gpuEncoder : 'cpu')
  ops.setOutputProfile({ quality: opts.quality, resolution: opts.resolution })
  const capBurn = opts.captions && opts.captions.length && opts.burnCaptions
  const hasOverlays = opts.overlays && opts.overlays.length
  const watermark = opts.watermark?.path && opts.watermark.enabled !== false ? opts.watermark : null
  const hasVideoOverlays = Boolean(opts.videoOverlays && opts.videoOverlays.length) || Boolean(watermark)
  const burning = capBurn || hasOverlays
  // Cac track am thanh them: nhac nen + long tieng CUNG LUC (opts.music/opts.voice)
  // Van nhan opts.bgAudio (payload cu, 1 track) de tuong thich nguoc
  const audioTracks = Array.isArray(opts.audioItems) && opts.audioItems.length
    ? opts.audioItems.filter((item) => item && !item.muted).map((item) => ({
      path: item.path, role: item.track, volume: item.gain ?? 1, loop: !!item.loop,
      start: item.start ?? 0, in: item.in ?? 0, out: item.out, speed: item.speed ?? 1, fadeIn: item.fadeIn ?? 0, fadeOut: item.fadeOut ?? 0, pan: item.pan ?? 0
    }))
    : [
      ...(opts.music ? [{ path: opts.music.path, volume: opts.music.volume ?? 1, loop: opts.music.loop !== false, role: 'music' }] : []),
      ...(opts.voice ? [{ path: opts.voice.path, volume: opts.voice.volume ?? 1, loop: false, role: 'voice', delay: Math.round((opts.voice.offset || 0) * 1000) }] : [])
    ]
  if (!audioTracks.length && opts.bgAudio) audioTracks.push({ path: opts.bgAudio, volume: opts.bgVolume ?? 1, loop: !!opts.bgLoop, role: 'music' })
  const originalHasAudio = opts.clips
    ? (opts.clips.length === 1 ? !!opts.clips[0].hasAudio : opts.clips.some((clip) => clip.hasAudio))
    : true
  const mixing = audioTracks.length > 0 || (originalHasAudio && Number(opts.origVolume) < 0.999)
  const multi = opts.clips && opts.clips.length > 1
  const c0 = opts.clips && opts.clips[0]

  if (!burning && !mixing && !hasVideoOverlays) { stage('core'); return coreExport(opts, opts.output, report) }

  const stages = 1 + (burning ? 1 : 0) + (mixing ? 1 : 0) + (hasVideoOverlays ? 1 : 0)
  let si = 0
  const w = 1 / stages
  const stageReport = (p) => report(Math.round((si + p / 100) * w * 100))

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-exp-'))
  try {
    // 1) Core
    stage('core')
    let cur = path.join(tmpDir, 's0.mp4')
    await coreExport(opts, cur, stageReport); si++

    // 2) Khac phu de + chu/sticker (re-encode video)
    if (burning) {
      stage('captions')
      const dims = await ops.probe(cur)
      // Phu de: da clip tinh theo timeline (identity); 1 clip theo trim/auto-cut + toc do
      let events = []
      if (capBurn) {
        if (opts.captionTimebase === 'timeline') {
          events = opts.captions
        } else {
          const segs = multi ? [{ start: 0, end: dims.duration }]
            : ((opts.segments && opts.segments.length) ? opts.segments : [{ start: (c0 ? c0.in : opts.start) || 0, end: c0 ? c0.out : opts.end }])
          const speedMap = multi ? 1 : ((c0 ? c0.speed : opts.speed) || 1)
          events = caps.mapToOutput(opts.captions, segs, speedMap)
        }
      }
      // Overlay (chu/sticker): da o thoi gian timeline, vi tri tuong doi -> px
      if (hasOverlays) {
        for (const o of opts.overlays) {
          events.push({
            start: o.start, end: o.end, text: o.text,
            pos: { x: (o.x ?? 0.5) * dims.width, y: (o.y ?? 0.5) * dims.height },
            fs: Math.round((o.size || 0.07) * dims.height),
            color: o.color ? caps.rgbToAss(o.color) : null,
            align: o.align || 'center', layer: o.zIndex || 0
          })
        }
      }
      const assFile = path.join(tmpDir, 'sub.ass')
      fs.writeFileSync(assFile, caps.toAss(events, { width: dims.width, height: dims.height, fontScale: opts.captionScale || 1 }), 'utf8')
      const tot = dims.duration || 1
      const next = (mixing || hasVideoOverlays) ? path.join(tmpDir, 's1.mp4') : opts.output
      await ops.burnSubtitles({ input: cur, assFile, output: next, onProgress: (sec) => stageReport((sec / tot) * 100) })
      cur = next; si++
    }

    // 3) Tron am thanh (nhac nen + long tieng, co ducking)
    if (mixing) {
      stage('audio')
      const dims = await ops.probe(cur)
      const tot = dims.duration || 1
      const mixed = hasVideoOverlays ? path.join(tmpDir, burning ? 's2.mp4' : 's1.mp4') : opts.output
      await ops.mixAudioTracks({
        video: cur, tracks: audioTracks, output: mixed,
        videoVol: opts.origVolume ?? 1, hasOrigAudio: dims.hasAudio,
        ducking: opts.ducking !== false, totalDuration: dims.duration,
        onProgress: (sec) => stageReport((sec / tot) * 100)
      })
      cur = mixed; si++
    }
    if (hasVideoOverlays) {
      stage('composite')
      const dims = await ops.probe(cur)
      // Sticker: asar khong doc duoc bang ffmpeg, copy PNG ra thu muc tam truoc
      const stickerBase = app.isPackaged ? path.join(__dirname, '..', 'dist') : path.join(__dirname, '..', 'src', 'renderer', 'public')
      const overlays = stickers.materializeStickers(opts.videoOverlays, tmpDir, stickerBase)
      if (watermark) {
        if (!fs.existsSync(watermark.path)) throw new Error('Không tìm thấy file logo watermark. Hãy chọn lại logo.')
        overlays.push(watermarkOverlay(watermark, dims.width, dims.height))
      }
      await ops.compositeVideoOverlays({
        input: cur, overlays, output: opts.output,
        onProgress: (pct) => stageReport(pct)
      })
      si++
    }
    report(100)
    return { ok: true, output: opts.output, method: [burning && 'cap', mixing && 'mix', hasVideoOverlays && 'v2'].filter(Boolean).join('+') || 'core' }
  } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
}
