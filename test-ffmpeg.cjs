// ============================================================
//  Bo test engine xu ly video (FFmpeg ops) - chay bang Node, khong can mo app
//    node test-ffmpeg.cjs
//  Tu tao video test trong .testout/, kiem tra tung chuc nang, in PASS/FAIL.
//  (Whisper/TTS KHONG test o day vi can tai model ~120MB - xem cuoi file.)
// ============================================================
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const ops = require('./electron/ffmpeg-ops.cjs')
const caps = require('./electron/captions.cjs')
const outputStore = require('./electron/output-store.cjs')
const filterPresets = require('./src/shared/filter-presets.json')

const ffmpegPath = require('ffmpeg-static')
ops.configure(ffmpegPath, require('ffprobe-static').path)

const dir = path.join(__dirname, '.testout')
fs.mkdirSync(dir, { recursive: true })
const p = (f) => path.join(dir, f)

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
}
const near = (a, b, tol = 0.6) => Math.abs(a - b) < tol
function rmsAt(file, start, duration = 0.2) {
  const sample = spawnSync(ffmpegPath, ['-v', 'error', '-ss', String(start), '-t', String(duration), '-i', p(file), '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'])
  if (sample.status !== 0 || !sample.stdout?.length) return 0
  let sum = 0, count = 0
  for (let i = 0; i + 1 < sample.stdout.length; i += 2) { const n = sample.stdout.readInt16LE(i) / 32768; sum += n * n; count++ }
  return count ? Math.sqrt(sum / count) : 0
}
function pixelAt(file, x, y) {
  const sample = spawnSync(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'])
  return sample.status === 0 && sample.stdout?.length >= 3 ? [...sample.stdout.subarray(0, 3)] : []
}

function gen(file, args) {
  const r = spawnSync(ffmpegPath, ['-y', ...args, p(file)], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('gen ' + file + ': ' + r.stderr)
}

async function run() {
  console.log('1) Tao video test...')
  // co tieng, keyframe moi 1s, im lang 3-5s & 7-8s
  gen('main.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=9:size=640x480:rate=30', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=9', '-af', "volume=enable='between(t,3,5)+between(t,7,8)':volume=0",
    '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac'])
  gen('noaudio.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=6:size=640x480:rate=30', '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p'])
  gen('music.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=3'])
  gen('video # with spaces.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  gen('blue-v2.mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  gen('video10.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=10:size=64x64:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  gen('still # photo.png', ['-f', 'lavfi', '-i', 'color=c=red:s=64x48:d=1', '-frames:v', '1'])
  gen('green-v2.png', ['-f', 'lavfi', '-i', 'color=c=green:s=64x48:d=1', '-frames:v', '1'])
  gen('animated.gif', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5', '-loop', '0'])
  fs.writeFileSync(p('broken.mp4'), 'not a media stream')
  const importedVideo = await ops.inspectMedia(p('video # with spaces.mp4'))
  check('import inspection detects video by content in special-character path', importedVideo.kind === 'video' && importedVideo.duration > 0)
  const importedImage = await ops.inspectMedia(p('still # photo.png'))
  check('import inspection decodes valid still image', importedImage.kind === 'image' && importedImage.width === 64 && importedImage.height === 48)
  const importedAudio = await ops.inspectMedia(p('music.mp3'))
  check('import inspection validates audio stream separately', importedAudio.kind === 'audio' && importedAudio.duration > 0)
  await ops.createPreviewProxy(p('main.mp4'), p('preview-proxy.mp4'))
  const proxyInfo = await ops.probe(p('preview-proxy.mp4'))
  check('preview proxy transcodes playable video and keeps its audio/timing', proxyInfo.hasVideo && proxyInfo.hasAudio && near(proxyInfo.duration, 9, 0.35) && proxyInfo.width <= 1280 && proxyInfo.height <= 720)
  fs.copyFileSync(p('video # with spaces.mp4'), p('proxy-fingerprint-source.mp4'))
  const proxyFingerprintA = ops.previewProxyFingerprint(p('proxy-fingerprint-source.mp4'))
  const sourceTimes = fs.statSync(p('proxy-fingerprint-source.mp4'))
  fs.utimesSync(p('proxy-fingerprint-source.mp4'), sourceTimes.atime, new Date(sourceTimes.mtimeMs + 3000))
  check('preview proxy cache fingerprint changes when source mtime changes', proxyFingerprintA !== ops.previewProxyFingerprint(p('proxy-fingerprint-source.mp4')))
  const importedGif = await ops.inspectMedia(p('animated.gif'))
  check('GIF is classified as an animated image asset', importedGif.kind === 'image' && importedGif.formatName === 'gif')
  await ops.exportClips({ clips: [{ input: p('animated.gif'), kind: 'image', in: 0, out: 2, speed: 1, kenBurns: false, animated: true }], output: p('animated-slide.mp4'), ratio: '16:9' })
  check('animated GIF imports into the image slideshow pipeline', near((await ops.probe(p('animated-slide.mp4'))).duration, 2, 0.2))
  const gifFrameHash = (at) => spawnSync(ffmpegPath, ['-v', 'error', '-ss', String(at), '-i', p('animated-slide.mp4'), '-frames:v', '1', '-f', 'md5', '-'], { encoding: 'utf8' }).stdout.trim()
  check('animated GIF remains animated in exported slideshow', gifFrameHash(0.1) !== gifFrameHash(0.8))
  let brokenRejected = false
  try { await ops.inspectMedia(p('broken.mp4')) } catch { brokenRejected = true }
  check('import inspection rejects corrupt file regardless of extension', brokenRejected)
  const SRC = p('main.mp4'), NA = p('noaudio.mp4')

  console.log('\n2) probe')
  const info = await ops.probe(SRC)
  check('duration ~9s', near(info.duration, 9), `(${info.duration})`)
  check('co audio + h264', info.hasAudio && info.vcodec === 'h264')

  console.log('\n3) Cat clip (smart / fast / accurate)')
  for (const [mode, exp] of [['smart', 4.4], ['fast', 4.0], ['accurate', 4.4]]) {
    const o = p(`cut_${mode}.mp4`)
    await ops.exportVideo({ input: SRC, output: o, start: 2.3, end: 6.7, mode, onProgress: () => {} })
    check(`cut ${mode}`, near((await ops.probe(o)).duration, exp, 0.7), `(${(await ops.probe(o)).duration.toFixed(2)})`)
  }
  const publishTarget = p('staged-publish.mp4')
  fs.copyFileSync(p('cut_accurate.mp4'), publishTarget)
  const retainedBytes = fs.readFileSync(publishTarget)
  const abandonedStage = outputStore.createStagingPath(publishTarget, 'cancelled-job')
  fs.writeFileSync(abandonedStage, 'partial output')
  outputStore.discardOutput(abandonedStage)
  check('cancelled stage preserves previous output', fs.readFileSync(publishTarget).equals(retainedBytes))
  const readyStage = outputStore.createStagingPath(publishTarget, 'completed-job')
  await ops.exportVideo({ input: SRC, output: readyStage, start: 1, end: 3, mode: 'accurate', onProgress: () => {} })
  const readyInfo = await ops.probe(readyStage)
  outputStore.publishOutput(readyStage, publishTarget)
  const publishedInfo = await ops.probe(publishTarget)
  check('validated staged export replaces target', near(publishedInfo.duration, readyInfo.duration) && publishedInfo.width > 0)

  console.log('\n4) Toc do (giu pitch)')
  for (const [sp, exp] of [[2, 5], [0.5, 4]]) {
    const o = p(`spd_${sp}.mp4`)
    await ops.exportVideo({ input: SRC, output: o, start: sp === 2 ? 0 : 2, end: sp === 2 ? 10 : 4, speed: sp, onProgress: () => {} })
    check(`speed ${sp}x`, near((await ops.probe(o)).duration, exp), `(${(await ops.probe(o)).duration.toFixed(2)})`)
  }

  console.log('\n5) Ti le khung')
  for (const [r, w, h] of [['9:16', 1080, 1920], ['1:1', 1080, 1080], ['16:9', 1920, 1080], ['4:5', 1080, 1350]]) {
    const o = p('r.mp4')
    await ops.exportVideo({ input: SRC, output: o, start: 0, end: 2, ratio: r, onProgress: () => {} })
    const oi = await ops.probe(o)
    check(`ratio ${r}`, oi.width === w && oi.height === h, `(${oi.width}x${oi.height})`)
  }
  check('ratioDims keeps the 1080 defaults and scales to 720/1440 with even sizes',
    JSON.stringify([ops.ratioDims('9:16'), ops.ratioDims('9:16', 720), ops.ratioDims('16:9', 720), ops.ratioDims('4:5', 1440), ops.ratioDims('original', 720)]) ===
    JSON.stringify([[1080, 1920], [720, 1280], [1280, 720], [1440, 1800], null]))
  const profileSizes = {}
  for (const [quality, resolution] of [['high', '720'], ['small', '720'], ['bogus', '999']]) {
    const job = ops.beginJob(`profile-${quality}`)
    await ops.runJob(job, async () => {
      ops.setOutputProfile({ quality, resolution })
      const args = ops.vencArgs()
      if (quality === 'high') check('high quality maps to a lower libx264 CRF', args[args.indexOf('-crf') + 1] === '16')
      if (quality === 'small') check('compact quality maps to a higher libx264 CRF', args[args.indexOf('-crf') + 1] === '24')
      if (quality === 'bogus') check('unknown quality/resolution fall back to standard 1080', args[args.indexOf('-crf') + 1] === '20' && JSON.stringify(ops.ratioDims('1:1', job.shortSide)) === '[1080,1080]')
      const o = p(`profile-${quality}.mp4`)
      await ops.exportVideo({ input: SRC, output: o, start: 0, end: 3, ratio: '9:16', onProgress: () => {} })
      profileSizes[quality] = { bytes: fs.statSync(o).size, info: await ops.probe(o) }
    })
    ops.endJob(`profile-${quality}`)
  }
  check('720p export honors the selected resolution', profileSizes.high.info.width === 720 && profileSizes.high.info.height === 1280, `(${profileSizes.high.info.width}x${profileSizes.high.info.height})`)
  check('high quality output is larger than compact output at the same resolution', profileSizes.high.bytes > profileSizes.small.bytes, `(${profileSizes.high.bytes} vs ${profileSizes.small.bytes} bytes)`)
  gen('crop-panels.mp4', ['-f', 'lavfi', '-i', 'color=c=red:s=320x480:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x480:r=30:d=2', '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  for (const [position, name] of [[0, 'left'], [1, 'right']]) {
    const out = p(`crop-${name}.mp4`)
    await ops.exportClips({ clips: [{ input: p('crop-panels.mp4'), kind: 'video', in: 0, out: 2, speed: 1, cropMode: 'fill', cropX: position, cropY: 0.5 }], output: out, ratio: '9:16' })
    const [red, green, blue] = pixelAt(out, 540, 960)
    check(`fill crop ${name} honors horizontal crop center`, position === 0 ? red > blue * 1.5 : blue > red * 1.5, `rgb=${red},${green},${blue}`)
  }
  const rotated = p('rotated.mp4')
  const rotateResult = spawnSync(ffmpegPath, ['-y', '-display_rotation', '90', '-i', p('main.mp4'), '-c', 'copy', rotated], { encoding: 'utf8' })
  if (rotateResult.status !== 0) throw new Error('generate rotated fixture: ' + rotateResult.stderr)
  const rotatedOut = p('original-rotated.mp4')
  await ops.exportClips({ clips: [{ input: rotated, kind: 'video', in: 0, out: 2, speed: 1, kenBurns: false }], output: rotatedOut, ratio: 'original' })
  const rotatedInfo = await ops.probe(rotatedOut)
  check('original canvas respects 90-degree source rotation', rotatedInfo.width === 480 && rotatedInfo.height === 640, `(${rotatedInfo.width}x${rotatedInfo.height})`)

  console.log('\n6) Bo loc mau (6 preset)')
  check('filter intensity 0 maps to no FFmpeg effect', ops.buildColorFilter('vivid', 0) === null)
  let filterOutputsValid = true
  for (const preset of filterPresets) for (const intensity of [0, 50, 100]) {
    const output = p(`filter-${preset.k}-${intensity}.mp4`)
    try {
      const colorFilter = ops.buildColorFilter(preset.k, intensity)
      await ops.exportVideo({ input: SRC, output, start: 0, end: 1.2, colorFilter, onProgress: () => {} })
      if ((await ops.probe(output)).duration < 0.7) filterOutputsValid = false
    } catch (error) { filterOutputsValid = false; console.error(`filter ${preset.k} ${intensity}:`, error.message) }
  }
  check('all filter presets export at 0/50/100 percent', filterOutputsValid)
  const exactFilter = p('filter-preview.png')
  await ops.renderFilterPreview({ input: SRC, time: 1, filterKey: 'warm', intensity: 50, output: exactFilter })
  check('exact filter preview renders using FFmpeg preset and intensity', fs.statSync(exactFilter).size > 1000)

  console.log('\n7) Thumbnails')
  const th = await ops.generateThumbnails(SRC, 8)
  check('8 thumbnails', th.length === 8)
  const cachedThumb = th[0]

  console.log('\n7b) Waveform (showwavespic)')
  const wv = await ops.generateWaveform(SRC)
  const wvi = wv ? await ops.probe(wv) : null
  check('waveform PNG hop le', !!wv && wvi.width === 1200, wv ? `(${wvi.width}x${wvi.height})` : '(null)')
  check('video khong tieng -> null', (await ops.generateWaveform(NA)) === null)
  const originalTimes = fs.statSync(SRC)
  try {
    const modifiedMtime = new Date(originalTimes.mtimeMs + 5000)
    fs.utimesSync(SRC, originalTimes.atime, modifiedMtime)
    const refreshedThumbs = await ops.generateThumbnails(SRC, 8)
    const refreshedWave = await ops.generateWaveform(SRC)
    check('cache fingerprint changes after file mtime changes', refreshedThumbs[0] !== cachedThumb && refreshedWave !== wv)
  } finally { fs.utimesSync(SRC, originalTimes.atime, originalTimes.mtime) }

  console.log('\n8) Tu xoa khoang lang')
  const sil = await ops.detectSilence(SRC, { noise: '-30dB', minSilence: 0.4 })
  const keep = ops.computeKeep(info.duration, sil)
  check('phat hien 2 khoang lang', sil.length === 2, `(${sil.length})`)
  check('giu lai 3 doan', keep.length === 3, `(${keep.length})`)
  gen('silence-edges.wav', ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono:d=0.5', '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le'])
  const edgeSilences = await ops.detectSilence(p('silence-edges.wav'), { noise: '-35dB', minSilence: 0.25 })
  const edgeInfo = await ops.probe(p('silence-edges.wav'))
  const edgeKeep = ops.computeKeep(edgeInfo.duration, edgeSilences.map((s) => ({ ...s, end: s.end ?? edgeInfo.duration })), 0.1)
  check('leading and trailing silence preserve only the speech window', edgeSilences.length === 2 && edgeKeep.length === 1 && edgeKeep[0].start > 0.3 && edgeKeep[0].end < edgeInfo.duration - 0.3,
    `(silences=${edgeSilences.length}, keep=${edgeKeep.map((s) => `${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(',')})`)
  gen('all-silence.wav', ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono:d=2', '-c:a', 'pcm_s16le'])
  const allSilentInfo = await ops.probe(p('all-silence.wav'))
  const allSilentWindows = await ops.detectSilence(p('all-silence.wav'), { noise: '-35dB', minSilence: 0.25 })
  check('fully silent audio produces no kept range', ops.computeKeep(allSilentInfo.duration, allSilentWindows.map((s) => ({ ...s, end: s.end ?? allSilentInfo.duration }))).length === 0)
  let noAudioRejected = false
  try { await ops.detectSilence(p('noaudio.mp4'), { noise: '-30dB', minSilence: 0.4 }) } catch { noAudioRejected = true }
  check('silence analysis rejects media with no audio stream', noAudioRejected)

  console.log('\n9) Tron am thanh (nhac nen)')
  await ops.mixAudio({ video: SRC, audio: p('music.mp3'), output: p('mix.mp4'), videoVol: 0.6, audioVol: 0.3, hasOrigAudio: true, loop: true })
  const mx = await ops.probe(p('mix.mp4'))
  check('mix giu do dai + co audio', near(mx.duration, 9) && mx.hasAudio, `(${mx.duration.toFixed(2)})`)
  await ops.mixAudio({ video: NA, audio: p('music.mp3'), output: p('mix2.mp4'), audioVol: 0.5, hasOrigAudio: false, loop: false })
  check('mix vao video khong tieng', near((await ops.probe(p('mix2.mp4'))).duration, 6))

  console.log('\n9b) Tron NHIEU track (nhac + giong + ducking)')
  gen('voice.wav', ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-c:a', 'pcm_s16le'])
  const trk = [
    { path: p('music.mp3'), volume: 0.4, loop: true, role: 'music' },
    { path: p('voice.wav'), volume: 1, loop: false, role: 'voice' }
  ]
  await ops.mixAudioTracks({ video: SRC, tracks: trk, output: p('mixmt.mp4'), videoVol: 0.8, hasOrigAudio: true, ducking: true })
  const mm = await ops.probe(p('mixmt.mp4'))
  check('2 track + ducking, giu do dai', near(mm.duration, 9) && mm.hasAudio, `(${mm.duration.toFixed(2)})`)
  await ops.mixAudioTracks({ video: NA, tracks: trk, output: p('mixmt2.mp4'), hasOrigAudio: false, ducking: true })
  check('2 track vao video khong tieng', near((await ops.probe(p('mixmt2.mp4'))).duration, 6))
  await ops.mixAudioTracks({ video: NA, tracks: [trk[1]], output: p('mixmt3.mp4'), hasOrigAudio: false, ducking: true })
  check('1 track (giong) - nhanh apad', near((await ops.probe(p('mixmt3.mp4'))).duration, 6))
  await ops.mixAudioTracks({ video: SRC, tracks: [{ ...trk[1], delay: 2000 }], output: p('mixmt4.mp4'), hasOrigAudio: true, ducking: false })
  check('giong co delay 2s (adelay)', near((await ops.probe(p('mixmt4.mp4'))).duration, 9))
  await ops.mixAudioTracks({ video: NA, output: p('audio-items.mp4'), hasOrigAudio: false, totalDuration: 6, ducking: false, tracks: [
    { path: p('music.mp3'), role: 'music', in: 0.5, out: 1.5, start: 0, volume: 0.3, loop: true, fadeIn: 0.5, fadeOut: 1 },
    { path: p('voice.wav'), role: 'voice', in: 0.2, out: 1.2, start: 2, volume: 0.8, loop: false, fadeIn: 0.2, fadeOut: 0.2 }
  ] })
  const audioItemsInfo = await ops.probe(p('audio-items.mp4'))
  const earlyMusic = rmsAt('audio-items.mp4', 0.1), fullMusic = rmsAt('audio-items.mp4', 0.8)
  const atVoice = rmsAt('audio-items.mp4', 2.4), loopedMusic = rmsAt('audio-items.mp4', 4.5), fadedMusic = rmsAt('audio-items.mp4', 5.9)
  check('audio items keep V1 duration and loop a trimmed source range', audioItemsInfo.hasAudio && near(audioItemsInfo.duration, 6, 0.4) && loopedMusic > 0.01,
    `(duration=${audioItemsInfo.duration.toFixed(2)}, loop-rms=${loopedMusic.toFixed(4)})`)
  check('audio item offset, gain and fades affect output level', fullMusic > earlyMusic * 1.7 && atVoice > fullMusic * 1.2 && fadedMusic < loopedMusic * 0.6)
  await ops.mixAudioTracks({ video: SRC, tracks: [
    { path: p('music.mp3'), volume: 4, loop: true, role: 'music' },
    { path: p('music.mp3'), volume: 4, loop: true, role: 'voice' }
  ], output: p('mix-limited.mp4'), videoVol: 1, hasOrigAudio: true, ducking: false, totalDuration: 9 })
  const limiterCheck = spawnSync(ffmpegPath, ['-v', 'info', '-i', p('mix-limited.mp4'), '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const limitedPeak = Number((limiterCheck.stderr.match(/max_volume:\s*(-?[\d.]+) dB/) || [])[1])
  check('combined high-gain tracks are limited below digital clipping', limiterCheck.status === 0 && Number.isFinite(limitedPeak) && limitedPeak < -0.1, `(peak=${limitedPeak} dB)`)
  await ops.mixAudioTracks({ video: p('video10.mp4'), tracks: [
    { path: p('voice.wav'), role: 'voice', start: 2, in: 0, out: 2, volume: 1 },
    { path: p('music.mp3'), role: 'music', start: 0, in: 0, out: 3, volume: 0.4, loop: true }
  ], output: p('mix-v10-voice-music.mp4'), hasOrigAudio: false, ducking: true, totalDuration: 10 })
  check('10s V1 duration is preserved with 2s-offset voice and 3s music', near((await ops.probe(p('mix-v10-voice-music.mp4'))).duration, 10, 0.2))
  await ops.mixAudioTracks({ video: p('video10.mp4'), tracks: [{ path: p('voice.wav'), role: 'voice', start: 2, in: 0, out: 2, volume: 1 }],
    output: p('mix-v10-voice-offset.mp4'), hasOrigAudio: false, ducking: false, totalDuration: 10 })
  check('voice starts after its 2s timeline offset', rmsAt('mix-v10-voice-offset.mp4', 0.5) < 0.0001 && rmsAt('mix-v10-voice-offset.mp4', 2.4) > 0.01)

  console.log('\n9c) Doi giong (re-dub): ghep TTS theo timeline')
  // cau 1: 1.5s vao slot 3s (giu nguyen); cau 2: 3s vao slot 2s (phai atempo 1.5x -> ~2s)
  gen('seg0.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:a', 'pcm_s16le'])
  gen('seg1.wav', ['-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:a', 'pcm_s16le'])
  await ops.buildRedubTrack({
    parts: [{ path: p('seg0.wav'), start: 0.5, slot: 3 }, { path: p('seg1.wav'), start: 4, slot: 2 }],
    totalDur: 8, output: p('redub.wav')
  })
  const rd = await ops.probe(p('redub.wav'))
  check('track redub dai dung timeline (8s)', near(rd.duration, 8, 0.15), `(${rd.duration.toFixed(2)})`)
  let redubOverflowMessage = ''
  try { await ops.buildRedubTrack({ parts: [{ path: p('seg1.wav'), start: 0, slot: 0.5 }], totalDur: 2, output: p('redub-overflow.wav') }) }
  catch (error) { redubOverflowMessage = error.message }
  check('redub rejects speech that would need more than 4x compression', /vượt quá tốc độ co tối đa 4×/.test(redubOverflowMessage))
  await ops.mixAudioTracks({
    video: SRC, tracks: [{ path: p('redub.wav'), volume: 1, loop: false, role: 'voice' }],
    output: p('redubmix.mp4'), videoVol: 0, hasOrigAudio: true, ducking: false
  })
  const rm = await ops.probe(p('redubmix.mp4'))
  check('tron redub vao video (tat tieng goc)', near(rm.duration, 9) && rm.hasAudio, `(${rm.duration.toFixed(2)})`)
  await ops.mixAudioTracks({ video: SRC, tracks: [], output: p('mute-original.mp4'), videoVol: 0, hasOrigAudio: true })
  const mutedProbe = await ops.probe(p('mute-original.mp4'))
  const mutedCheck = spawnSync(ffmpegPath, ['-i', p('mute-original.mp4'), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const maxVolume = Number((mutedCheck.stderr.match(/max_volume:\s*(-?[\d.]+) dB/) || [])[1])
  check('original volume 0 khong can track them', mutedProbe.hasAudio && near(mutedProbe.duration, 9) && (!Number.isFinite(maxVolume) || maxVolume < -60),
    `(max=${Number.isFinite(maxVolume) ? maxVolume : '-inf'}dB)`)
  await ops.buildRedubTrack({ parts: [{ path: p('seg0.wav'), start: 1, slot: 5 }], totalDur: 6, output: p('redub1.wav') })
  check('redub 1 cau (khong amix)', near((await ops.probe(p('redub1.wav'))).duration, 6, 0.15))

  console.log('\n10) Ghep nhieu clip (+ chuyen canh fade)')
  const clips = [{ input: SRC, in: 1, out: 4, speed: 1 }, { input: NA, in: 0, out: 4, speed: 2 }]
  await ops.exportClips({ clips, output: p('multi.mp4'), ratio: '9:16', transition: { type: 'fade', dur: 0.4 }, onProgress: () => {} })
  const mc = await ops.probe(p('multi.mp4'))
  check('ghep 2 clip -> 9:16, co audio', mc.width === 1080 && mc.hasAudio && near(mc.duration, 4.5))
  const acceptanceClips = [{ input: SRC, in: 0, out: 3, speed: 1 }, { input: SRC, in: 1, out: 5, speed: 1 }]
  await ops.exportClips({ clips: acceptanceClips, output: p('transition-fade-duration.mp4'), ratio: '16:9', transition: { type: 'fade', dur: 0.5 } })
  const fadeDurationInfo = await ops.probe(p('transition-fade-duration.mp4'))
  check('fade-to-black keeps total duration unchanged', near(fadeDurationInfo.duration, 7, 0.3))
  const transitionProgress = []
  await ops.exportClips({ clips: acceptanceClips, output: p('transition-cross-duration.mp4'), ratio: '16:9', transition: { type: 'crossfade', dur: 0.5 }, onProgress: (value) => transitionProgress.push(value) })
  const crossDurationInfo = await ops.probe(p('transition-cross-duration.mp4'))
  check('3s + 4s crossfade 0.5s exports 6.5s and monotonic progress', near(crossDurationInfo.duration, 6.5, 0.3) && transitionProgress.length > 2 && transitionProgress.every((value, index) => index === 0 || value >= transitionProgress[index - 1]))
  await ops.exportClips({ clips: [{ input: SRC, in: 0, out: 0.3, speed: 1 }, { input: NA, in: 0, out: 0.4, speed: 1 }], output: p('transition-short.mp4'), ratio: '16:9', transition: { type: 'crossfade', dur: 0.5 } })
  const shortTransitionInfo = await ops.probe(p('transition-short.mp4'))
  check('short clip crossfade clamps overlap without graph error', near(shortTransitionInfo.duration, 0.55, 0.15))
  const plannedCrossfade = [
    { clipId: 'a', start: 0, end: 3, overlapIn: 0 },
    { clipId: 'b', start: 2.5, end: 4.5, overlapIn: 0.5 }
  ]
  await ops.exportClips({ clips, output: p('multi-plan-xfade.mp4'), ratio: '9:16', transition: { type: 'crossfade', dur: 0.5 }, editPlan: plannedCrossfade, onProgress: () => {} })
  const xfadeInfo = await ops.probe(p('multi-plan-xfade.mp4'))
  check('crossfade export follows planned overlap and duration', xfadeInfo.hasAudio && near(xfadeInfo.duration, 4.5, 0.35))

  await ops.compositeVideoOverlays({ input: p('main.mp4'), output: p('v2-overlay.mp4'), overlays: [
    { id: 'v2-red', path: p('still # photo.png'), kind: 'image', start: 2, in: 0, out: 2, speed: 1, x: 0.5, y: 0.5, width: 0.25, height: 0.25, opacity: 1, zIndex: 0 }
  ] })
  const v2Info = await ops.probe(p('v2-overlay.mp4'))
  const centerFrame = spawnSync(ffmpegPath, ['-v', 'error', '-ss', '3', '-i', p('v2-overlay.mp4'), '-frames:v', '1', '-vf', 'crop=1:1:320:240,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
  const centerRgb = centerFrame.stdout || Buffer.alloc(0)
  check('V2 overlay export preserves V1 duration and audio', v2Info.hasAudio && near(v2Info.duration, 9, 0.3))
  check('V2 overlay is composited at its timeline position', centerFrame.status === 0 && centerRgb.length >= 3 && centerRgb[0] > 180 && centerRgb[1] < 90 && centerRgb[2] < 90)
  await ops.compositeVideoOverlays({ input: p('main.mp4'), output: p('v2-video-speed.mp4'), overlays: [
    { id: 'v2-blue', path: p('blue-v2.mp4'), kind: 'video', start: 1, in: 0, out: 2, speed: 2, x: 0.5, y: 0.5, width: 0.25, height: 0.25, opacity: 1, zIndex: 0 }
  ] })
  const videoAt = (time) => spawnSync(ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', p('v2-video-speed.mp4'), '-frames:v', '1', '-vf', 'crop=1:1:320:240,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
  const blueDuring = videoAt(1.5), blueAfter = videoAt(2.4)
  const duringRgb = blueDuring.stdout || Buffer.alloc(0), afterRgb = blueAfter.stdout || Buffer.alloc(0)
  check('V2 video obeys source speed and timeline end', blueDuring.status === 0 && duringRgb.length >= 3 && duringRgb[2] > 160 && afterRgb.length >= 3 && !(afterRgb[2] > 160 && afterRgb[0] < 100))
  await ops.compositeVideoOverlays({ input: p('main.mp4'), output: p('v2-layer-order.mp4'), overlays: [
    { path: p('green-v2.png'), kind: 'image', start: 2, in: 0, out: 2, x: 0.5, y: 0.5, width: 0.25, height: 0.25, opacity: 1, zIndex: 2 },
    { path: p('still # photo.png'), kind: 'image', start: 2, in: 0, out: 2, x: 0.5, y: 0.5, width: 0.25, height: 0.25, opacity: 1, zIndex: 1 }
  ] })
  const layerFrame = spawnSync(ffmpegPath, ['-v', 'error', '-ss', '3', '-i', p('v2-layer-order.mp4'), '-frames:v', '1', '-vf', 'crop=1:1:320:240,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
  const layerRgb = layerFrame.stdout || Buffer.alloc(0)
  check('V2 overlays composite in z-order, independent of input order', layerFrame.status === 0 && layerRgb.length >= 3 && layerRgb[1] > layerRgb[0] + 35)
  await ops.compositeVideoOverlays({ input: p('blue-v2.mp4'), output: p('v2-opacity.mp4'), overlays: [
    { path: p('still # photo.png'), kind: 'image', start: 0, in: 0, out: 2, x: 0.5, y: 0.5, width: 1, height: 1, opacity: 0.5, zIndex: 0 }
  ] })
  const opacityFrame = spawnSync(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', p('v2-opacity.mp4'), '-frames:v', '1', '-vf', 'crop=1:1:32:32,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
  const opacityRgb = opacityFrame.stdout || Buffer.alloc(0)
  check('V2 opacity blends with the V1 pixels', opacityFrame.status === 0 && opacityRgb.length >= 3 && opacityRgb[0] > 70 && opacityRgb[2] > 70 && opacityRgb[1] < 80)
  await ops.compositeVideoOverlays({ input: p('main.mp4'), output: p('v2-animated-gif.mp4'), overlays: [
    { path: p('animated.gif'), kind: 'image', animated: true, start: 2, in: 0, out: 2, x: 0.5, y: 0.5, width: 0.5, height: 0.5, opacity: 1, zIndex: 0 }
  ] })
  const gifInfo = await ops.probe(p('v2-animated-gif.mp4'))
  const gifRegion = (time) => spawnSync(ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', p('v2-animated-gif.mp4'), '-frames:v', '1', '-vf', 'crop=200:200:220:140,format=rgb24', '-f', 'rawvideo', 'pipe:1'])
  const gifFrameA = gifRegion(2.2).stdout || Buffer.alloc(0), gifFrameB = gifRegion(2.8).stdout || Buffer.alloc(0)
  check('V2 animated GIF exports as changing frames in its active range', near(gifInfo.duration, 9, 0.3) && gifFrameA.length > 0 && gifFrameB.length > 0 && !gifFrameA.equals(gifFrameB))

  console.log('\n11) Audio timeline (cho phu de da clip)')
  await ops.buildTimelineAudioWav(clips, p('tl.wav'))
  check('timeline audio ~4.5s', near((await ops.probe(p('tl.wav'))).duration, 4.5))
  await ops.buildTimelineAudioWav(clips, p('tl-xfade.wav'), plannedCrossfade)
  check('timeline transcription audio uses planned crossfade duration', near((await ops.probe(p('tl-xfade.wav'))).duration, 4.5, 0.15))
  const oneClipEdit = [{ clipId: 'source', start: 0, end: 2, sourceStart: 1, sourceEnd: 3, speed: 1,
    overlapIn: 0 }, { clipId: 'source', start: 2, end: 3, sourceStart: 5, sourceEnd: 7, speed: 2, overlapIn: 0 }]
  await ops.buildTimelineAudioWav([{ id: 'source', input: SRC, in: 0, out: 9, speed: 1 }], p('tl-cut-speed.wav'), oneClipEdit)
  check('single-clip transcription audio follows exact kept source ranges and speed', near((await ops.probe(p('tl-cut-speed.wav'))).duration, 3, 0.15))
  await ops.buildVoiceSourceWav({ tracks: [{ path: p('music.mp3'), in: 0, out: 1, start: 2, gain: 1 }], totalDuration: 5, output: p('voice-source.wav') })
  check('voice ASR source honors track offset and pads to canvas duration', near((await ops.probe(p('voice-source.wav'))).duration, 5, 0.15) && rmsAt('voice-source.wav', 0.5) < 0.0001 && rmsAt('voice-source.wav', 2.5) > 0.01)

  console.log('\n12) Phu de: ASS + map + burn')
  check('rgbToAss(#ff0000)=0000FF', caps.rgbToAss('#ff0000') === '0000FF')
  const mapped = caps.mapToOutput([{ start: 3, end: 5, text: 'x' }], [{ start: 2, end: 6 }], 2)
  check('mapToOutput cat2-6 speed2 -> 0.5..1.5', near(mapped[0].start, 0.5, 0.1) && near(mapped[0].end, 1.5, 0.1))
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tc-'))
  await ops.exportVideo({ input: SRC, output: p('core.mp4'), start: 0, end: 4, ratio: '9:16', onProgress: () => {} })
  const d = await ops.probe(p('core.mp4'))
  await ops.decodeOutput(p('core.mp4'))
  check('full export validation decodes every video and audio stream', true)
  await ops.writeAiEditMetadata({ input: p('core.mp4'), output: p('core-ai-marked.mp4') })
  const markedProbe = spawnSync(require('ffprobe-static').path, ['-v', 'error', '-show_entries', 'format_tags=comment', '-of', 'default=noprint_wrappers=1:nokey=1', p('core-ai-marked.mp4')], { encoding: 'utf8' })
  const markedInfo = await ops.probe(p('core-ai-marked.mp4'))
  check('AI edit marker is written without changing exported duration', markedProbe.status === 0 && markedProbe.stdout.includes('TaoClip: AI-assisted editing applied') && near(markedInfo.duration, d.duration, 0.15))
  const ass = caps.toAss([{ start: 1, end: 3, text: 'Phụ đề' }, { start: 0, end: 4, text: 'Tiêu đề', pos: { x: d.width / 2, y: d.height / 4 }, fs: 80, color: 'FFD34E' }], { width: d.width, height: d.height })
  fs.writeFileSync(path.join(tmp, 's.ass'), ass, 'utf8')
  await ops.burnSubtitles({ input: p('core.mp4'), assFile: path.join(tmp, 's.ass'), output: p('burn.mp4') })
  check('khac phu de + chu', (await ops.probe(p('burn.mp4'))).width === 1080)
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log('\n13) Encoder (GPU neu co)')
  const enc = await ops.detectBestEncoder()
  check('detect encoder', ['cpu', 'nvenc', 'qsv', 'amf'].includes(enc), `(${enc})`)

  console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
  if (fail) process.exit(1)
}

run().catch((e) => { console.error('\x1b[31mLOI TEST:\x1b[0m', e.message || e); process.exit(1) })

// Ghi chu: de test Whisper (phu de) + TTS (long tieng) - can mang tai model lan dau:
//   node -e "require('./electron/ffmpeg-ops.cjs').configure(require('ffmpeg-static'),require('ffprobe-static').path); require('./electron/tts.cjs').synthesize('Xin chào', './.testout/v.wav').then(r=>console.log('TTS OK', r.duration))"
