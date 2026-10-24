// ============================================================
//  Kiem thu e2e tren Electron that:  npm run test:e2e   (them --skip-build neu dist/ moi build)
//  Moi kich ban mo mot ban app moi voi userData rieng, dung chuot/tha file that qua CDP.
//  Loc kich ban:  node e2e/run.cjs <tu-khoa>
// ============================================================
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { repo, sleep, probeDuration, probeStreams, pixelAt, rmsAt, channelRmsAt, makeFixtures, launchApp, projectOf } = require('./lib.cjs')

const argv = process.argv.slice(2)
const filter = argv.find((arg) => !arg.startsWith('--'))
if (!argv.includes('--skip-build')) {
  console.log('Build renderer (vite build)...')
  const build = spawnSync(process.execPath, [path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: repo, encoding: 'utf8' })
  if (build.status !== 0) { console.error(build.stdout + build.stderr); process.exit(1) }
}

const fx = makeFixtures()
const scenarios = []
const scenario = (name, fn) => scenarios.push({ name, fn })
let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (detail ? '  ' + detail : '')) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

scenario('khoi dong: khong loi runtime, khung giao dien dung', async () => {
  const app = await launchApp()
  try {
    await app.waitFor(`!!document.querySelector('.cc-top') && !!document.querySelector('.cc-tl')`, { label: 'giao dien' })
    await sleep(800)
    check('trang dung duoc (thanh tren + timeline)', true)
    check('khong co loi/exception trong console', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    check('bridge Electron co san (window.taoclip)', await app.eval(`typeof window.taoclip?.exportVideo === 'function'`))
  } finally { app.close() }
})

scenario('khoi phuc project: video phat, tua, thumbnail nap', async () => {
  const app = await launchApp({ project: projectOf(fx) })
  try {
    await app.restoreProject()
    await app.waitFor(`(() => { const v = document.querySelector('.cc-frame video'); return !!v && v.readyState >= 1 && !v.error })()`, { label: 'video san sang' })
    check('timeline co 2 clip', (await app.count('.cc-clip')) === 2)
    const src = await app.eval(`document.querySelector('.cc-frame video').src`)
    check('video nap qua giao thuc taoclip-media', src.startsWith('taoclip-media://'), src.slice(0, 60))
    const ranged = app.mediaResponses.filter((r) => r.url.includes('video-a'))
    check('giao thuc media ho tro Range: tra 206 + Content-Range + Accept-Ranges', ranged.some((r) => r.status === 206 && /^bytes \d+-\d+\/\d+$/.test(r.contentRange || '') && r.acceptRanges === 'bytes'), JSON.stringify(ranged.slice(0, 2)))
    await app.click('.cc-pctrl .play')
    await app.waitFor(`document.querySelector('.cc-frame video').currentTime > 0.6`, { label: 'video chay', timeout: 8000 })
    check('video phat (currentTime tang)', true)
    await app.click('.cc-pctrl .play')
    await app.waitFor(`document.querySelectorAll('.cc-clip .strip img').length > 0 && [...document.querySelectorAll('.cc-clip .strip img')].every(i => i.complete && i.naturalWidth > 0)`, { label: 'thumbnail', timeout: 20000 })
    check('thumbnail clip nap duoc', true)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('xuat MP4 that 720p chat luong nho tu giao dien', async () => {
  const out = path.join(fx.dir, 'e2e-export.mp4').replace(/\\/g, '/')
  try { fs.rmSync(out, { force: true }) } catch {}
  const app = await launchApp({ project: projectOf(fx), dialogs: { saveVideo: out } })
  try {
    await app.restoreProject()
    await app.click('.cc-top .cc-export')
    await app.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
    await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === '720p').click()`)
    await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === 'Nhỏ gọn').click()`)
    await app.click('.cc-modal-box .exp-start')
    await app.waitFor(`!document.querySelector('.cc-modal-box')`, { timeout: 120000, label: 'xuat xong', interval: 500 })
    check('file xuat ton tai', fs.existsSync(out) && fs.statSync(out).size > 10000)
    const duration = probeDuration(out)
    check('thoi luong ~ 9s (5s + 4s)', near(duration, 9, 0.4), `(${duration.toFixed(2)}s)`)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('du an cu co nhac nen + long tieng: mo duoc, thanh audio item tren timeline', async () => {
  const project = projectOf(fx, { music: { path: fx.toneA, name: 'tone-a.wav' }, voice: { path: fx.toneB, name: 'tone-b.wav' },
    bgDur: 3, voiceDur: 3, voiceOffset: 1, musicVol: 0.4, voiceVol: 1, bgLoop: true })
  const app = await launchApp({ project })
  try {
    await app.restoreProject()
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 2`, { label: '2 audio item' })
    check('nhac nen + long tieng cu thanh 2 audio item', true)
    check('chong thoi gian nen xep 2 track audio khac nhau (A2, A3)', await app.eval(`(() => { const ids = [...document.querySelectorAll('.cc-audio-item-clip')].map(el => el.closest('.cc-trow').dataset.trackId).sort(); return ids.join() === 'A2,A3' })()`))
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('am thanh: nut Them nhac nen va tha 2 file audio deu thanh audio item, xuat co tieng', async () => {
  const out = path.join(fx.dir, 'e2e-audio-export.mp4').replace(/\\/g, '/')
  try { fs.rmSync(out, { force: true }) } catch {}
  const app = await launchApp({ project: projectOf(fx), dialogs: { openAudio: fx.toneA, saveVideo: out } })
  try {
    await app.restoreProject()
    await app.clickText('.cc-rail button', 'Âm thanh')
    await app.clickText('.cc-cap .cc-import', 'Thêm nhạc nền')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'nhac nen tu nut' })
    check('nut Them nhac nen tao 1 audio item', true)
    await app.dropFiles([fx.toneA.replace(/\//g, '\\'), fx.toneB.replace(/\//g, '\\')], 640, 300)
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 3`, { label: 'thanh 3 audio item', timeout: 20000 })
    check('tha 2 file audio -> them 2 audio item (khong con gioi han 1 file nhac)', true)
    await app.click('.cc-top .cc-export')
    await app.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
    await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === '720p').click()`)
    await app.click('.cc-modal-box .exp-start')
    await app.waitFor(`!document.querySelector('.cc-modal-box')`, { timeout: 120000, label: 'xuat xong', interval: 500 })
    check('file xuat co ca hinh va tieng', probeStreams(out).includes('video') && probeStreams(out).includes('audio'), probeStreams(out).join(','))
    check('thoi luong ~ 9s', near(probeDuration(out), 9, 0.5), `(${probeDuration(out).toFixed(2)}s)`)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

async function exportFromUi(app, out) {
  try { fs.rmSync(out, { force: true }) } catch {}
  await app.click('.cc-top .cc-export')
  await app.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
  await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === '720p').click()`)
  await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === 'Nhỏ gọn').click()`)
  await app.click('.cc-modal-box .exp-start')
  await app.waitFor(`!document.querySelector('.cc-modal-box')`, { timeout: 120000, label: 'xuat xong', interval: 500 })
}
const looksRed = ([r, g, b]) => r > 200 && g < 70 && b < 70

scenario('timeline hai vung: hinh o tren, tieng o duoi, item chong nhau xep nhieu track', async () => {
  const overlay = (id, start) => ({ id, path: fx.image, name: 'image.png', kind: 'image', start, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 })
  const app = await launchApp({ project: projectOf(fx, { videoOverlays: [overlay('o1', 0), overlay('o2', 1)] }) })
  try {
    await app.restoreProject()
    await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2`, { label: '2 item phu' })
    const rows = await app.eval(`[...document.querySelectorAll('.cc-trow')].map((r) => ({ id: r.dataset.trackId, top: r.getBoundingClientRect().top, zone: r.closest('.cc-zone')?.classList.contains('audio') ? 'audio' : 'video' })).sort((a, b) => a.top - b.top)`)
    check('thu tu tu tren xuong: V3, V2, V1, A1, A2, A3 (co san 3 duong hinh + 3 duong tieng)', rows.map((r) => r.id).join() === 'V3,V2,V1,A1,A2,A3', rows.map((r) => r.id).join())
    check('cac track hinh nam tren vung tieng', rows.filter((r) => r.zone === 'video').every((r) => r.top < rows.find((x) => x.zone === 'audio').top))
    check('2 item phu chong thoi gian nam o 2 track khac nhau', await app.eval(`[...document.querySelectorAll('.cc-v2-clip')].map(el => el.closest('.cc-trow').dataset.trackId).sort().join() === 'V2,V3'`))
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('track: them / xoa track trong, khoa V1 chan xoa clip', async () => {
  const app = await launchApp({ project: projectOf(fx) })
  try {
    await app.restoreProject()
    check('3 duong co san (V1..V3, A1..A3) khong co nut xoa', await app.eval(`['V1','V2','V3','A1','A2','A3'].every((id) => document.querySelector('.cc-trow[data-track-id="' + id + '"] .cc-thead .tools').querySelectorAll('button').length <= (id[0] === 'V' ? 2 : 3))`))
    await app.clickText('.cc-tlbar button', '+ Track hình')
    await app.waitFor(`!!document.querySelector('.cc-trow[data-track-id="V4"]')`, { label: 'track V4' })
    await app.clickText('.cc-tlbar button', '+ Track tiếng')
    await app.waitFor(`!!document.querySelector('.cc-trow[data-track-id="A4"]')`, { label: 'track A4' })
    check('them track hinh V4 va track tieng A4 bang nut (sau 3 duong co san)', true)
    await app.click('.cc-trow[data-track-id="V4"] .cc-thead .tools button', 2) // nut xoa track trong (sau nut an va nut khoa)
    await app.waitFor(`!document.querySelector('.cc-trow[data-track-id="V4"]')`, { label: 'xoa V4' })
    check('xoa duoc track them (V4) khi trong', true)
    await app.click('.cc-clip', 0)
    await app.key('Delete')
    await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'xoa clip khi chua khoa' })
    check('chua khoa: phim Delete xoa clip dang chon', true)
    await app.click('.cc-trow[data-track-id="V1"] .cc-thead .tools button', 1) // khoa V1
    await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V1"]').classList.contains('locked')`, { label: 'V1 khoa' })
    await app.click('.cc-clip', 0)
    await app.key('Delete')
    await sleep(500)
    check('V1 dang khoa: Delete khong xoa clip', (await app.count('.cc-clip')) === 1)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('xuat ton trong an track hinh va tat tieng track audio', async () => {
  const out = path.join(fx.dir, 'e2e-visibility.mp4').replace(/\\/g, '/')
  const project = { version: 4, projectId: 'e2e-visibility', name: 'E2E',
    clips: [{ id: 'c1', path: fx.videoSilent, name: 'video-silent.mp4', kind: 'video', in: 0, out: 3, speed: 1 }],
    videoOverlays: [{ id: 'o1', path: fx.image, name: 'image.png', kind: 'image', start: 0, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.6, height: 0.6, opacity: 1 }],
    audioItems: [{ id: 'a1', path: fx.toneA, name: 'tone-a.wav', track: 'music', start: 0, in: 0, out: 3, gain: 1 }] }
  const app = await launchApp({ project, dialogs: { saveVideo: out } })
  try {
    await app.restoreProject()
    await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1 && document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'item phu + audio' })
    await exportFromUi(app, out)
    check('day du: co ca hinh va tieng', probeStreams(out).includes('audio'), probeStreams(out).join(','))
    check('day du: anh phu (do) nam giua khung', looksRed(pixelAt(out, 360, 640)), JSON.stringify(pixelAt(out, 360, 640)))
    await app.click('.cc-trow[data-track-id="V2"] .cc-thead .tools button', 0) // an V2
    await app.click('.cc-trow[data-track-id="A2"] .cc-thead .tools button', 0) // tat tieng A2
    await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V2"]').classList.contains('hidden') && document.querySelector('.cc-trow[data-track-id="A2"]').classList.contains('muted')`, { label: 'an V2 + tat tieng A2' })
    await exportFromUi(app, out)
    check('an V2: anh phu khong con trong ban xuat', !looksRed(pixelAt(out, 360, 640)), JSON.stringify(pixelAt(out, 360, 640)))
    check('tat tieng A2: ban xuat khong con luong audio', !probeStreams(out).includes('audio'), probeStreams(out).join(','))
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

const win = (file) => file.replace(/\//g, '\\')
const trackOf = (app, selector) => app.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => el.closest('.cc-trow').dataset.trackId)`)

scenario('tha file vao dung lane: chen giua V1, audio tren A1 sang A2, vung track moi', async () => {
  const app = await launchApp({ project: projectOf(fx) })
  try {
    await app.restoreProject()
    // 1) anh tha vao V1 tai giay 5.5 -> chen giua video-a (0-5s) va video-b
    await app.dropOnLane({ files: [win(fx.image)], row: '.cc-trow[data-track-id="V1"]', time: 5.5 })
    await app.waitFor(`document.querySelectorAll('.cc-clip').length === 3`, { label: 'chen anh vao V1' })
    const order = await app.eval(`[...document.querySelectorAll('.cc-clip .strip')].map((el) => el.title)`)
    check('anh duoc chen giua hai clip (khong noi duoi)', order.join() === 'video-a.mp4,image.png,video-b.mp4', order.join())
    // 2) audio tha len A1 tai giay 2: A1 dang bi tieng goc cua V1 chiem -> sang A2
    await app.dropOnLane({ files: [win(fx.toneA)], row: '.cc-trow[data-track-id="A1"]', time: 2 })
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'audio tha vao A1' })
    check('audio tha len A1 dang co tieng goc -> tu sang A2', (await trackOf(app, '.cc-audio-item-clip')).join() === 'A2')
    const left = await app.eval(`parseFloat(document.querySelector('.cc-audio-item-clip').style.left)`)
    check('audio dat dung thoi diem tha (~2s = 160px)', Math.abs(left - 160) < 12, `(${left}px)`)
    // 3) audio tha vao vung "tao track tieng moi" -> A3
    await app.dropOnLane({ files: [win(fx.toneB)], row: '.cc-newtrack[data-newtrack="audio"]' })
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 2`, { label: 'audio vao track moi' })
    check('tha vao vung track moi -> tao track moi sau A3 (A4)', (await trackOf(app, '.cc-audio-item-clip')).sort().join() === 'A2,A4')
    // 4) anh tha vao vung "tao track hinh moi" -> V2
    await app.dropOnLane({ files: [win(fx.image)], row: '.cc-newtrack[data-newtrack="video"]' })
    await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1`, { label: 'item phu vao track moi' })
    check('tha vao vung track hinh moi -> tao track moi sau V3 (V4)', (await trackOf(app, '.cc-v2-clip')).join() === 'V4')
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('keo asset thu vien xuong lane V2 tai thoi diem tha', async () => {
  const app = await launchApp({ project: projectOf(fx) })
  try {
    await app.restoreProject()
    await app.click('.cc-trow[data-track-id="V1"]', 0) // dam bao timeline khong bi che boi popup nao
    await app.clickText('.cc-tlbar button', '+ Track hình')
    await app.waitFor(`!!document.querySelector('.cc-trow[data-track-id="V2"]')`, { label: 'V2' })
    await app.dropOnLane({ assets: [{ path: fx.videoB, kind: 'video', name: 'video-b.mp4' }], row: '.cc-trow[data-track-id="V2"]', time: 3 })
    await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1`, { label: 'asset tha vao V2' })
    const left = await app.eval(`parseFloat(document.querySelector('.cc-v2-clip').style.left)`)
    check('asset thu vien tha vao V2 dung thoi diem (~3s = 240px)', Math.abs(left - 240) < 12 && (await trackOf(app, '.cc-v2-clip')).join() === 'V2', `(${left}px)`)
    const draggable = await app.eval(`document.querySelectorAll('.cc-card[draggable="true"]').length > 0`)
    check('the asset trong thu vien keo duoc (draggable)', draggable)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('keo item tren timeline: doi thoi diem (ngang), doi track (doc), va cham sang track moi', async () => {
  const overlay = (id, start) => ({ id, path: fx.image, name: id + '.png', kind: 'image', start, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 })
  const project = projectOf(fx, { videoOverlays: [overlay('o1', 0), overlay('o2', 1)], audioItems: [{ id: 'm1', path: fx.toneA, name: 'tone.wav', track: 'music', start: 0, in: 0, out: 3, gain: 0.4 }] })
  const app = await launchApp({ project })
  try {
    await app.restoreProject()
    await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2 && document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'item' })
    // ngang: keo audio sang phai 2s (160px)
    const audio = await app.center('.cc-audio-item-clip')
    await app.dragBy(audio, { x: audio.x + 160, y: audio.y })
    await app.waitFor(`Math.abs(parseFloat(document.querySelector('.cc-audio-item-clip').style.left) - 160) < 14`, { label: 'audio doi thoi diem' })
    check('keo ngang: audio doi thoi diem (+2s)', true)
    // doc: keo audio xuong track A3 (co san); cuon xuong de A2 va A3 cung nam trong tam nhin
    await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 99999`)
    const audio2 = await app.center('.cc-audio-item-clip')
    const a3 = await app.center('.cc-trow[data-track-id="A3"] .cc-tlane')
    await app.dragBy(audio2, { x: audio2.x, y: a3.y })
    await app.waitFor(`document.querySelector('.cc-audio-item-clip').closest('.cc-trow').dataset.trackId === 'A3'`, { label: 'audio sang A3' })
    check('keo doc: audio doi sang track A3', true)
    // va cham: o1 (V2, 0-3s) keo len V3 noi o2 (1-4s) dang chiem -> het duong trong nen tao V4
    await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
    const o1 = await app.center('.cc-trow[data-track-id="V2"] .cc-v2-clip')
    const v3 = await app.center('.cc-trow[data-track-id="V3"] .cc-tlane')
    await app.dragBy(o1, { x: o1.x, y: v3.y })
    await app.waitFor(`!!document.querySelector('.cc-trow[data-track-id="V4"] .cc-v2-clip')`, { label: 'o1 sang V4' })
    check('va cham khi tha: item tu chuyen sang track ke tiep V4 (tao moi khi het duong)', (await trackOf(app, '.cc-v2-clip')).sort().join() === 'V3,V4')
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('tach am thanh: tieng thanh audio rieng tren A1, xuat dung, xoa doan tach -> clip im, gan lai', async () => {
  const out = path.join(fx.dir, 'e2e-detach.mp4').replace(/\\/g, '/')
  const app = await launchApp({ project: projectOf(fx), dialogs: { saveVideo: out } })
  try {
    await app.restoreProject()
    await app.waitFor(`document.querySelectorAll('.cc-aclip').length === 2`, { label: '2 khoi tieng goc tren A1' })
    await app.click('.cc-clip', 0)
    await app.clickText('.cc-tlbar button', 'Tách âm thanh')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip.original').length === 1`, { label: 'doan tieng tach' })
    check('tach: tieng thanh 1 audio item (vai tro original) tren A1', (await trackOf(app, '.cc-audio-item-clip.original')).join() === 'A1')
    check('tach: khoi tieng goc ao cua clip bien mat khoi A1', (await app.count('.cc-aclip')) === 1)
    check('tach: clip V1 duoc danh dau da tach', await app.eval(`document.querySelectorAll('.cc-clip.detached').length === 1`))
    const left = await app.eval(`parseFloat(document.querySelector('.cc-audio-item-clip.original').style.left)`)
    check('doan tach giu dung vi tri (dau clip = 0px)', left < 4, `(${left}px)`)
    await exportFromUi(app, out)
    check('xuat sau khi tach: van nghe thay tieng clip 1 (qua audio item)', rmsAt(out, 1.0) > 0.01, `(rms=${rmsAt(out, 1.0).toFixed(4)})`)
    check('xuat sau khi tach: clip 2 van co tieng', rmsAt(out, 6.0) > 0.01, `(rms=${rmsAt(out, 6.0).toFixed(4)})`)
    // xoa doan tach: clip 1 phai im lang (tieng goc khong quay lai), clip 2 van co tieng
    await app.key('Delete')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 0`, { label: 'xoa doan tach' })
    await exportFromUi(app, out)
    check('xoa doan tach: phan clip 1 im lang', rmsAt(out, 1.0) < 0.001, `(rms=${rmsAt(out, 1.0).toFixed(4)})`)
    check('xoa doan tach: clip 2 van co tieng', rmsAt(out, 6.0) > 0.01, `(rms=${rmsAt(out, 6.0).toFixed(4)})`)
    // gan lai tieng
    await app.click('.cc-clip', 0)
    await app.clickText('.cc-tlbar button', 'Gắn lại tiếng')
    await app.waitFor(`document.querySelectorAll('.cc-aclip').length === 2 && document.querySelectorAll('.cc-clip.detached').length === 0`, { label: 'gan lai' })
    check('gan lai: khoi tieng goc quay lai A1, clip het danh dau', true)
    await exportFromUi(app, out)
    check('gan lai: ban xuat lai co tieng clip 1', rmsAt(out, 1.0) > 0.01, `(rms=${rmsAt(out, 1.0).toFixed(4)})`)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

const clipTitles = (app) => app.eval(`[...document.querySelectorAll('.cc-clip .strip')].map((el) => el.title)`)
const ctxIds = (app) => app.eval(`[...document.querySelectorAll('.cc-ctxmenu [data-ctx]')].map((b) => b.dataset.ctx)`)
const ctxDisabled = (app, id) => app.eval(`document.querySelector('.cc-ctxmenu [data-ctx="${id}"]')?.disabled === true`)
async function waitForFile(file, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (fs.existsSync(file) && fs.statSync(file).size > 1000) return true; await sleep(200) }
  return false
}

scenario('menu chuot phai: du muc, nhan ban, sao chep + dan, tach Ctrl+B, khoa track, xoa', async () => {
  const app = await launchApp({ project: projectOf(fx) })
  try {
    await app.restoreProject()
    await app.rightClick('.cc-clip', 0)
    await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu' })
    check('menu clip V1 co du 13 muc theo thu tu (12 lenh + xoa dan)', (await ctxIds(app)).join() === 'copy,duplicate,paste,split,freeze,enhance,detach,save-audio,captions,mute,lock,delete,ripple', (await ctxIds(app)).join())
    check('Dan bi khoa khi chua sao chep gi', await ctxDisabled(app, 'paste'))
    check('Tach / Freeze bi khoa khi dau phat o mep clip', (await ctxDisabled(app, 'split')) && (await ctxDisabled(app, 'freeze')))
    await app.click('.cc-ctxmenu [data-ctx="duplicate"]')
    await app.waitFor(`document.querySelectorAll('.cc-clip').length === 3`, { label: 'nhan ban' })
    check('Nhan ban: ban sao nam ngay sau ban goc', (await clipTitles(app)).join() === 'video-a.mp4,video-a.mp4,video-b.mp4', (await clipTitles(app)).join())
    await app.menu('.cc-clip', 2, 'copy')
    await app.rightClick('.cc-clip', 0)
    await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu' })
    check('Dan duoc mo sau khi sao chep', !(await ctxDisabled(app, 'paste')))
    await app.click('.cc-ctxmenu [data-ctx="paste"]')
    await app.waitFor(`document.querySelectorAll('.cc-clip').length === 4`, { label: 'dan' })
    check('Dan: chen tai dau phat (dau timeline)', (await clipTitles(app)).join() === 'video-b.mp4,video-a.mp4,video-a.mp4,video-b.mp4', (await clipTitles(app)).join())
    await app.seekTo(1)
    await app.key('b', 2)
    await app.waitFor(`document.querySelectorAll('.cc-clip').length === 5`, { label: 'tach Ctrl+B' })
    check('Ctrl+B tach clip dang chon tai dau phat', true)
    await app.menu('.cc-clip', 0, 'lock')
    await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V1"]').classList.contains('locked')`, { label: 'khoa V1' })
    await app.rightClick('.cc-clip', 0)
    await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu' })
    check('track khoa: Xoa / Nhan ban bi khoa, muc khoa doi thanh Mo khoa duong', (await ctxDisabled(app, 'delete')) && (await ctxDisabled(app, 'duplicate')) &&
      (await app.text('.cc-ctxmenu [data-ctx="lock"]')).includes('Mở khóa'))
    await app.key('Escape')
    await app.waitFor(`!document.querySelector('.cc-ctxmenu')`, { label: 'Escape dong menu' })
    check('Escape dong menu', true)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('menu: tach / gan lai tieng, luu am thanh, tat tieng, tang cuong, xuat', async () => {
  const outVideo = path.join(fx.dir, 'e2e-menu-export.mp4').replace(/\\/g, '/')
  const outAudio = path.join(fx.dir, 'e2e-saved-audio.wav').replace(/\\/g, '/')
  try { fs.rmSync(outAudio, { force: true }) } catch {}
  const app = await launchApp({ project: projectOf(fx), dialogs: { saveVideo: outVideo, saveAudio: outAudio } })
  try {
    await app.restoreProject()
    await app.menu('.cc-clip', 0, 'save-audio')
    check('Luu am thanh thanh: file WAV duoc tao', await waitForFile(outAudio))
    check('file WAV dai ~5s (bang clip 1)', near(probeDuration(outAudio), 5, 0.2), `(${probeDuration(outAudio).toFixed(2)}s)`)
    await app.menu('.cc-clip', 0, 'detach')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip.original').length === 1`, { label: 'tach am thanh' })
    await app.rightClick('.cc-clip', 0)
    await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu' })
    const ids = await ctxIds(app)
    check('sau khi tach: menu doi Tach am thanh thanh Gan lai tieng', ids.includes('reattach') && !ids.includes('detach'), ids.join())
    await app.click('.cc-ctxmenu [data-ctx="reattach"]')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 0 && document.querySelectorAll('.cc-aclip').length === 2`, { label: 'gan lai' })
    check('Gan lai tieng: khoi tieng goc quay lai A1', true)
    await app.menu('.cc-clip', 0, 'mute')
    await app.waitFor(`document.querySelectorAll('.cc-aclip.muted').length === 1`, { label: 'tat tieng' })
    await app.menu('.cc-clip', 0, 'enhance')
    await app.waitFor(`document.querySelectorAll('.cc-clip.enhanced').length === 1`, { label: 'tang cuong' })
    check('Tat tieng + Tang cuong duoc danh dau tren timeline', true)
    await exportFromUi(app, outVideo)
    check('xuat: clip 1 bi tat tieng thi im lang', rmsAt(outVideo, 1.0) < 0.001, `(rms=${rmsAt(outVideo, 1.0).toFixed(4)})`)
    check('xuat: clip 2 van co tieng', rmsAt(outVideo, 6.0) > 0.01, `(rms=${rmsAt(outVideo, 6.0).toFixed(4)})`)
    check('xuat voi Tang cuong: thoi luong dung ~9s', near(probeDuration(outVideo), 9, 0.4), `(${probeDuration(outVideo).toFixed(2)}s)`)
    await app.rightClick('.cc-clip', 0)
    await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu' })
    check('menu hien Bat tieng va dau tich Tang cuong', (await app.text('.cc-ctxmenu [data-ctx="mute"]')).includes('Bật tiếng') && await app.eval(`!!document.querySelector('.cc-ctxmenu [data-ctx="enhance"] svg:last-of-type') && document.querySelector('.cc-ctxmenu [data-ctx="enhance"]').querySelectorAll('svg').length === 2`))
    await app.key('Escape')
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('menu: Freeze frame chen khung hinh dung 3 giay giua clip', async () => {
  const app = await launchApp({ project: projectOf(fx) })
  try {
    await app.restoreProject()
    await app.seekTo(2)
    await app.menu('.cc-clip', 0, 'freeze')
    await app.waitFor(`document.querySelectorAll('.cc-clip').length === 4`, { label: 'freeze frame', timeout: 20000 })
    const titles = await clipTitles(app)
    check('chen anh dung giua hai nua cua clip', titles[0] === 'video-a.mp4' && titles[1].startsWith('Freeze') && titles[2] === 'video-a.mp4' && titles[3] === 'video-b.mp4', titles.join(' | '))
    check('tong thoi luong tang 3s (9s -> 12s)', (await app.text('.cc-tlbar .cur')).includes('/ 00:12'), await app.text('.cc-tlbar .cur'))
    check('khung dung la clip anh 3s', await app.eval(`parseFloat(document.querySelectorAll('.cc-clip')[1].style.width) > 230 && parseFloat(document.querySelectorAll('.cc-clip')[1].style.width) < 250`))
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('menu va phim tat tren item phu / audio: nhan ban, tat tieng, muc khong ap dung bi khoa', async () => {
  const project = projectOf(fx, {
    videoOverlays: [{ id: 'o1', path: fx.image, name: 'logo.png', kind: 'image', start: 0, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 }],
    audioItems: [{ id: 'm1', path: fx.toneA, name: 'tone.wav', track: 'music', start: 0, in: 0, out: 3, gain: 0.4 }]
  })
  const app = await launchApp({ project })
  try {
    await app.restoreProject()
    await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1 && document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'item' })
    await app.rightClick('.cc-v2-clip', 0)
    await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu' })
    const blocked = []
    for (const id of ['freeze', 'enhance', 'detach', 'save-audio', 'captions', 'mute']) if (await ctxDisabled(app, id)) blocked.push(id)
    check('anh phu: Freeze / Tang cuong / Tach tieng / Luu am thanh / Phu de / Tat tieng bi khoa', blocked.join() === 'freeze,enhance,detach,save-audio,captions,mute', blocked.join())
    await app.click('.cc-ctxmenu [data-ctx="duplicate"]')
    await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2`, { label: 'nhan ban item phu' })
    const lefts = await app.eval(`[...document.querySelectorAll('.cc-v2-clip')].map((el) => Math.round(parseFloat(el.style.left))).sort((a, b) => a - b)`)
    check('Nhan ban item phu: ban sao noi tiep sau ban goc (0s va 3s)', lefts.join() === '0,240', lefts.join())
    await app.menu('.cc-audio-item-clip', 0, 'mute')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip.muted').length === 1`, { label: 'tat tieng item' })
    check('Tat tieng audio item', true)
    await app.key('m')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip.muted').length === 0`, { label: 'phim M bat tieng lai' })
    check('phim M bat / tat tieng muc dang chon', true)
    await app.rightClick('.cc-audio-item-clip', 0)
    await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu' })
    check('audio item: Luu am thanh mo, Freeze / Tang cuong khoa', !(await ctxDisabled(app, 'save-audio')) && (await ctxDisabled(app, 'freeze')) && (await ctxDisabled(app, 'enhance')))
    await app.click('.cc-ctxmenu [data-ctx="delete"]')
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 0`, { label: 'xoa audio item' })
    check('Xoa audio item qua menu', true)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

scenario('tha file tu he dieu hanh vao cua so them clip', async () => {
  const app = await launchApp()
  try {
    await app.waitFor(`!!document.querySelector('.cc-top')`)
    await app.dropFiles([fx.videoA.replace(/\//g, '\\')], 640, 300)
    await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'clip sau khi tha file', timeout: 20000 })
    check('tha 1 video -> 1 clip tren V1', true)
    check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
  } finally { app.close() }
})

require('./scenarios-timelines.cjs')({ scenario, check, near, fx, launchApp, projectOf, probeDuration, rmsAt, channelRmsAt, probeStreams, sleep })

;(async () => {
  for (const { name, fn } of scenarios) {
    if (filter && !name.includes(filter)) continue
    console.log('\n' + name)
    try { await fn() } catch (error) { fail++; console.log('  \x1b[31mFAIL\x1b[0m ngoai le: ' + (error.stack || error.message).split('\n').slice(0, 3).join(' | ')) }
  }
  console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
  process.exit(fail ? 1 : 0)
})()
