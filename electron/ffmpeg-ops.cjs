// ============================================================
//  FFmpeg operations - tach rieng de TEST doc lap (khong can Electron)
//  probe, keyframe, thumbnail, toc do, smart-cut, auto-cut khoang lang,
//  da ti le khung (9:16 / 1:1 / 16:9 / 4:5 / goc)
// ============================================================
const ffmpeg = require('fluent-ffmpeg')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const FILTER_PRESETS = require('../src/shared/filter-presets.json')
const { createPriorityQueue } = require('./cache-queue.cjs')

let FFMPEG_PATH = null
let FFPROBE_PATH = null
const CACHE_QUEUE = createPriorityQueue(2)
const CACHE_INFLIGHT = { thumbnails: new Map(), waveform: new Map() }

function cacheSourceKey(input) { return path.resolve(input).toLowerCase() }
function runCacheTask(task, { priority = 0, sourceKey = '' } = {}) {
  return CACHE_QUEUE.enqueue(task, { priority, sourceKey })
}
function prioritizeCache(input) {
  CACHE_QUEUE.prioritize(cacheSourceKey(input))
}
function cacheFingerprint(input, params) {
  const absolute = path.resolve(input)
  const stat = fs.statSync(absolute)
  const value = JSON.stringify({ path: absolute.toLowerCase(), size: stat.size, mtimeMs: stat.mtimeMs, params })
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)
}
function previewProxyFingerprint(input) {
  return cacheFingerprint(input, { width: 1280, videoCodec: 'h264', preset: 'ultrafast', crf: 30, audioCodec: 'aac' })
}
function shareInflight(map, key, task) {
  if (map.has(key)) return map.get(key)
  const pending = Promise.resolve().then(task).finally(() => map.delete(key))
  map.set(key, pending)
  return pending
}

function configure(ffmpegPath, ffprobePath) {
  FFMPEG_PATH = ffmpegPath
  FFPROBE_PATH = ffprobePath
  ffmpeg.setFfmpegPath(ffmpegPath)
  ffmpeg.setFfprobePath(ffprobePath)
}

// ---------- Job context: cancellation and encoder are isolated per export ----------
const JOB_SCOPE = new AsyncLocalStorage()
const JOBS = new Map()
const DEFAULT_JOB = { id: 'default', cancelled: false, kills: new Set(), encoder: 'cpu', quality: 'standard', shortSide: 1080 }
function currentJob() { return JOB_SCOPE.getStore() || DEFAULT_JOB }
function beginJob(id) {
  if (!id) { DEFAULT_JOB.cancelled = false; DEFAULT_JOB.encoder = 'cpu'; DEFAULT_JOB.quality = 'standard'; DEFAULT_JOB.shortSide = 1080; return DEFAULT_JOB }
  const existing = JOBS.get(id)
  if (existing) return existing
  const job = { id, cancelled: false, kills: new Set(), encoder: 'cpu', quality: 'standard', shortSide: 1080 }
  JOBS.set(id, job)
  return job
}
function runJob(job, task) { return JOB_SCOPE.run(job, task) }
function endJob(id) { if (id) JOBS.delete(id) }
function isCancelled() { return currentJob().cancelled }
function cancelJob(id) {
  const job = id ? JOBS.get(id) : currentJob()
  if (!job) return false
  job.cancelled = true
  for (const kill of [...job.kills]) { try { kill() } catch {} }
  return true
}
function guardCancel() { if (isCancelled()) { const e = new Error('CANCELLED'); e.cancelled = true; throw e } }
// Theo doi child_process (spawn)
function track(ps) {
  const job = currentJob()
  const kill = () => { try { ps.kill('SIGKILL') } catch {} }
  job.kills.add(kill)
  ps.on('close', () => job.kills.delete(kill))
  ps.on('error', () => job.kills.delete(kill))
  if (job.cancelled) kill()
  return ps
}
// Theo doi lenh fluent-ffmpeg
function trackCmd(cmd) {
  const job = currentJob()
  const kill = () => { try { cmd.kill('SIGKILL') } catch {} }
  job.kills.add(kill)
  cmd.on('end', () => job.kills.delete(kill)).on('error', () => job.kills.delete(kill))
  if (job.cancelled) setTimeout(kill, 50) // fluent chi spawn sau .save()
  return cmd
}

// ---------- Encoder video: CPU (libx264) hoac GPU (NVENC/QuickSync/AMF) ----------
const VENC_ARGS = {
  cpu: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'],
  nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-pix_fmt', 'yuv420p'],
  qsv: ['-c:v', 'h264_qsv', '-global_quality', '23', '-pix_fmt', 'yuv420p'],
  amf: ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23', '-quality', 'balanced', '-pix_fmt', 'yuv420p']
}
// Muc chat luong xuat: crf cho libx264, q cho NVENC/QSV/AMF (so nho = chat luong cao hon, file lon hon)
const QUALITY_LEVELS = { high: { crf: 16, q: 19 }, standard: { crf: 20, q: 23 }, small: { crf: 24, q: 27 } }
const QUALITY_FLAGS = { cpu: ['-crf'], nvenc: ['-cq'], qsv: ['-global_quality'], amf: ['-qp_i', '-qp_p'] }
const SHORT_SIDES = [720, 1080, 1440]
function withQuality(name, quality) {
  const args = VENC_ARGS[name].slice()
  const level = QUALITY_LEVELS[quality]
  if (!level) return args
  for (const flag of QUALITY_FLAGS[name]) {
    const index = args.indexOf(flag)
    if (index >= 0) args[index + 1] = String(name === 'cpu' ? level.crf : level.q)
  }
  return args
}
function setEncoder(name) { currentJob().encoder = VENC_ARGS[name] ? name : 'cpu' }
// Gia tri la lai se ve mac dinh (standard / canh ngan 1080) thay vi bao loi, vi day chi la tuy chon xuat
function setOutputProfile({ quality, resolution } = {}) {
  const job = currentJob()
  job.quality = QUALITY_LEVELS[quality] ? quality : 'standard'
  const side = Number(resolution)
  job.shortSide = SHORT_SIDES.includes(side) ? side : 1080
}
function vencArgs() {
  const job = currentJob()
  return withQuality(VENC_ARGS[job.encoder] ? job.encoder : 'cpu', job.quality)
}
function getEncoder() { return currentJob().encoder }

// Thu encoder co chay duoc tren may nay khong (encode 1 khung test)
function testEncoder(name) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2', ...VENC_ARGS[name], '-f', 'null', '-']
    const ps = spawn(FFMPEG_PATH, args)
    ps.on('error', () => resolve(false))
    ps.on('close', (c) => resolve(c === 0))
  })
}
async function detectBestEncoder() {
  for (const name of ['nvenc', 'qsv', 'amf']) {
    try { if (await testEncoder(name)) return name } catch {}
  }
  return 'cpu'
}

async function createPreviewProxy(input, output, onProgress) {
  input = path.resolve(input); output = path.resolve(output)
  const info = await probe(input)
  if (!info.hasVideo || !info.width || !info.height) throw new Error('Media không có video để tạo proxy xem trước.')
  return new Promise((resolve, reject) => {
    const args = ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', output]
    const ps = track(spawn(FFMPEG_PATH, args)); let err = ''
    ps.stderr.on('data', (data) => {
      err += data
      const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(data.toString())
      if (match && onProgress) onProgress(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]))
    })
    ps.on('error', reject)
    ps.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`Không tạo được proxy xem trước: ${err.slice(-500)}`))
      try {
        const stat = fs.statSync(output)
        const proxy = await probe(output)
        if (!stat.size || !proxy.hasVideo || !proxy.width || !proxy.height) throw new Error('Proxy xem trước không hợp lệ.')
        resolve(output)
      } catch (error) { reject(error) }
    })
  })
}

// ---------- Ti le khung -> kich thuoc ----------
// short = canh ngan cua khung (720/1080/1440); 1080 cho ra 1080x1920, 1080x1350, 1920x1080 nhu truoc
function ratioDims(ratio, short = 1080) {
  const even = (value) => Math.round(value / 2) * 2
  switch (ratio) {
    case '9:16': return [short, even(short * 16 / 9)]
    case '1:1': return [short, short]
    case '16:9': return [even(short * 16 / 9), short]
    case '4:5': return [short, even(short * 5 / 4)]
    default: return null // 'original': giu kich thuoc nguon
  }
}

// "Tang cuong" mot clip: giam nhieu nhe + lam net + tang nhe tuong phan / bao hoa (loc cuc bo, khong phai AI phong to)
const ENHANCE_FILTER = 'hqdn3d=1.5:1.5:6:6,unsharp=5:5:0.8:3:3:0.4,eq=contrast=1.05:saturation=1.1'

function buildColorFilter(key, intensity = 100) {
  const preset = FILTER_PRESETS.find((item) => item.k === key)
  if (!preset) throw new Error(`Filter không được hỗ trợ: ${key}`)
  const amount = Math.max(0, Math.min(100, Number(intensity))) / 100
  if (!Number.isFinite(amount)) throw new Error('Cường độ filter không hợp lệ.')
  if (!amount || !preset.ff) return null
  const parts = []
  for (const [filter, params] of Object.entries(preset.ff)) {
    const values = Object.entries(params).map(([name, target]) => {
      const neutral = filter === 'eq' && name !== 'brightness' ? 1 : filter === 'hue' && name === 's' ? 1 : 0
      const value = neutral + (target - neutral) * amount
      return `${name}=${Number(value.toFixed(5))}`
    })
    parts.push(`${filter}=${values.join(':')}`)
  }
  return parts.join(',')
}

function renderFilterPreview({ input, time = 0, filterKey = 'none', intensity = 100, output }) {
  const colorFilter = buildColorFilter(filterKey, intensity)
  return new Promise((resolve, reject) => {
    const args = ['-y', '-v', 'error', '-ss', String(Math.max(0, Number(time) || 0)), '-i', path.resolve(input), '-frames:v', '1']
    if (colorFilter) args.push('-vf', colorFilter)
    args.push('-f', 'image2', path.resolve(output))
    const ps = track(spawn(FFMPEG_PATH, args))
    let stderr = '', settled = false
    const timer = setTimeout(() => { ps.kill(); finish(new Error('Render filter preview quá thời gian.')) }, 15000)
    const finish = (error) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) reject(error); else resolve(output)
    }
    ps.stderr.on('data', (data) => { stderr += data })
    ps.on('error', (error) => finish(error))
    ps.on('close', (code) => code === 0 ? finish() : finish(new Error(stderr.slice(-500) || 'Không render được frame filter.')))
  })
}

function displayDims(info) {
  const rotation = Math.abs(Number(info.rotation) || 0) % 180
  return rotation === 90 ? [info.height, info.width] : [info.width, info.height]
}

function scaleCropFilters(dims, { cropMode = 'fit', cropX = 0.5, cropY = 0.5 } = {}) {
  const [w, h] = dims
  if (cropMode === 'fill') {
    const rawX = Number(cropX), rawY = Number(cropY)
    const x = Math.max(0, Math.min(1, Number.isFinite(rawX) ? rawX : 0.5))
    const y = Math.max(0, Math.min(1, Number.isFinite(rawY) ? rawY : 0.5))
    return [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}:(in_w-out_w)*${x}:(in_h-out_h)*${y}`]
  }
  return [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`]
}

// ---------- Probe ----------
function probe(input) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) return reject(new Error(err.message))
      const streams = data.streams || []
      const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
        || streams.find((s) => s.codec_type === 'video')
      const a = data.streams.find((s) => s.codec_type === 'audio')
      const hasVideo = !!v && !v.disposition?.attached_pic
      // Mot so container thieu format.duration -> lay tu stream
      const dur = Number(data.format.duration) || Number(v?.duration) || (a && Number(a.duration)) || 0
      const formatName = data.format.format_name || ''
      const imageFormats = new Set(['image2', 'jpeg_pipe', 'png_pipe', 'webp_pipe', 'bmp_pipe', 'tiff_pipe', 'gif', 'ico'])
      const isImage = hasVideo && !a && formatName.split(',').some((format) => imageFormats.has(format))
      const rotationValue = v?.tags?.rotate ?? v?.side_data_list?.find((item) => Number.isFinite(Number(item.rotation)))?.rotation
      const rotation = Number(rotationValue) || 0
      const frameRateValue = String(v?.avg_frame_rate || v?.r_frame_rate || '30/1').split('/')
      const frameRate = Number(frameRateValue[0]) / (Number(frameRateValue[1]) || 1)
      resolve({
        duration: dur,
        width: hasVideo ? (v?.width || 0) : 0, height: hasVideo ? (v?.height || 0) : 0,
        fps: hasVideo && Number.isFinite(frameRate) && frameRate > 0 && frameRate <= 240 ? frameRate : 30,
        vcodec: v?.codec_name || '', acodec: a ? a.codec_name : '',
        hasVideo, hasAudio: !!a, kind: isImage ? 'image' : hasVideo ? 'video' : a ? 'audio' : 'unsupported',
        formatName, rotation, size: data.format.size ? Number(data.format.size) : 0
      })
    })
  })
}

function writeAiEditMetadata({ input, output }) {
  input = path.resolve(input); output = path.resolve(output)
  return new Promise((resolve, reject) => {
    const args = ['-y', '-v', 'error', '-i', input, '-map', '0', '-map_metadata', '0', '-c', 'copy',
      '-metadata', 'comment=TaoClip: AI-assisted editing applied', '-movflags', '+faststart', output]
    const ps = track(spawn(FFMPEG_PATH, args)); let stderr = ''
    ps.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += chunk.toString().slice(0, 4000 - stderr.length) })
    ps.on('error', reject)
    ps.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`Không ghi được metadata AI: ${stderr.trim() || `FFmpeg exit ${code}`}`))
      try {
        const result = await probe(output)
        if (!result.hasVideo || result.duration <= 0) throw new Error('File có metadata AI không hợp lệ.')
        resolve(output)
      } catch (error) { reject(error) }
    })
  })
}

function decodeFirstFrame(input, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', path.resolve(input), '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']
    const ps = track(spawn(FFMPEG_PATH, args))
    let stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; try { ps.kill('SIGKILL') } catch {} }, timeoutMs)
    timer.unref?.()
    ps.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += chunk.toString().slice(0, 4000 - stderr.length) })
    ps.on('error', (error) => { clearTimeout(timer); reject(error) })
    ps.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(timedOut ? 'Đọc thử media quá thời gian cho phép.' : (stderr.trim() || 'Không giải mã được frame video đầu tiên.')))
    })
  })
}

function decodeAudioSample(input, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', path.resolve(input), '-map', '0:a:0', '-t', '1', '-f', 'null', '-']
    const ps = track(spawn(FFMPEG_PATH, args))
    let stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; try { ps.kill('SIGKILL') } catch {} }, timeoutMs)
    timer.unref?.()
    ps.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += chunk.toString().slice(0, 4000 - stderr.length) })
    ps.on('error', (error) => { clearTimeout(timer); reject(error) })
    ps.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(timedOut ? 'Đọc thử media quá thời gian cho phép.' : (stderr.trim() || 'Không giải mã được audio.')))
    })
  })
}

// Decode every video/audio stream before publishing an export. Probe metadata
// alone can succeed for truncated files whose corruption is near the end.
function decodeOutput(input) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-xerror', '-err_detect', 'explode', '-i', path.resolve(input),
      '-map', '0:v?', '-map', '0:a?', '-f', 'null', '-']
    const ps = track(spawn(FFMPEG_PATH, args))
    let stderr = ''
    ps.stderr.on('data', (chunk) => { if (stderr.length < 8000) stderr += chunk.toString().slice(0, 8000 - stderr.length) })
    ps.on('error', reject)
    ps.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `Không giải mã đầy đủ được file xuất (FFmpeg exit ${code}).`))
    })
  })
}

async function inspectMedia(input) {
  const metadata = await probe(input)
  if (metadata.kind === 'audio') { await decodeAudioSample(input); return metadata }
  if (!metadata.hasVideo) throw new Error('File không chứa hình ảnh hoặc video được hỗ trợ.')
  if (!metadata.width || !metadata.height) throw new Error('Media không có kích thước hình hợp lệ.')
  if (metadata.kind === 'video' && (!Number.isFinite(metadata.duration) || metadata.duration <= 0)) throw new Error('Video không có thời lượng hợp lệ.')
  await decodeFirstFrame(input)
  return metadata
}

// ---------- Keyframes (nhanh, khong giai ma) ----------
function getKeyframes(input) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_packets',
      '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', input]
    const ps = spawn(FFPROBE_PATH, args)
    let out = '', errOut = ''
    ps.stdout.on('data', (d) => (out += d))
    ps.stderr.on('data', (d) => (errOut += d))
    ps.on('error', reject)
    ps.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffprobe keyframes loi: ' + errOut))
      const kfs = out.trim().split('\n').map((line) => {
        const [pts, flags] = line.split(',')
        return { t: Number(pts), key: (flags || '').includes('K') }
      }).filter((p) => p.key && !Number.isNaN(p.t)).map((p) => p.t).sort((x, y) => x - y)
      resolve(kfs)
    })
  })
}

// ---------- Thumbnails (filmstrip) ----------
function extractFrame(input, t, out) {
  return new Promise((resolve, reject) => {
    const temp = path.join(path.dirname(out), `${path.basename(out, path.extname(out))}.${crypto.randomUUID()}.tmp${path.extname(out)}`)
    ffmpeg(input).inputOptions(['-ss', String(t)])
      .outputOptions(['-frames:v', '1', '-vf', 'scale=160:-1', '-q:v', '5'])
      .on('end', () => {
        try { if (fs.existsSync(out)) fs.rmSync(out, { force: true }); fs.renameSync(temp, out); resolve(out) }
        catch (error) { try { fs.rmSync(temp, { force: true }) } catch {}; reject(error) }
      })
      .on('error', (e) => { try { fs.rmSync(temp, { force: true }) } catch {}; reject(new Error(e.message)) })
      .save(temp)
  })
}
async function generateThumbnails(input, count = 12) {
  const info = await probe(input)
  const dur = info.duration || 1
  const hash = cacheFingerprint(input, { kind: 'thumbnail', count, width: 160, quality: 5 })
  return shareInflight(CACHE_INFLIGHT.thumbnails, hash, async () => {
    const dir = path.join(os.tmpdir(), 'taoclip-thumbs', hash)
    fs.mkdirSync(dir, { recursive: true })
    const paths = [], tasks = []
    for (let i = 0; i < count; i++) {
      const t = (dur * (i + 0.5)) / count
      const out = path.join(dir, `t${i}.jpg`)
      paths.push(out)
    if (!fs.existsSync(out) || fs.statSync(out).size <= 0) tasks.push(runCacheTask(() => extractFrame(input, t, out), { sourceKey: cacheSourceKey(input) }))
    }
    await Promise.all(tasks)
    return paths.filter((p) => fs.existsSync(p))
  })
}

// ---------- Waveform PNG (hien tren timeline) ----------
// Ve dang song cua TOAN BO file (cache theo hash); UI tu crop theo in/out bang CSS
async function generateWaveform(input, width = 1200, height = 72) {
  const info = await probe(input)
  if (!info.hasAudio) return null
  const hash = cacheFingerprint(input, { kind: 'waveform', width, height, color: 'ffffff' })
  return shareInflight(CACHE_INFLIGHT.waveform, hash, async () => {
    const dir = path.join(os.tmpdir(), 'taoclip-waves')
    fs.mkdirSync(dir, { recursive: true })
    const out = path.join(dir, hash + '.png')
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return out
    await runCacheTask(() => new Promise((resolve, reject) => {
      const temp = path.join(dir, `${hash}.${crypto.randomUUID()}.tmp.png`)
      const args = ['-y', '-i', path.resolve(input), '-filter_complex',
        `aformat=channel_layouts=mono,showwavespic=s=${width}x${height}:colors=0xffffff`, '-frames:v', '1', temp]
      const ps = track(spawn(FFMPEG_PATH, args))
      let err = ''
      ps.stderr.on('data', (d) => (err += d))
      ps.on('error', (error) => { try { fs.rmSync(temp, { force: true }) } catch {}; reject(error) })
      ps.on('close', (c) => {
        if (c === 0) {
          try { if (fs.existsSync(out)) fs.rmSync(out, { force: true }); fs.renameSync(temp, out); resolve() } catch (error) { try { fs.rmSync(temp, { force: true }) } catch {}; reject(error) }
        } else { try { fs.rmSync(temp, { force: true }) } catch {}; reject(new Error('waveform loi: ' + err.slice(-300))) }
      })
    }), { sourceKey: cacheSourceKey(input) })
    return out
  })
}

// ---------- Trich audio ra WAV 16kHz mono (cho Whisper) ----------
function extractAudioWav(input, out) {
  return new Promise((resolve, reject) => {
    ffmpeg(input).noVideo().audioFrequency(16000).audioChannels(1).audioCodec('pcm_s16le').format('wav')
      .on('end', () => resolve(out)).on('error', (e) => reject(new Error(e.message))).save(out)
  })
}

// ---------- Trich audio 1 clip (trim+toc do) hoac im lang -> WAV 16k mono ----------
/** Khung hinh day du kich thuoc (PNG) tai thoi diem nguon t - dung cho freeze frame. */
function extractFullFrame(input, t, output) {
  return new Promise((resolve, reject) => {
    const temp = `${output}.${crypto.randomUUID()}.tmp.png`
    const ps = spawn(FFMPEG_PATH, ['-y', '-ss', String(Math.max(0, t)), '-i', path.resolve(input), '-frames:v', '1', '-c:v', 'png', temp])
    let err = ''
    ps.stderr.on('data', (d) => { if (err.length < 4000) err += d })
    ps.on('error', reject)
    ps.on('close', (code) => {
      try {
        if (code !== 0 || !fs.existsSync(temp) || fs.statSync(temp).size <= 0) throw new Error('freeze frame loi: ' + err.slice(-300))
        fs.renameSync(temp, output)
        resolve(output)
      } catch (error) { try { fs.rmSync(temp, { force: true }) } catch {}; reject(error) }
    })
  })
}

/** Luu doan [start, end] (giay trong file nguon) cua video/audio thanh WAV / MP3 / M4A theo duoi file dich; speed ap dung bang atempo. */
async function saveAudioRange({ input, start = 0, end, speed = 1, output }) {
  const info = await probe(input)
  if (!info.hasAudio) throw new Error('NO_AUDIO')
  const from = Math.max(0, Number(start) || 0)
  const to = Number.isFinite(Number(end)) ? Math.min(Number(end), info.duration || Infinity) : info.duration
  if (!(to - from > 0)) throw new Error('Doan am thanh khong hop le.')
  const ext = path.extname(output).toLowerCase()
  const codec = ext === '.mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ext === '.m4a' || ext === '.aac' ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'pcm_s16le']
  const factor = Number(speed) > 0 ? Number(speed) : 1
  const temp = path.join(path.dirname(output), `${path.basename(output, ext)}.${crypto.randomUUID()}.part${ext}`)
  const args = ['-y', '-ss', String(from), '-t', String(to - from), '-i', path.resolve(input), '-vn',
    ...(factor !== 1 ? ['-af', buildAtempoChain(factor).join(',')] : []), ...codec, temp]
  try {
    await new Promise((resolve, reject) => {
      const ps = spawn(FFMPEG_PATH, args)
      let err = ''
      ps.stderr.on('data', (d) => { if (err.length < 4000) err += d })
      ps.on('error', reject)
      ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error('luu am thanh loi: ' + err.slice(-300)))))
    })
    fs.renameSync(temp, output)
    return output
  } catch (error) { try { fs.rmSync(temp, { force: true }) } catch {}; throw error }
}

function clipAudioWav({ input, inPoint, outPoint, speed = 1, hasAudio, outDur, output }) {
  return new Promise((resolve, reject) => {
    const args = ['-y']
    if (hasAudio) {
      args.push('-ss', String(inPoint), '-t', String(outPoint - inPoint), '-i', path.resolve(input))
      const af = []
      if (speed !== 1) af.push(...buildAtempoChain(speed))
      af.push('aresample=16000')
      args.push('-af', af.join(','), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-vn')
    } else {
      args.push('-f', 'lavfi', '-t', String(outDur), '-i', 'anullsrc=channel_layout=mono:sample_rate=16000', '-c:a', 'pcm_s16le')
    }
    args.push(path.resolve(output))
    const ps = spawn(FFMPEG_PATH, args)
    let err = ''
    ps.stderr.on('data', (d) => (err += d))
    ps.on('error', reject)
    ps.on('close', (c) => c === 0 ? resolve(output) : reject(new Error('clip audio loi: ' + err.slice(-300))))
  })
}

// ---------- Ghep audio toan timeline -> 1 WAV (de tao phu de da clip) ----------
async function buildTimelineAudioWav(clips, output, editPlan) {
  const infos = await Promise.all(clips.map((c) => probe(c.input)))
  const byId = new Map(clips.map((clip, index) => [clip.id || String(index), { clip, info: infos[index] }]))
  const hasStableIds = clips.some((clip) => clip.id != null)
  const segments = Array.isArray(editPlan) && editPlan.length
    ? editPlan.map((entry, index) => {
      const source = byId.get(entry.clipId) || (!hasStableIds ? { clip: clips[index], info: infos[index] } : null)
      if (!source) throw new Error(`Timeline audio references missing clip: ${entry.clipId}`)
      return { ...source, inPoint: Number.isFinite(entry.sourceStart) ? entry.sourceStart : source.clip.in,
        outPoint: Number.isFinite(entry.sourceEnd) ? entry.sourceEnd : source.clip.out,
        speed: entry.speed || source.clip.speed || 1, overlapIn: entry.overlapIn || 0 }
    })
    : clips.map((clip, index) => ({ clip, info: infos[index], inPoint: clip.in, outPoint: clip.out, speed: clip.speed || 1, overlapIn: 0 }))
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-tla-'))
  try {
    const parts = []
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i], c = segment.clip
      const out = path.join(tmpDir, `a${i}.wav`)
      await clipAudioWav({ input: c.input, inPoint: segment.inPoint, outPoint: segment.outPoint, speed: segment.speed, hasAudio: segment.info.hasAudio,
        outDur: Math.max(0.05, (segment.outPoint - segment.inPoint) / segment.speed), output: out })
      parts.push(out)
    }
    if (parts.length === 1) { fs.copyFileSync(parts[0], path.resolve(output)); return output }
    const overlaps = segments.slice(1).map((segment) => Math.max(0, Number(segment.overlapIn) || 0))
    const hasOverlap = overlaps.some((value) => value > 0)
    if (hasOverlap) {
      const args = ['-y']
      parts.forEach((part) => args.push('-i', path.resolve(part)))
      const filters = []
      let current = '[0:a]'
      for (let i = 1; i < parts.length; i++) {
        const next = i === parts.length - 1 ? '[aout]' : `[a${i}]`
        const duration = overlaps[i - 1]
        filters.push(duration > 0
          ? `${current}[${i}:a]acrossfade=d=${duration.toFixed(3)}:c1=tri:c2=tri${next}`
          : `${current}[${i}:a]concat=n=2:v=0:a=1${next}`)
        current = next
      }
      args.push('-filter_complex', filters.join(';'), '-map', '[aout]', '-c:a', 'pcm_s16le', '-ac', '1', '-ar', '16000', path.resolve(output))
      await new Promise((resolve, reject) => {
        const ps = track(spawn(FFMPEG_PATH, args))
        let err = ''; ps.stderr.on('data', (d) => (err += d))
        ps.on('error', reject); ps.on('close', (c) => c === 0 ? resolve() : reject(new Error('crossfade audio loi: ' + err.slice(-300))))
      })
    } else {
      const listFile = path.join(tmpDir, 'list.txt')
      fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8')
      await new Promise((resolve, reject) => {
        const ps = track(spawn(FFMPEG_PATH, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', path.resolve(output)]))
        let err = ''; ps.stderr.on('data', (d) => (err += d))
        ps.on('error', reject); ps.on('close', (c) => c === 0 ? resolve() : reject(new Error('concat audio loi: ' + err.slice(-300))))
      })
    }
    return output
  } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
}

// Normalize a chosen set of timeline voice tracks to the exact canvas duration for ASR.
async function buildVoiceSourceWav({ tracks = [], totalDuration, output }) {
  const duration = Number(totalDuration)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Thời lượng timeline không hợp lệ để nhận dạng lời thoại.')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-voice-source-'))
  const usable = []
  try {
    for (const item of tracks) {
      if (!item?.path) continue
      const info = await probe(item.path)
      if (!info.hasAudio) continue
      const input = Math.max(0, Number(item.in) || 0)
      const end = Math.min(info.duration || duration, Number(item.out) || info.duration || duration)
      const start = Math.max(0, Number(item.start) || 0)
      if (end <= input || start >= duration) continue
      const itemDuration = Math.min(end - input, duration - start)
      const gain = Math.max(0, Math.min(4, Number(item.gain ?? item.volume ?? 1)))
      const fadeIn = Math.max(0, Number(item.fadeIn) || 0), fadeOut = Math.max(0, Number(item.fadeOut) || 0)
      const contentWav = path.join(tmpDir, `content-${usable.length}.wav`)
      const wav = path.join(tmpDir, `track-${usable.length}.wav`)
      const filters = ['aresample=16000', 'aformat=channel_layouts=mono']
      if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${Math.min(fadeIn, itemDuration).toFixed(6)}`)
      if (fadeOut > 0 && itemDuration > 0.01) filters.push(`afade=t=out:st=${Math.max(0, itemDuration - fadeOut).toFixed(6)}:d=${Math.min(fadeOut, itemDuration).toFixed(6)}`)
      filters.push(`volume=${gain.toFixed(6)}`)
      const args = ['-y', '-ss', input.toFixed(6), '-t', itemDuration.toFixed(6), '-i', path.resolve(item.path), '-af', filters.join(','), '-c:a', 'pcm_s16le', '-ac', '1', '-ar', '16000', contentWav]
      await new Promise((resolve, reject) => {
        const ps = track(spawn(FFMPEG_PATH, args)); let err = ''
        ps.stderr.on('data', (data) => { err += data })
        ps.on('error', reject)
        ps.on('close', (code) => code === 0 ? resolve() : reject(new Error('Chuẩn hóa track voice thất bại: ' + err.slice(-500))))
      })
      const alignedArgs = ['-y', '-i', contentWav, '-af', `adelay=${Math.round(start * 1000)}:all=1,apad=whole_dur=${duration.toFixed(6)},atrim=duration=${duration.toFixed(6)}`, '-c:a', 'pcm_s16le', '-ac', '1', '-ar', '16000', wav]
      await new Promise((resolve, reject) => {
        const ps = track(spawn(FFMPEG_PATH, alignedArgs)); let err = ''
        ps.stderr.on('data', (data) => { err += data })
        ps.on('error', reject)
        ps.on('close', (code) => code === 0 ? resolve() : reject(new Error('Canh thời gian track voice thất bại: ' + err.slice(-500))))
      })
      usable.push(wav)
    }
    if (!usable.length) throw new Error('Không có track lời thoại hợp lệ để nhận dạng.')
    const args = ['-y', '-f', 'lavfi', '-t', duration.toFixed(6), '-i', 'anullsrc=channel_layout=mono:sample_rate=16000']
    usable.forEach((wav) => args.push('-i', path.resolve(wav)))
    const labels = ['[0:a]', ...usable.map((_wav, index) => `[${index + 1}:a]`)].join('')
    const graph = `${labels}amix=inputs=${usable.length + 1}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration=${duration.toFixed(6)}[out]`
    args.push('-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', '-ac', '1', '-ar', '16000', path.resolve(output))
    await new Promise((resolve, reject) => {
      const ps = track(spawn(FFMPEG_PATH, args)); let err = ''
      ps.stderr.on('data', (data) => { err += data })
      ps.on('error', reject)
      ps.on('close', (code) => code === 0 ? resolve() : reject(new Error('Trộn nguồn voice thất bại: ' + err.slice(-500))))
    })
    return output
  } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
}

async function concatAudioFiles({ inputs, output, gap = 0.16 }) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error('Không có đoạn audio để ghép.')
  if (inputs.length === 1) { fs.copyFileSync(path.resolve(inputs[0]), path.resolve(output)); return output }
  const args = ['-y']
  inputs.forEach((input) => args.push('-i', path.resolve(input)))
  const silenceIndex = inputs.length
  for (let i = 0; i < inputs.length - 1; i++) args.push('-f', 'lavfi', '-t', String(gap), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
  const filters = [], ordered = []
  inputs.forEach((_input, i) => {
    filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[chunk${i}]`)
    ordered.push(`[chunk${i}]`)
    if (i < inputs.length - 1) {
      filters.push(`[${silenceIndex + i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[gap${i}]`)
      ordered.push(`[gap${i}]`)
    }
  })
  filters.push(`${ordered.join('')}concat=n=${ordered.length}:v=0:a=1[out]`)
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '3', path.resolve(output))
  await new Promise((resolve, reject) => {
    const ps = track(spawn(FFMPEG_PATH, args)); let err = ''
    ps.stderr.on('data', (data) => { err += data })
    ps.on('error', reject)
    ps.on('close', (code) => code === 0 ? resolve() : reject(new Error('Ghép audio TTS thất bại: ' + err.slice(-500))))
  })
  return output
}

// ---------- Khac phu de (ASS) vao video ----------
// assFile dat cung thu muc lam cwd -> dung ten tuong doi, tranh escape duong dan Windows
function burnSubtitles({ input, assFile, output, onProgress }) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(assFile)
    const base = path.basename(assFile)
    // cwd doi sang thu muc ASS -> input/output PHAI tuyet doi
    input = path.resolve(input)
    output = path.resolve(output)
    const args = ['-y', '-i', input, '-vf', 'ass=' + base,
      ...vencArgs(), '-c:a', 'copy', '-movflags', '+faststart', output]
    const ps = track(spawn(FFMPEG_PATH, args, { cwd: dir }))
    let err = ''
    ps.stderr.on('data', (d) => { err += d; const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString()); if (m && onProgress) onProgress((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) })
    ps.on('error', reject)
    ps.on('close', (code) => code === 0 ? resolve(output) : reject(new Error('burn loi: ' + err.slice(-400))))
  })
}

// ---------- Encode 1 clip (cat/toc do/loc mau) -> chuan hoa kich thuoc+fps -> TS ----------
function encodeClipTS({ input, inPoint, outPoint, speed = 1, dims, cropMode = 'fit', cropX = 0.5, cropY = 0.5, colorFilter, hasAudio, anyAudio, volume = 1, fadeIn = false, fadeOut = false, fadeDur = 0.4, output, onProgress }) {
  return new Promise((resolve, reject) => {
    const dur = Math.max(0.05, outPoint - inPoint)
    const outDur = dur / speed
    const fd = Math.min(fadeDur, outDur / 2)
    const args = ['-y', '-ss', String(inPoint), '-t', String(dur), '-i', path.resolve(input)]
    const needSilent = anyAudio && !hasAudio
    if (needSilent) args.push('-f', 'lavfi', '-t', String(outDur + 0.2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
    const vf = []
    if (speed !== 1) vf.push(`setpts=${(1 / speed).toFixed(6)}*PTS`)
    if (colorFilter) vf.push(colorFilter)
    vf.push(...scaleCropFilters(dims, { cropMode, cropX, cropY }), 'fps=30', 'setsar=1')
    if (fadeIn) vf.push(`fade=t=in:st=0:d=${fd.toFixed(3)}`)
    if (fadeOut) vf.push(`fade=t=out:st=${Math.max(0, outDur - fd).toFixed(3)}:d=${fd.toFixed(3)}`)
    args.push('-vf', vf.join(','))
    if (anyAudio && hasAudio) {
      const af = []
      if (speed !== 1) af.push(...buildAtempoChain(speed))
      if (Number.isFinite(volume) && Math.abs(volume - 1) > 1e-6) af.push(`volume=${Math.max(0, Math.min(4, volume)).toFixed(4)}`) // am luong rieng cua clip
      if (fadeIn) af.push(`afade=t=in:st=0:d=${fd.toFixed(3)}`)
      if (fadeOut) af.push(`afade=t=out:st=${Math.max(0, outDur - fd).toFixed(3)}:d=${fd.toFixed(3)}`)
      if (af.length) args.push('-af', af.join(','))
    }
    args.push('-map', '0:v:0')
    if (anyAudio) args.push('-map', needSilent ? '1:a:0' : '0:a:0')
    args.push(...vencArgs(), '-r', '30')
    if (anyAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100'); else args.push('-an')
    args.push('-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts')
    if (needSilent) args.push('-shortest')
    args.push(path.resolve(output))
    const ps = track(spawn(FFMPEG_PATH, args))
    let err = ''
    ps.stderr.on('data', (d) => { err += d; const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString()); if (m && onProgress) onProgress((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) })
    ps.on('error', reject)
    ps.on('close', (c) => c === 0 ? resolve(output) : reject(new Error('clip encode loi: ' + err.slice(-400))))
  })
}

// ---------- Ma hoa 1 ANH tinh thanh 1 doan .ts (slideshow) ----------
// dur: thoi luong hien; kenBurns: zoom/pan nhe; anyAudio: co clip nao co tieng -> them track im lang de concat
function encodeImageTS({ input, dur, dims, cropMode = 'fit', cropX = 0.5, cropY = 0.5, colorFilter, kenBurns = false, animated = false, anyAudio = false,
                        fadeIn = false, fadeOut = false, fadeDur = 0.4, output, onProgress }) {
  return new Promise((resolve, reject) => {
    const [W, H] = dims
    const outDur = Math.max(0.3, dur)
    const fps = 30
    const fd = Math.min(fadeDur, outDur / 2)
    const args = animated
      ? ['-y', '-stream_loop', '-1', '-i', path.resolve(input)]
      : ['-y', '-loop', '1', '-t', String(outDur), '-i', path.resolve(input)]
    if (anyAudio) args.push('-f', 'lavfi', '-t', String(outDur), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100')
    const vf = []
    if (colorFilter) vf.push(colorFilter)
    if (kenBurns) {
      // Phu kin khung roi zoom/pan nhe. Pre-scale lon de bot vo/nhiem.
      const frames = Math.max(1, Math.round(fps * outDur))
      const rawX = Number(cropX), rawY = Number(cropY)
      const cx = Math.max(0, Math.min(1, Number.isFinite(rawX) ? rawX : 0.5)), cy = Math.max(0, Math.min(1, Number.isFinite(rawY) ? rawY : 0.5))
      vf.push(`scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`, `crop=${W * 2}:${H * 2}`)
      vf.push(`zoompan=z='min(zoom+0.0006,1.15)':d=${frames}:x='max(0,min(iw-iw/zoom,iw*${cx}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*${cy}-ih/zoom/2))':s=${W}x${H}:fps=${fps}`)
    } else {
      vf.push(...scaleCropFilters(dims, { cropMode, cropX, cropY }))
    }
    vf.push('setsar=1', 'format=yuv420p')
    if (fadeIn) vf.push(`fade=t=in:st=0:d=${fd.toFixed(3)}`)
    if (fadeOut) vf.push(`fade=t=out:st=${Math.max(0, outDur - fd).toFixed(3)}:d=${fd.toFixed(3)}`)
    args.push('-vf', vf.join(','))
    args.push('-map', '0:v:0')
    if (anyAudio) args.push('-map', '1:a:0')
    args.push(...vencArgs(), '-r', String(fps))
    if (anyAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100'); else args.push('-an')
    args.push('-t', String(outDur), '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts', path.resolve(output))
    const ps = track(spawn(FFMPEG_PATH, args))
    let err = ''
    ps.stderr.on('data', (d) => { err += d; const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString()); if (m && onProgress) onProgress((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) })
    ps.on('error', reject)
    ps.on('close', (c) => c === 0 ? resolve(output) : reject(new Error('anh encode loi: ' + err.slice(-400))))
  })
}

// Kieu xfade duoc phep (khop transition-styles.js o renderer). Ten duoc ghep thang vao filtergraph nen phai nam trong danh sach nay
const XFADE_STYLES = new Set(['fade', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'circleopen', 'circleclose', 'radial', 'pixelize', 'zoomin'])

// ---------- Noi cac doan bang CROSSFADE (hoa tan chong nhau) - 1 pass filtergraph ----------
// inputs: cac .ts da chuan hoa (dims/fps30/sar1); durs: thoi luong tung doan; dur: do dai hoa tan; style: kieu xfade (mac dinh fade)
function crossfadeChain({ inputs, durs, dur, overlaps, output, hasAudio, style, onProgress }) {
  return new Promise((resolve, reject) => {
    const n = inputs.length
    const xfadeStyle = XFADE_STYLES.has(style) ? style : 'fade'
    const fadeAt = (i) => Number(overlaps?.[i] ?? dur) || 0
    const args = ['-y']
    inputs.forEach((f) => args.push('-i', path.resolve(f)))
    const fc = []
    // Chuoi xfade video: offset = tong do dai da ghep - D
    let cur = '[0:v]', combined = durs[0]
    for (let i = 1; i < n; i++) {
      const D = fadeAt(i - 1)
      const off = Math.max(0, combined - D)
      const out = i === n - 1 ? '[vout]' : `[v${i}]`
      fc.push(`${cur}[${i}:v]xfade=transition=${xfadeStyle}:duration=${D.toFixed(3)}:offset=${off.toFixed(3)}${out}`)
      cur = out; combined += durs[i] - D
    }
    // Chuoi acrossfade audio (neu co tieng)
    if (hasAudio) {
      let ca = '[0:a]'
      for (let i = 1; i < n; i++) {
        const D = fadeAt(i - 1)
        const out = i === n - 1 ? '[aout]' : `[a${i}]`
        fc.push(`${ca}[${i}:a]acrossfade=d=${D.toFixed(3)}${out}`)
        ca = out
      }
    }
    args.push('-filter_complex', fc.join(';'), '-map', '[vout]')
    if (hasAudio) args.push('-map', '[aout]')
    args.push(...vencArgs(), '-r', '30')
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100'); else args.push('-an')
    args.push('-movflags', '+faststart', path.resolve(output))
    const ps = track(spawn(FFMPEG_PATH, args))
    let err = ''
    ps.stderr.on('data', (d) => { err += d; const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString()); if (m && onProgress) onProgress((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) })
    ps.on('error', reject)
    ps.on('close', (c) => c === 0 ? resolve(output) : reject(new Error('crossfade loi: ' + err.slice(-400))))
  })
}

// ---------- Ghep nhieu clip thanh 1 video (tung clip cat/toc do/loc mau rieng) ----------
async function exportClips({ clips, output, ratio, colorFilter, transition, editPlan, onProgress }) {
  const fade = transition && transition.type === 'fade'
  const xfade = transition && transition.type === 'crossfade'
  const fadeDur = (transition && transition.dur) || 0.4
  const infos = await Promise.all(clips.map((c) => probe(c.input)))
  let dims = ratioDims(ratio, currentJob().shortSide)
  if (!dims) { const original = displayDims(infos[0]); dims = [original[0] || 1080, original[1] || 1920] }
  dims = [dims[0] - (dims[0] % 2), dims[1] - (dims[1] % 2)]
  // Tieng goc cua clip da tach (audioDetached) hoac tat tieng (audioMuted) khong dua vao ban ghep: clip do duoc thay bang im lang
  const clipHasAudio = (index) => infos[index].hasAudio && !clips[index].audioDetached && !clips[index].audioMuted
  const anyAudio = infos.some((_info, index) => clipHasAudio(index))
  const clipColorFilter = (clip) => [colorFilter, clip.enhance ? ENHANCE_FILTER : null].filter(Boolean).join(',') || null
  const durs = clips.map((c) => (c.out - c.in) / (c.speed || 1))
  const overlaps = clips.slice(1).map((clip, index) => {
    const planned = editPlan?.[index + 1]?.overlapIn
    return xfade ? Number(planned ?? Math.min(fadeDur, durs[index] / 2, durs[index + 1] / 2)) : 0
  })
  const totalOut = Math.max(0.001, durs.reduce((a, d) => a + d, 0) - overlaps.reduce((a, d) => a + d, 0))
  const encodeTotal = Math.max(0.001, durs.reduce((a, d) => a + d, 0))
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-clips-'))
  try {
    const parts = []
    let done = 0
    for (let i = 0; i < clips.length; i++) {
      guardCancel()
      const c = clips[i]
      const out = path.join(tmpDir, `c${i}.ts`)
      const onSeg = (sec) => onProgress && onProgress(Math.min(50, Math.round(((done + sec) / encodeTotal) * 50)))
      if (c.kind === 'image') {
        await encodeImageTS({
          input: c.input, dur: (c.out - c.in) || 3, dims, cropMode: c.cropMode || 'fit', cropX: c.cropX, cropY: c.cropY, colorFilter: clipColorFilter(c), kenBurns: c.kenBurns !== false,
          animated: c.animated === true || c.formatName === 'gif', anyAudio,
          fadeIn: fade && i > 0, fadeOut: fade && i < clips.length - 1, fadeDur, output: out, onProgress: onSeg
        })
      } else {
        await encodeClipTS({
          input: c.input, inPoint: c.in, outPoint: c.out, speed: c.speed || 1, dims, cropMode: c.cropMode || 'fit', cropX: c.cropX, cropY: c.cropY, colorFilter: clipColorFilter(c),
          hasAudio: clipHasAudio(i), anyAudio, volume: Number(c.volume ?? 1), output: out,
          fadeIn: fade && i > 0, fadeOut: fade && i < clips.length - 1, fadeDur, onProgress: onSeg
        })
      }
      done += (c.out - c.in) / (c.speed || 1)
      parts.push(out)
    }
    if (xfade && parts.length > 1) {
      await crossfadeChain({ inputs: parts, durs, overlaps, dur: fadeDur, style: transition.style, output, hasAudio: anyAudio, onProgress: (sec) => onProgress && onProgress(Math.min(99, 50 + Math.round((sec / totalOut) * 49))) })
    } else {
      await concatTS({ inputs: parts, output, hasAudio: anyAudio })
    }
    onProgress && onProgress(100)
    return { ok: true, output, method: xfade ? 'multi-clip-xfade' : 'multi-clip', clips: clips.length }
  } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
}

// Composite a bounded V2 track over the already-rendered V1 video. All paths
// are separate argv entries, and overlay time is expressed on the final
// timeline; the V1 duration remains the output duration.
async function compositeVideoOverlays({ input, overlays, output, onProgress }) {
  const items = (overlays || []).filter((item) => item && !item.missing).slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
  if (!items.length) return input
  const info = await probe(input)
  if (!info.width || !info.height || !Number.isFinite(info.duration) || info.duration <= 0) throw new Error('Không thể xác định video V1 để ghép track V2.')
  const args = ['-y', '-i', path.resolve(input)]
  const valid = []
  for (const item of items) {
    if (typeof item.path !== 'string' || !item.path.trim() || !fs.existsSync(item.path)) throw new Error(`Không tìm thấy media V2: ${item.name || item.path || ''}`)
    const start = Number(item.start), sourceIn = Number(item.in || 0), sourceOut = Number(item.out)
    const speed = Number(item.speed || 1), opacity = Number(item.opacity ?? 1)
    const x = Number(item.x ?? 0.5), y = Number(item.y ?? 0.5), width = Number(item.width ?? 1), height = Number(item.height ?? 1)
    const rotation = Number(item.rotation ?? 0), fadeIn = Number(item.fadeIn ?? 0), fadeOut = Number(item.fadeOut ?? 0)
    if (![rotation, fadeIn, fadeOut].every(Number.isFinite) || Math.abs(rotation) > 360 || fadeIn < 0 || fadeOut < 0) throw new Error('Thông số xoay / mờ của track V2 không hợp lệ.')
    if (![start, sourceIn, sourceOut, speed, opacity, x, y, width, height].every(Number.isFinite) || start < 0 || sourceIn < 0 || sourceOut <= sourceIn || speed <= 0 || opacity < 0 || opacity > 1 || x < 0 || x > 1 || y < 0 || y > 1 || width <= 0 || width > 4 || height <= 0 || height > 4) {
      throw new Error('Thông số track V2 không hợp lệ.')
    }
    const duration = (sourceOut - sourceIn) / speed
    const end = Math.min(info.duration, start + duration)
    if (end <= start) continue
    if (item.kind === 'image' && !item.animated) args.push('-loop', '1', '-framerate', '30', '-i', path.resolve(item.path))
    else if (item.kind === 'image') args.push('-stream_loop', '-1', '-i', path.resolve(item.path))
    else args.push('-ss', String(sourceIn), '-t', String(sourceOut - sourceIn), '-i', path.resolve(item.path))
    valid.push({ start, end, sourceIn, speed, opacity, x, y, width, height, rotation, flipH: !!item.flipH, flipV: !!item.flipV, fadeIn, fadeOut })
  }
  if (!valid.length) return input
  const fc = [`[0:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[vbase]`]
  let base = '[vbase]'
  valid.forEach((item, index) => {
    const inputIndex = index + 1
    const boxW = Math.max(2, Math.round(info.width * item.width / 2) * 2)
    const boxH = Math.max(2, Math.round(info.height * item.height / 2) * 2)
    const cx = (info.width * item.x).toFixed(2), cy = (info.height * item.y).toFixed(2) // tam hinh; xoay lam khung phinh ra nen can theo tam (w / h la kich thuoc lop sau khi xoay)
    const layer = `[v2src${index}]`, out = index === valid.length - 1 ? '[v2out]' : `[v2${index}]`
    const radians = (item.rotation * Math.PI / 180).toFixed(6)
    const flips = `${item.flipH ? ',hflip' : ''}${item.flipV ? ',vflip' : ''}`
    const turn = item.rotation ? `,rotate=a=${radians}:ow=rotw(${radians}):oh=roth(${radians}):c=black@0` : ''
    const fadeStart = item.start.toFixed(4), fadeEnd = Math.max(item.start, item.end - item.fadeOut).toFixed(4)
    const fades = `${item.fadeIn > 0 ? `,fade=t=in:st=${fadeStart}:d=${item.fadeIn.toFixed(4)}:alpha=1` : ''}${item.fadeOut > 0 ? `,fade=t=out:st=${fadeEnd}:d=${item.fadeOut.toFixed(4)}:alpha=1` : ''}`
    fc.push(`[${inputIndex}:v]setpts=(PTS-STARTPTS)/${item.speed}+${item.start}/TB${flips},scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,format=rgba,pad=${boxW}:${boxH}:(ow-iw)/2:(oh-ih)/2:color=black@0${turn}${fades},colorchannelmixer=aa=${item.opacity}${layer}`)
    fc.push(`${base}${layer}overlay=x=${cx}-w/2:y=${cy}-h/2:enable='between(t,${item.start.toFixed(4)},${item.end.toFixed(4)})':eof_action=pass:shortest=0:format=auto${out}`)
    base = out
  })
  args.push('-filter_complex', fc.join(';'), '-map', '[v2out]', '-map', '0:a?', '-t', String(info.duration), ...vencArgs(), '-r', '30', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', path.resolve(output))
  await new Promise((resolve, reject) => {
    const ps = track(spawn(FFMPEG_PATH, args)); let err = ''
    ps.stderr.on('data', (data) => {
      err += data
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(data.toString())
      if (m && onProgress) onProgress((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / info.duration * 100)
    })
    ps.on('error', reject)
    ps.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Ghép V2 lỗi: ${err.slice(-600)}`)))
  })
  return output
}

// ---------- Tron them 1 track am thanh (nhac nen / long tieng) vao video ----------
// hasOrigAudio: video co san tieng khong; loop: lap audio (nhac nen) hay khong (long tieng)
function mixAudio({ video, audio, output, videoVol = 1, audioVol = 1, hasOrigAudio = true, loop = false, onProgress }) {
  return new Promise((resolve, reject) => {
    video = path.resolve(video); audio = path.resolve(audio); output = path.resolve(output)
    const args = ['-y', '-i', video]
    if (loop) args.push('-stream_loop', '-1')
    args.push('-i', audio)
    const fc = hasOrigAudio
      ? `[0:a]volume=${videoVol}[a0];[1:a]volume=${audioVol}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`
      : `[1:a]volume=${audioVol},apad[a]`
    args.push('-filter_complex', fc, '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output)
    const ps = track(spawn(FFMPEG_PATH, args))
    let err = ''
    ps.stderr.on('data', (d) => { err += d; const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString()); if (m && onProgress) onProgress((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) })
    ps.on('error', reject)
    ps.on('close', (code) => code === 0 ? resolve(output) : reject(new Error('mix loi: ' + err.slice(-400))))
  })
}

// ---------- Tron NHIEU track am thanh (nhac nen + long tieng CUNG LUC) ----------
// tracks: [{path, volume=1, loop=false, role:'music'|'voice', delay?:ms}]
// delay: lui diem bat dau track (vd giong doc bat dau giua video)
// ducking: tu ha nhac xuong khi giong noi vang len (sidechaincompress)
async function mixAudioTracks({ video, tracks = [], output, videoVol = 1, hasOrigAudio = true, ducking = false, totalDuration, onProgress }) {
  video = path.resolve(video); output = path.resolve(output)
  const videoInfo = await probe(video)
  const duration = Number(totalDuration) > 0 ? Number(totalDuration) : videoInfo.duration
  const usable = []
  for (const tk of tracks) {
    if (!tk || tk.muted) continue
    const info = await probe(tk.path)
    const sourceIn = Math.max(0, Number(tk.in ?? 0))
    const sourceOut = Math.min(info.duration || Infinity, Number(tk.out ?? info.duration))
    const speed = Math.min(16, Math.max(0.05, Number(tk.speed) || 1))
    const sourceDuration = (sourceOut - sourceIn) / speed // do dai tren timeline (da tinh toc do audio)
    const start = Math.max(0, Number(tk.start ?? ((tk.delay || 0) / 1000)))
    const remaining = Math.max(0, duration - start)
    if (!info.hasAudio || !Number.isFinite(sourceDuration) || sourceDuration <= 0 || remaining <= 0) continue
    usable.push({ ...tk, sourceIn, sourceOut, sourceDuration, speed, start, remaining,
      segmentDuration: tk.loop ? remaining : Math.min(sourceDuration, remaining),
      volume: Math.max(0, Math.min(4, Number(tk.volume ?? tk.gain ?? 1))),
      pan: Math.max(-1, Math.min(1, Number(tk.pan) || 0)),
      fadeIn: Math.max(0, Number(tk.fadeIn || 0)), fadeOut: Math.max(0, Number(tk.fadeOut || 0)) })
  }
  if (!usable.length && !hasOrigAudio) throw new Error('Không có track audio hợp lệ để trộn.')
  const args = ['-y', '-i', video]
  usable.forEach((tk) => args.push('-i', path.resolve(tk.path)))
  const norm = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'
  const fc = [], trackLabels = [], roleIndices = { music: [], voice: [] }
  usable.forEach((tk, i) => {
    const filters = [`atrim=start=${tk.sourceIn.toFixed(6)}:end=${tk.sourceOut.toFixed(6)}`, 'asetpts=PTS-STARTPTS', norm]
    if (tk.speed !== 1) filters.push(...buildAtempoChain(tk.speed))
    if (tk.loop) filters.push(`aloop=loop=-1:size=${Math.max(1, Math.round(tk.sourceDuration * 44100))}`, `atrim=duration=${tk.remaining.toFixed(6)}`)
    else filters.push(`atrim=duration=${tk.segmentDuration.toFixed(6)}`)
    if (tk.fadeIn > 0) filters.push(`afade=t=in:st=0:d=${Math.min(tk.fadeIn, tk.segmentDuration).toFixed(6)}`)
    if (tk.fadeOut > 0 && tk.segmentDuration > 0.01) {
      const fadeOut = Math.min(tk.fadeOut, tk.segmentDuration)
      filters.push(`afade=t=out:st=${Math.max(0, tk.segmentDuration - fadeOut).toFixed(6)}:d=${fadeOut.toFixed(6)}`)
    }
    filters.push(`volume=${tk.volume.toFixed(6)}`)
    if (tk.pan) filters.push(`pan=stereo|c0=${(tk.pan > 0 ? 1 - tk.pan : 1).toFixed(4)}*c0|c1=${(tk.pan < 0 ? 1 + tk.pan : 1).toFixed(4)}*c1`) // can bang trai / phai
    if (tk.segmentDuration < tk.remaining) filters.push(`apad=whole_dur=${tk.remaining.toFixed(6)}`)
    filters.push(`adelay=${Math.round(tk.start * 1000)}:all=1`)
    const label = `[track${i}]`
    fc.push(`[${i + 1}:a]${filters.join(',')}${label}`)
    trackLabels.push(label)
    if (tk.role === 'music' || tk.role === 'voice') roleIndices[tk.role].push(i)
  })
  const mixGroup = (indices, name) => {
    const labels = indices.map((i) => `[track${i}]`)
    if (!labels.length) return null
    if (labels.length === 1) return labels[0]
    const out = `[${name}bus]`
    fc.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0${out}`)
    return out
  }
  let musicBus = mixGroup(roleIndices.music, 'music')
  let voiceBus = mixGroup(roleIndices.voice, 'voice')
  const handled = new Set([...roleIndices.music, ...roleIndices.voice])
  const extras = trackLabels.filter((_label, i) => !handled.has(i))
  if (ducking && musicBus && voiceBus) {
    fc.push(`${voiceBus}asplit=2[voiceout][voicesc]`, '[voicesc]apad[voicescpad]',
      `${musicBus}[voicescpad]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duckedmusic]`)
    musicBus = '[duckedmusic]'
    voiceBus = '[voiceout]'
  }
  const mixIns = []
  if (hasOrigAudio && videoInfo.hasAudio) { fc.push(`[0:a]volume=${Number(videoVol).toFixed(6)},${norm},apad[orig]`); mixIns.push('[orig]') }
  if (musicBus) mixIns.push(musicBus)
  if (voiceBus) mixIns.push(voiceBus)
  mixIns.push(...extras)
  if (!mixIns.length) throw new Error('Không có track audio hợp lệ để trộn.')
  if (mixIns.length === 1) fc.push(`${mixIns[0]}alimiter=limit=0.95,apad[aout]`)
  else fc.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=${hasOrigAudio && videoInfo.hasAudio ? 'first' : 'longest'}:dropout_transition=0:normalize=0,alimiter=limit=0.95,apad[aout]`)
  args.push('-filter_complex', fc.join(';'), '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output)
  await new Promise((resolve, reject) => {
    const ps = track(spawn(FFMPEG_PATH, args)); let err = ''
    ps.stderr.on('data', (d) => { err += d; const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString()); if (m && onProgress) onProgress((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) })
    ps.on('error', reject)
    ps.on('close', (code) => code === 0 ? resolve(output) : reject(new Error('mix nhieu track loi: ' + err.slice(-600))))
  })
  return output
}

// ---------- Ghep cac doan TTS thanh 1 track long tieng theo timeline (doi giong / re-dub) ----------
// parts: [{path, start, slot}] - start: giay tren timeline OUTPUT; slot: cho toi da (den cau ke tiep)
// Doan TTS dai hon slot -> tang toc (atempo, giu cao do) cho vua; ngan hon -> giu nguyen, phan du im lang
async function buildRedubTrack({ parts, totalDur, output }) {
  if (!parts || !parts.length) throw new Error('Khong co doan nao de ghep')
  const durs = await Promise.all(parts.map((pt) => probe(pt.path).then((i) => i.duration || 0)))
  const overflow = parts.map((pt, i) => ({ pt, duration: durs[i], index: i }))
    .find(({ pt, duration }) => duration / Math.max(0.2, pt.slot || totalDur - pt.start) > 4)
  if (overflow) throw new Error(`Câu ${overflow.index + 1} dài ${overflow.duration.toFixed(2)}s, vượt quá tốc độ co tối đa 4× trong slot ${Math.max(0.2, overflow.pt.slot || totalDur - overflow.pt.start).toFixed(2)}s. Hãy sửa câu hoặc kéo dài slot.`)
  return new Promise((resolve, reject) => {
    const args = ['-y']
    parts.forEach((pt) => args.push('-i', path.resolve(pt.path)))
    const norm = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo'
    const fc = [], labels = []
    parts.forEach((pt, i) => {
      const f = []
      const slot = Math.max(0.2, pt.slot || totalDur - pt.start)
      const factor = durs[i] / slot
      if (factor > 1.02) f.push(...buildAtempoChain(factor))
      f.push(norm, `adelay=${Math.max(0, Math.round(pt.start * 1000))}:all=1`)
      fc.push(`[${i}:a]${f.join(',')}[s${i}]`)
      labels.push(`[s${i}]`)
    })
    const pad = `apad=whole_dur=${totalDur.toFixed(3)}`
    if (parts.length === 1) fc.push(`${labels[0]}${pad}[a]`)
    else fc.push(`${labels.join('')}amix=inputs=${parts.length}:duration=longest:dropout_transition=0:normalize=0,${pad}[a]`)
    // filter ghi ra file: nhieu cau -> chuoi filter dai, tranh gioi han command line Windows
    const fcFile = path.resolve(output) + '.fc.txt'
    fs.writeFileSync(fcFile, fc.join(';'), 'utf8')
    args.push('-filter_complex_script', fcFile, '-map', '[a]', '-t', String(totalDur),
      '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', path.resolve(output))
    const ps = spawn(FFMPEG_PATH, args)
    let err = ''
    ps.stderr.on('data', (d) => (err += d))
    ps.on('error', reject)
    ps.on('close', (c) => {
      try { fs.rmSync(fcFile, { force: true }) } catch {}
      c === 0 ? resolve(output) : reject(new Error('redub loi: ' + err.slice(-400)))
    })
  })
}

// ---------- atempo (giu cao do) ----------
function buildAtempoChain(factor) {
  const parts = []
  let f = factor
  while (f > 2.0 + 1e-9) { parts.push('atempo=2.0'); f /= 2 }
  while (f < 0.5 - 1e-9) { parts.push('atempo=0.5'); f *= 2 }
  parts.push('atempo=' + Number(f.toFixed(6)))
  return parts
}

// ---------- Phat hien khoang lang ----------
async function detectSilence(input, { noise = '-30dB', minSilence = 0.4 } = {}) {
  const media = await probe(input)
  if (!media.hasAudio) throw new Error('Clip này không có track âm thanh để phân tích im lặng.')
  return new Promise((resolve, reject) => {
    const args = ['-i', input, '-af', `silencedetect=noise=${noise}:d=${minSilence}`, '-f', 'null', '-']
    const ps = spawn(FFMPEG_PATH, args)
    let err = ''
    ps.stderr.on('data', (d) => (err += d))
    ps.on('error', reject)
    ps.on('close', (code) => {
      if (code !== 0) { reject(new Error('Không phân tích được track âm thanh: ' + err.slice(-500))); return }
      const starts = [...err.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]))
      const ends = [...err.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]))
      const silences = starts.map((s, i) => ({ start: Math.max(0, s), end: ends[i] ?? null }))
      resolve(silences)
    })
  })
}
// Tinh cac doan GIU LAI (bu cua khoang lang), chua le 'pad' giay
function computeKeep(duration, silences, pad = 0.06) {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const safePad = Math.max(0, Number(pad) || 0)
  const sil = silences.map((s) => ({ start: Math.max(0, Math.min(duration, Number(s.start) || 0)),
    end: Math.max(0, Math.min(duration, s.end == null ? duration : Number(s.end))) }))
    .filter((s) => Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start)
  const merged = []
  for (const silence of sil) {
    const last = merged[merged.length - 1]
    if (last && silence.start <= last.end) last.end = Math.max(last.end, silence.end)
    else merged.push({ ...silence })
  }
  if (merged.length === 1 && merged[0].start <= 0.03 && merged[0].end >= duration - 0.03) return []
  const keep = []; let cur = 0
  for (const s of merged) {
    const segEnd = Math.min(duration, s.start + safePad)
    if (s.start - cur > 0.12 && segEnd - cur > 0.12) keep.push({ start: cur, end: segEnd })
    cur = Math.max(cur, s.end - safePad)
  }
  if ((!merged.length || merged[merged.length - 1].end < duration - 0.03) && duration - cur > 0.12) keep.push({ start: cur, end: duration })
  return keep
}

// ---------- Re-encode 1 doan (toc do + ti le khung) ----------
function reencodeSegment({ input, output, start, duration, speed = 1, dims = null, cropMode = 'fit', cropX = 0.5, cropY = 0.5,
                           colorFilter = null, hasAudio = true, format = null, onProgress }) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(input).inputOptions(['-ss', String(start), '-t', String(duration)])
    const vf = []
    if (speed !== 1) vf.push(`setpts=${(1 / speed).toFixed(6)}*PTS`)
    if (colorFilter) vf.push(colorFilter)
    if (dims) {
      const [w, h] = dims
      vf.push(...scaleCropFilters(dims, { cropMode, cropX, cropY }))
    }
    if (vf.length) cmd = cmd.videoFilters(vf)
    if (hasAudio && speed !== 1) cmd = cmd.audioFilters(buildAtempoChain(speed))

    const opts = [...vencArgs()]
    if (hasAudio) opts.push('-c:a', 'aac', '-b:a', '192k'); else opts.push('-an')
    if (format === 'mpegts') opts.push('-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts')
    else opts.push('-movflags', '+faststart')

    trackCmd(cmd).outputOptions(opts)
      .on('progress', (p) => onProgress && onProgress(p.percent || 0))
      .on('end', () => resolve(output)).on('error', (e) => reject(new Error(e.message))).save(output)
  })
}
function copySegmentTS({ input, output, start, duration }) {
  return new Promise((resolve, reject) => {
    trackCmd(ffmpeg(input).inputOptions(['-ss', String(start), '-t', String(duration)]))
      .outputOptions(['-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts'])
      .on('end', () => resolve(output)).on('error', (e) => reject(new Error(e.message))).save(output)
  })
}
function fastCopy({ input, output, start, duration }) {
  return new Promise((resolve, reject) => {
    trackCmd(ffmpeg(input).inputOptions(['-ss', String(start), '-t', String(duration)]))
      .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
      .on('end', () => resolve(output)).on('error', (e) => reject(new Error(e.message))).save(output)
  })
}
function concatTS({ inputs, output, hasAudio = true }) {
  return new Promise((resolve, reject) => {
    const opts = ['-c', 'copy', '-movflags', '+faststart']
    if (hasAudio) opts.splice(2, 0, '-bsf:a', 'aac_adtstoasc')
    trackCmd(ffmpeg('concat:' + inputs.join('|'))).outputOptions(opts)
      .on('end', () => resolve(output)).on('error', (e) => reject(new Error(e.message))).save(output)
  })
}

// ============================================================
//  XUAT VIDEO - ho tro: segments[] (auto-cut), ratio, speed, mode
// ============================================================
async function exportVideo(opts) {
  const { input, output, start = 0, end, speed = 1, mode = 'smart', onProgress, cropMode = 'fit', cropX = 0.5, cropY = 0.5 } = opts
  const info = await probe(input)
  const dur = info.duration
  const ratio = opts.ratio || (opts.vertical ? '9:16' : 'original')
  const dims = ratioDims(ratio, currentJob().shortSide)
  const colorFilter = opts.colorFilter || null
  const report = (p) => onProgress && onProgress(Math.max(0, Math.min(100, Math.round(p))))

  let segments = (opts.segments && opts.segments.length ? opts.segments : [{ start, end: end ?? dur }])
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(dur, s.end) }))
    .filter((s) => s.end - s.start > 0.05)
  if (!segments.length) throw new Error('Khong co doan nao de xuat')

  const single = segments.length === 1
  const needsTransform = speed !== 1 || !!dims || !!colorFilter

  // --- Truong hop 1 doan, khong bien doi -> smart/fast/accurate ---
  if (single && !needsTransform) {
    const s = segments[0], d = s.end - s.start
    if (mode === 'fast') { await fastCopy({ input, output, start: s.start, duration: d }); report(100); return { ok: true, output, method: 'fast-copy' } }
    if (mode === 'accurate') { await reencodeSegment({ input, output, start: s.start, duration: d, hasAudio: info.hasAudio, onProgress: report }); report(100); return { ok: true, output, method: 'reencode' } }
    // smart
    const audioOk = !info.hasAudio || info.acodec === 'aac'
    if (info.vcodec !== 'h264' || !audioOk) { await reencodeSegment({ input, output, start: s.start, duration: d, hasAudio: info.hasAudio, onProgress: report }); report(100); return { ok: true, output, method: 'reencode-fallback' } }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-'))
    try {
      const kfs = await getKeyframes(input)
      const inner = kfs.filter((t) => t > s.start + 0.04 && t < s.end - 0.04)
      if (!inner.length) { await reencodeSegment({ input, output, start: s.start, duration: d, hasAudio: info.hasAudio, onProgress: report }); report(100); return { ok: true, output, method: 'reencode-nokf' } }
      const kfS = inner[0], kfE = inner[inner.length - 1]
      const parts = []
      const head = path.join(tmpDir, 'h.ts'), mid = path.join(tmpDir, 'm.ts'), tail = path.join(tmpDir, 't.ts')
      report(5)
      if (kfS - s.start > 0.04) { await reencodeSegment({ input, output: head, start: s.start, duration: kfS - s.start, hasAudio: info.hasAudio, format: 'mpegts', onProgress: (p) => report(5 + p * 0.25) }); parts.push(head) }
      report(35)
      // Chi copy doan giua khi co do dai thuc (tranh -t 0 sinh du frame)
      if (kfE - kfS > 0.04) { await copySegmentTS({ input, output: mid, start: kfS, duration: kfE - kfS }); parts.push(mid) }
      report(55)
      if (s.end - kfE > 0.04) { await reencodeSegment({ input, output: tail, start: kfE, duration: s.end - kfE, hasAudio: info.hasAudio, format: 'mpegts', onProgress: (p) => report(55 + p * 0.25) }); parts.push(tail) }
      // Clip qua ngan, khong tao duoc phan nao -> re-encode toan bo cho chac
      if (!parts.length) { await reencodeSegment({ input, output, start: s.start, duration: d, hasAudio: info.hasAudio, onProgress: report }); report(100); return { ok: true, output, method: 'reencode-tiny' } }
      report(85); await concatTS({ inputs: parts, output, hasAudio: info.hasAudio }); report(100)
      return { ok: true, output, method: 'smart-cut', parts: parts.length }
    } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
  }

  // --- Truong hop chung: nhieu doan / co bien doi -> reencode tung doan roi noi ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-'))
  try {
    const parts = []
    for (let i = 0; i < segments.length; i++) {
      guardCancel()
      const seg = segments[i]
      const out = path.join(tmpDir, `p${i}.ts`)
      await reencodeSegment({
        input, output: out, start: seg.start, duration: seg.end - seg.start,
        speed, dims, cropMode, cropX, cropY, colorFilter, hasAudio: info.hasAudio, format: 'mpegts',
        onProgress: (p) => report(((i + p / 100) / segments.length) * 95)
      })
      parts.push(out)
    }
    await concatTS({ inputs: parts, output, hasAudio: info.hasAudio })
    report(100)
    return { ok: true, output, method: single ? 'reencode' : 'auto-cut', segments: segments.length }
  } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
}

module.exports = {
  configure, probe, inspectMedia, decodeOutput, getKeyframes, buildAtempoChain, exportVideo, vencArgs, buildColorFilter, renderFilterPreview, writeAiEditMetadata, prioritizeCache,
  extractFullFrame, saveAudioRange, ENHANCE_FILTER,
  generateThumbnails, generateWaveform, detectSilence, computeKeep, ratioDims,
  extractAudioWav, burnSubtitles, mixAudio, mixAudioTracks, exportClips, compositeVideoOverlays, encodeImageTS, crossfadeChain,
  setEncoder, setOutputProfile, getEncoder, detectBestEncoder, createPreviewProxy, previewProxyFingerprint, buildTimelineAudioWav, buildVoiceSourceWav, concatAudioFiles, buildRedubTrack,
  beginJob, runJob, endJob, cancelJob, isCancelled
}
