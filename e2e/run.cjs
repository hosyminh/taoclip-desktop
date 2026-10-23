// ============================================================
//  Kiem thu e2e tren Electron that:  npm run test:e2e   (them --skip-build neu dist/ moi build)
//  Moi kich ban mo mot ban app moi voi userData rieng, dung chuot/tha file that qua CDP.
//  Loc kich ban:  node e2e/run.cjs <tu-khoa>
// ============================================================
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { repo, sleep, probeDuration, makeFixtures, launchApp, projectOf } = require('./lib.cjs')

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
    await app.waitFor(`document.querySelectorAll('.cc-audio-item-track').length === 2`, { label: '2 audio item' })
    check('nhac nen + long tieng cu thanh 2 audio item', true)
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

;(async () => {
  for (const { name, fn } of scenarios) {
    if (filter && !name.includes(filter)) continue
    console.log('\n' + name)
    try { await fn() } catch (error) { fail++; console.log('  \x1b[31mFAIL\x1b[0m ngoai le: ' + (error.stack || error.message).split('\n').slice(0, 3).join(' | ')) }
  }
  console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
  process.exit(fail ? 1 : 0)
})()
