// Kich ban e2e cho nhieu timeline (tab) trong mot du an. Duoc nap tu e2e/run.cjs.
const fs = require('fs')
const path = require('path')

module.exports = function register({ scenario, check, near, fx, launchApp, projectOf, probeDuration, sleep }) {
  const winPath = (p) => p.replace(/\//g, '\\')
  const tabs = (app) => app.eval(`[...document.querySelectorAll('.cc-tltab')].map((el) => ({ id: el.dataset.tl, name: (el.querySelector('.nm') || el.querySelector('.nm-edit'))?.textContent || el.querySelector('.nm-edit')?.value, on: el.getAttribute('aria-selected') === 'true', closable: !!el.querySelector('.x') }))`)
  const names = async (app) => (await tabs(app)).map((tab) => tab.name)
  const activeName = async (app) => (await tabs(app)).find((tab) => tab.on)?.name
  const clipCount = (app) => app.count('.cc-clip')
  const dirty = (app) => app.eval(`document.querySelector('.cc-proj').textContent.includes('•')`)
  const undoDisabled = (app) => app.eval(`[...document.querySelectorAll('.cc-tlbar button')].find((b) => b.title.startsWith('Hoàn tác')).disabled`)
  const selectTab = async (app, name) => {
    const index = (await names(app)).indexOf(name)
    if (index < 0) throw new Error('Khong co tab ' + name)
    await app.click('.cc-tltab .nm', index)
    await app.waitFor(`(() => { const on = document.querySelector('.cc-tltab[aria-selected="true"] .nm'); return !!on && on.textContent === ${JSON.stringify(name)} })()`, { label: 'tab ' + name + ' dang mo' })
  }

  scenario('nhieu timeline: them tab, noi dung va lich su undo doc lap, doi tab khong lam du an "thay doi"', async () => {
    const file = path.join(fx.dir, 'multi-1.taoclip')
    const app = await launchApp({ project: projectOf(fx, { ratio: '16:9' }), dialogs: { saveProject: file } })
    try {
      await app.restoreProject()
      check('mot timeline mac dinh "Timeline 1", dang mo, khong co nut dong', JSON.stringify(await tabs(app)).includes('"name":"Timeline 1","on":true,"closable":false'))
      await app.key('s', 2)
      await app.waitFor(`!document.querySelector('.cc-proj').textContent.includes('•') && document.querySelector('.cc-proj').title.endsWith('multi-1.taoclip')`, { label: 'da luu sach' })
      check('luu du an -> khong con dau thay doi', !(await dirty(app)))

      // them tab moi
      await app.click('.cc-tltab-add')
      await app.waitFor(`document.querySelectorAll('.cc-tltab').length === 2`, { label: '2 tab' })
      await app.waitFor(`document.querySelector('.cc-tltab[aria-selected="true"] .nm')?.textContent === 'Timeline 2'`, { label: 'tab 2 dang mo' })
      check('them tab: "Timeline 2" tu mo, timeline rong', (await clipCount(app)) === 0, `(${await clipCount(app)} clip)`)
      check('them tab: tab 1 con nguyen, co nut dong tren moi tab', (await tabs(app)).every((tab) => tab.closable))
      check('them tab -> du an duoc danh dau thay doi', await dirty(app))

      // tha 1 video vao tab 2
      await app.dropFiles([winPath(fx.videoSilent)], 640, 300)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'clip trong tab 2', timeout: 20000 })
      check('tab 2 co 1 clip', true)
      check('tab 2 co lich su (nhap media) -> Hoan tac bat', !(await undoDisabled(app)))

      // tab 1 khong bi anh huong va co lich su rieng (trong)
      await selectTab(app, 'Timeline 1')
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 2`, { label: 'tab 1 co 2 clip' })
      check('tab 1: van 2 clip cua no', (await clipCount(app)) === 2)
      check('tab 1: lich su rieng, chua sua gi -> Hoan tac tat', await undoDisabled(app))

      // undo o tab 2 chi anh huong tab 2
      await selectTab(app, 'Timeline 2')
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'tab 2 nap lai' })
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 0`, { label: 'undo tab 2' })
      check('Ctrl+Z trong tab 2 go clip cua tab 2', true)
      await selectTab(app, 'Timeline 1')
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 2`, { label: 'tab 1' })
      check('...va khong dung toi tab 1', (await clipCount(app)) === 2)
      await selectTab(app, 'Timeline 2')
      await app.key('y', 2)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'redo tab 2' })
      check('Ctrl+Y trong tab 2 lam lai (lich su tab 2 con nguyen sau khi doi tab)', true)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('nhieu timeline: doi ten, nhan ban, doi cho, dong tab, luu va mo lai du an', async () => {
    const file = path.join(fx.dir, 'multi-2.taoclip')
    try { fs.rmSync(file, { force: true }) } catch {}
    const app = await launchApp({ project: projectOf(fx, { ratio: '16:9' }), dialogs: { saveProject: file } })
    try {
      await app.restoreProject()
      await app.eval(`window.confirm = () => true`)
      await app.click('.cc-tltab-add')
      await app.waitFor(`document.querySelector('.cc-tltab[aria-selected="true"] .nm')?.textContent === 'Timeline 2'`, { label: 'tab 2' })
      await app.dropFiles([winPath(fx.videoSilent)], 640, 300)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'clip tab 2', timeout: 20000 })

      // doi ten: nhap doi + go + Enter
      await app.eval(`document.querySelector('.cc-tltab.on .nm').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
      await app.waitFor(`!!document.querySelector('.cc-tltab .nm-edit')`, { label: 'o doi ten' })
      await app.send('Input.insertText', { text: 'Tap 2' })
      await app.key('Enter')
      await app.waitFor(`document.querySelector('.cc-tltab.on .nm')?.textContent === 'Tap 2'`, { label: 'ten moi' })
      check('doi ten tab bang nhap doi + Enter', (await names(app)).join() === 'Timeline 1,Tap 2')
      // Escape huy
      await app.eval(`document.querySelector('.cc-tltab.on .nm').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
      await app.waitFor(`!!document.querySelector('.cc-tltab .nm-edit')`, { label: 'o doi ten 2' })
      await app.send('Input.insertText', { text: 'Se bi huy' })
      await app.key('Escape')
      await app.waitFor(`!document.querySelector('.cc-tltab .nm-edit')`, { label: 'thoat o doi ten' })
      check('Escape huy doi ten', (await activeName(app)) === 'Tap 2')

      // nhan ban qua menu chuot phai
      await app.menu('.cc-tltab', 1, 'tab-duplicate')
      await app.waitFor(`document.querySelectorAll('.cc-tltab').length === 3`, { label: 'tab nhan ban' })
      await app.waitFor(`document.querySelector('.cc-tltab[aria-selected="true"] .nm')?.textContent === 'Tap 2 (2)'`, { label: 'ban sao dang mo' })
      check('nhan ban: "Tap 2 (2)" tu mo, giu noi dung (1 clip)', (await clipCount(app)) === 1)
      // doi cho: dua ban sao len dau
      await app.menu('.cc-tltab', 2, 'tab-left')
      await app.menu('.cc-tltab', 1, 'tab-left')
      await app.waitFor(`document.querySelector('.cc-tltab .nm')?.textContent === 'Tap 2 (2)'`, { label: 'doi cho' })
      check('doi cho tab bang menu: thu tu moi', (await names(app)).join() === 'Tap 2 (2),Timeline 1,Tap 2', (await names(app)).join())
      check('doi cho khong doi tab dang mo', (await activeName(app)) === 'Tap 2 (2)')

      // luu -> kiem tra file
      await app.key('s', 2)
      await app.waitFor(`document.querySelector('.cc-proj').title.endsWith('multi-2.taoclip') && !document.querySelector('.cc-proj').textContent.includes('•')`, { label: 'luu xong' })
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
      check('file luu la schema v6 voi 3 timeline dung thu tu', onDisk.version === 6 && onDisk.timelines.map((tl) => tl.name).join() === 'Tap 2 (2),Timeline 1,Tap 2')
      check('tab dang mo duoc luu', onDisk.activeTimelineId === onDisk.timelines[0].id)
      check('noi dung moi timeline rieng (1, 2, 1 clip)', onDisk.timelines.map((tl) => tl.clips.length).join() === '1,2,1')
      check('timeline moi ke thua ti le 16:9', onDisk.timelines[2].ratio === '16:9' && onDisk.timelines[0].ratio === '16:9')
      check('duong dan media trong moi timeline la tuong doi', onDisk.timelines.every((tl) => tl.clips.every((clip) => !path.isAbsolute(clip.path))))
      check('thu vien dung chung: moi file media chi mot muc', onDisk.assets.length === 3, `(${onDisk.assets.length})`)

      // dong tab dang mo (co noi dung -> hoi xac nhan, da tra loi co) -> sang tab ke ben
      await app.click('.cc-tltab.on .x')
      await app.waitFor(`document.querySelectorAll('.cc-tltab').length === 2`, { label: 'dong tab' })
      check('dong tab dang mo -> con 2 tab, tab ke ben duoc mo', (await names(app)).join() === 'Timeline 1,Tap 2' && (await activeName(app)) === 'Timeline 1', (await names(app)).join() + ' / ' + await activeName(app))
      check('...va noi dung tab ke ben hien ra (2 clip)', (await clipCount(app)) === 2)
      check('dong tab -> du an thay doi', await dirty(app))
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }

    // mo lai file o mot phien moi
    const reopened = await launchApp({ dialogs: { openProject: file, saveVideo: path.join(fx.dir, 'e2e-tab-export.mp4').replace(/\\/g, '/') } })
    try {
      await reopened.waitFor(`!!document.querySelector('.cc-top')`)
      await reopened.clickText('.cc-import.alt', 'Mở dự án')
      await reopened.waitFor(`document.querySelectorAll('.cc-tltab').length === 3 && document.querySelectorAll('.cc-clip').length > 0`, { label: 'mo lai du an', timeout: 30000 })
      check('mo lai: du 3 tab dung ten, thu tu', (await names(reopened)).join() === 'Tap 2 (2),Timeline 1,Tap 2', (await names(reopened)).join())
      check('mo lai: tab dang mo la tab da luu', (await activeName(reopened)) === 'Tap 2 (2)' && (await clipCount(reopened)) === 1)
      check('mo lai: du an sach (khong bi coi la da sua)', !(await dirty(reopened)))
      await selectTab(reopened, 'Timeline 1')
      await reopened.waitFor(`document.querySelectorAll('.cc-clip').length === 2`, { label: 'tab 1 sau khi mo lai' })
      check('mo lai: tab khac co du 2 clip (nap san, khong probe lai)', true)
      check('mo lai: chuyen tab khong lam du an thay doi', !(await dirty(reopened)))
      check('mo lai: thu vien co du 3 media', (await reopened.count('.cc-card')) >= 3, `(${await reopened.count('.cc-card')})`)

      // xuat: chi xuat timeline dang mo
      await selectTab(reopened, 'Tap 2')
      const out = path.join(fx.dir, 'e2e-tab-export.mp4')
      try { fs.rmSync(out, { force: true }) } catch {}
      await reopened.click('.cc-top .cc-export')
      await reopened.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
      await reopened.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === '720p').click()`)
      await reopened.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === 'Nhỏ gọn').click()`)
      await reopened.click('.cc-modal-box .exp-start')
      await reopened.waitFor(`!document.querySelector('.cc-modal-box')`, { timeout: 120000, label: 'xuat xong', interval: 500 })
      const duration = probeDuration(out)
      check('xuat tab "Tap 2": chi video cua tab do (~3s, khong phai 9s cua tab 1)', near(duration, 3, 0.4), `(${duration.toFixed(2)}s)`)
      check('khong co loi runtime', reopened.errors.length === 0, reopened.errors.slice(0, 2).join(' | '))
    } finally { reopened.close() }
  })

  scenario('nhieu timeline: du an cu (v4) mo thanh 1 tab; toi da 12 tab, nut them bi khoa', async () => {
    const app = await launchApp({ project: projectOf(fx) })
    try {
      await app.restoreProject()
      check('du an v4 -> dung 1 tab "Timeline 1"', (await names(app)).join() === 'Timeline 1')
      for (let i = 0; i < 11; i++) await app.click('.cc-tltab-add')
      await app.waitFor(`document.querySelectorAll('.cc-tltab').length === 12`, { label: '12 tab', timeout: 30000 })
      check('toi da 12 tab: nut them bi khoa', await app.eval(`document.querySelector('.cc-tltab-add').disabled`))
      check('...va tab moi dat ten khong trung (Timeline 12 co mat)', (await names(app)).includes('Timeline 12'))
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  // Sticker Twemoji (anh trong app, khong co path) phai song cung he track va nhieu timeline
  scenario('sticker V2: vao track dung, va cham sang track moi, giu khi doi tab, luu khong ghi path, xuat duoc', async () => {
    const file = path.join(fx.dir, 'multi-sticker.taoclip')
    try { fs.rmSync(file, { force: true }) } catch {}
    const out = path.join(fx.dir, 'e2e-sticker-export.mp4')
    try { fs.rmSync(out, { force: true }) } catch {}
    const app = await launchApp({ project: projectOf(fx), dialogs: { saveProject: file, saveVideo: out.replace(/\\/g, '/') } })
    try {
      await app.restoreProject()
      await app.eval(`[...document.querySelectorAll('button')].find((b) => b.querySelector('.lb')?.textContent === 'Sticker').click()`)
      await app.waitFor(`document.querySelectorAll('.sticker-btn').length > 20`, { label: 'luoi sticker' })
      await app.click('.sticker-btn', 0)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1`, { label: 'sticker tren V2' })
      check('them sticker -> nam tren track V2', await app.eval(`document.querySelector('.cc-v2-clip').closest('.cc-trow').dataset.trackId === 'V2'`))
      check('preview hien sticker (anh) tai playhead', await app.eval(`document.querySelectorAll('.cc-frame img.cc-v2-preview').length === 1`))
      await app.click('.sticker-btn', 5)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2`, { label: 'sticker thu hai' })
      check('sticker thu hai cung thoi diem: va cham -> sang track V3', (await app.eval(`[...document.querySelectorAll('.cc-v2-clip')].map((el) => el.closest('.cc-trow').dataset.trackId).sort().join()`)) === 'V2,V3')

      // giu khi doi tab
      await app.click('.cc-tltab-add')
      await app.waitFor(`document.querySelectorAll('.cc-tltab').length === 2 && document.querySelectorAll('.cc-v2-clip').length === 0`, { label: 'tab 2 rong' })
      await selectTab(app, 'Timeline 1')
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2`, { label: 'sticker con nguyen' })
      check('doi tab roi quay lai: 2 sticker van o dung track', (await app.eval(`[...document.querySelectorAll('.cc-v2-clip')].map((el) => el.closest('.cc-trow').dataset.trackId).sort().join()`)) === 'V2,V3')

      // luu: sticker khong co path media, khong vao thu vien
      await app.key('s', 2)
      await app.waitFor(`document.querySelector('.cc-proj').title.endsWith('multi-sticker.taoclip')`, { label: 'luu xong' })
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
      const stickers = onDisk.timelines[0].videoOverlays
      check('file luu: 2 sticker co id twemoji, khong co duong dan', stickers.length === 2 && stickers.every((item) => /^twemoji\//.test(item.sticker) && !item.path))
      check('file luu: sticker khong chen vao thu vien media', onDisk.assets.every((asset) => asset.path))

      // xuat that voi sticker (chi can thanh cong: dung thoi luong)
      await app.click('.cc-top .cc-export')
      await app.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
      await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === '720p').click()`)
      await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === 'Nhỏ gọn').click()`)
      await app.click('.cc-modal-box .exp-start')
      await app.waitFor(`!document.querySelector('.cc-modal-box')`, { timeout: 120000, label: 'xuat xong', interval: 500 })
      const duration = probeDuration(out)
      check('xuat voi sticker: thoi luong ~9s', near(duration, 9, 0.4), `(${duration.toFixed(2)}s)`)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('duong keo day het chieu ngang: o ke khong dut o cuoi video, tha duoc qua diem ket thuc', async () => {
    const app = await launchApp({ project: projectOf(fx) })
    try {
      await app.restoreProject()
      const m = await app.eval(`(() => { const s = document.querySelector('.cc-tlscroll'); const lanes = [...document.querySelectorAll('.cc-tlane')].map((l) => l.getBoundingClientRect().right); return { view: s.getBoundingClientRect().right, min: Math.min(...lanes), scrollW: s.scrollWidth, clientW: s.clientWidth } })()`)
      check('moi duong keo toi mep phai khung nhin (video 9s chi dai ~720px)', m.min >= m.view - 20, JSON.stringify(m))
      check('khong sinh thanh cuon ngang thua', m.scrollW <= m.clientW + 2, JSON.stringify(m))
      // tha anh o giay 12 (video chi 9s)
      await app.dropOnLane({ files: [winPath(fx.image)], row: '.cc-trow[data-track-id="V3"]', time: 12 })
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1`, { label: 'anh tha sau diem ket thuc' })
      const left = await app.eval(`parseFloat(document.querySelector('.cc-v2-clip').style.left)`)
      check('tha duoc vao vung sau diem ket thuc (~12s = 960px)', Math.abs(left - 960) < 14, `(${left}px)`)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('item V2+ co hinh thu nho: video vai khung theo doan dung, anh / sticker la chinh anh', async () => {
    const overlay = (id, extra) => ({ id, name: id, start: 0, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1, ...extra })
    const project = projectOf(fx, { videoOverlays: [
      overlay('vid', { path: fx.videoA, name: 'video-a.mp4', kind: 'video', start: 0, out: 5, sourceDuration: 5 }),
      overlay('img', { path: fx.image, name: 'image.png', kind: 'image', start: 6 }),
      overlay('stk', { sticker: 'twemoji/1f600', path: '', name: 'x', kind: 'image', start: 10 })] })
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 3`, { label: '3 item phu' })
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip[data-item-id="vid"] .cc-v2-thumbs img').length > 0`, { label: 'khung hinh video', timeout: 20000 })
      const frames = await app.eval(`[...document.querySelectorAll('.cc-v2-clip[data-item-id="vid"] .cc-v2-thumbs img')].map((img) => img.getAttribute('src'))`)
      check('video tren V2+: co hinh thu nho, nhieu khung (item dai ~400px)', frames.length >= 5, `(${frames.length} khung)`)
      check('cac khung la anh khac nhau (khong lap mot khung)', new Set(frames).size >= 3, `(${new Set(frames).size} khac nhau)`)
      check('hinh thu nho tai duoc that (anh co kich thuoc)', await app.eval(`new Promise((resolve) => { const img = document.querySelector('.cc-v2-clip[data-item-id="vid"] .cc-v2-thumbs img'); if (img.complete) resolve(img.naturalWidth > 0); else img.onload = () => resolve(img.naturalWidth > 0), img.onerror = () => resolve(false) })`))
      check('anh phu: lay chinh anh lam hinh nen', await app.eval(`getComputedStyle(document.querySelector('.cc-v2-clip[data-item-id="img"] .cc-v2-thumbs.flat')).backgroundImage.includes('image.png')`))
      check('sticker: lay chinh sticker lam hinh nen', await app.eval(`getComputedStyle(document.querySelector('.cc-v2-clip[data-item-id="stk"] .cc-v2-thumbs.flat')).backgroundImage.includes('1f600')`))
      check('ten item van doc duoc tren hinh (nam tren hinh nen)', await app.eval(`getComputedStyle(document.querySelector('.cc-v2-clip[data-item-id="vid"] > span')).zIndex === '1'`))
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('keo doi cho clip tren V1 (ngang): clip cuoi keo len dau', async () => {
    const app = await launchApp({ project: projectOf(fx) })
    try {
      await app.restoreProject()
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const titles = () => app.eval(`[...document.querySelectorAll('.cc-clip .strip')].map((el) => el.title).join()`)
      check('truoc khi keo: video-a, video-b', (await titles()) === 'video-a.mp4,video-b.mp4')
      const second = await app.center('.cc-clip .strip', 1)
      const first = await app.center('.cc-clip .strip', 0)
      await app.dragBy(second, { x: first.x - 100, y: first.y })
      await app.waitFor(`document.querySelector('.cc-clip .strip').title === 'video-b.mp4'`, { label: 'doi cho' })
      check('keo clip 2 len truoc clip 1: thu tu doi thanh video-b, video-a', (await titles()) === 'video-b.mp4,video-a.mp4')
      await app.key('z', 2)
      await app.waitFor(`document.querySelector('.cc-clip .strip').title === 'video-a.mp4'`, { label: 'hoan tac doi cho' })
      check('Ctrl+Z tra lai thu tu cu', true)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  // Keo giua V1 va cac duong phu, va khoi tieng goc A1 sang duong tieng khac
  scenario('keo clip V1 len V3 thanh lop phu (don V1, mang theo tieng), keo lai xuong V1, hoan tac', async () => {
    const app = await launchApp({ project: projectOf(fx) })
    try {
      await app.restoreProject()
      const trackOf = (selector) => app.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => el.closest('.cc-trow').dataset.trackId).join()`)
      const total = () => app.text('.cc-tlbar .cur')
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      // keo clip dau (video-a, 5s) len V3 va tha o giay 2
      const strip = await app.center('.cc-clip .strip', 0)
      const v3 = await app.center('.cc-trow[data-track-id="V3"] .cc-tlane')
      await app.dragBy(strip, { x: strip.x + 160, y: v3.y })
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1`, { label: 'clip thanh lop phu' })
      check('clip V1 keo len V3 -> thanh lop phu tren V3', (await trackOf('.cc-v2-clip')) === 'V3')
      check('V1 con 1 clip (video-b) va don lai: tong 4s', (await app.count('.cc-clip')) === 1 && /\/ 00:04/.test(await total()), await total())
      const left = await app.eval(`parseFloat(document.querySelector('.cc-v2-clip').style.left)`)
      check('lop phu dat dung thoi diem tha (~2s = 160px)', Math.abs(left - 160) < 14, `(${left}px)`)
      check('tieng cua clip duoc mang theo thanh doan tieng (1 audio item)', (await app.count('.cc-audio-item-clip')) === 1)
      const props = await app.eval(`(() => { const el = document.querySelector('.cc-v2-clip'); return el.title })()`)
      check('lop phu giu ten clip', /video-a/.test(props), props)
      // hoan tac mot buoc: ve nhu cu
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 2 && document.querySelectorAll('.cc-v2-clip').length === 0`, { label: 'hoan tac' })
      check('Ctrl+Z hoan tac tron mot buoc: 2 clip V1, het lop phu, het tieng roi', (await app.count('.cc-audio-item-clip')) === 0 && /\/ 00:09/.test(await total()))
      await app.key('y', 2)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1`, { label: 'lam lai' })
      // keo lop phu xuong V1, tha o giay 0 (truoc video-b)
      const item = await app.center('.cc-v2-clip')
      const v1 = await app.center('.cc-trow[data-track-id="V1"] .cc-tlane')
      await app.dragBy(item, { x: v1.x - 400, y: v1.y })
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 2 && document.querySelectorAll('.cc-v2-clip').length === 0`, { label: 've V1' })
      const order = await app.eval(`[...document.querySelectorAll('.cc-clip .strip')].map((el) => el.title)`)
      check('keo lop phu xuong V1: thanh clip V1 chen dung cho (dau tien)', order.join() === 'video-a.mp4,video-b.mp4', order.join())
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('khong cho keo clip V1 duy nhat len lop phu; khoi tieng A1 keo sang A3 thanh tieng rieng', async () => {
    const single = { version: 4, projectId: 'e2e-single-' + Math.random().toString(36).slice(2), clips: [{ id: 'c1', path: fx.videoA, name: 'video-a.mp4', kind: 'video', in: 0, out: 5, speed: 1 }] }
    const app = await launchApp({ project: single })
    try {
      await app.restoreProject()
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const strip = await app.center('.cc-clip .strip', 0)
      const v2 = await app.center('.cc-trow[data-track-id="V2"] .cc-tlane')
      await app.dragBy(strip, { x: strip.x, y: v2.y })
      await sleep(600)
      check('clip V1 duy nhat khong len lop phu duoc (V1 giu clip, khong co lop phu)', (await app.count('.cc-clip')) === 1 && (await app.count('.cc-v2-clip')) === 0)
      // khoi tieng goc A1 -> A3, doi sang giay 1
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 99999`)
      const block = await app.center('.cc-aclip')
      const a3 = await app.center('.cc-trow[data-track-id="A3"] .cc-tlane')
      await app.dragBy(block, { x: block.x + 80, y: a3.y })
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'tieng tach ra' })
      check('keo khoi tieng A1 sang A3 -> thanh doan tieng rieng tren A3', (await app.eval(`document.querySelector('.cc-audio-item-clip').closest('.cc-trow').dataset.trackId`)) === 'A3')
      check('clip V1 duoc danh dau da tach tieng (khong con khoi tieng A1)', (await app.count('.cc-clip.detached')) === 1 && (await app.count('.cc-aclip')) === 0)
      const left = await app.eval(`parseFloat(document.querySelector('.cc-audio-item-clip').style.left)`)
      check('tieng dat lech 1s theo cho tha (~80px)', Math.abs(left - 80) < 14, `(${left}px)`)
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 0 && document.querySelectorAll('.cc-aclip').length === 1`, { label: 'hoan tac tach' })
      check('Ctrl+Z tra tieng ve clip', true)
      // nhap vao khoi tieng khong keo: van chi tua (khong tach)
      await app.click('.cc-aclip')
      await sleep(300)
      check('chi bam vao khoi tieng: khong tach', (await app.count('.cc-aclip')) === 1 && (await app.count('.cc-audio-item-clip')) === 0)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  // Phan hoi khi keo: o dich sang len, vach thoi diem, khong xe dich duong luc bat dau keo, tu cuon khi keo sat mep
  scenario('keo tha vao duong: o dich to sang, vach vi tri, khong xe dich, tu cuon sat mep', async () => {
    const app = await launchApp({ project: projectOf(fx) })
    try {
      await app.restoreProject()
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const tops = () => app.eval(`JSON.stringify(['V4', 'V3', 'V1', 'A1', 'A4'].map((id) => Math.round(document.querySelector('.cc-trow[data-track-id="' + id + '"]').getBoundingClientRect().top)))`)
      const before = await tops()
      const data = { items: [], files: [winPath(fx.image)], dragOperationsMask: 1 }
      const drag = (type, x, y) => app.send('Input.dispatchDragEvent', { type, x, y, data })
      await drag('dragEnter', 640, 300); await drag('dragOver', 640, 300)
      await app.waitFor(`!!document.querySelector('.cc-tl.dragging')`, { label: 'trang thai keo' })
      await sleep(200)
      check('bat dau keo: cac duong KHONG bi xe dich (o tao track moi da chiem san cho)', (await tops()) === before, `${before} -> ${await tops()}`)
      check('bat dau keo: hai o "tao track moi" hien ra', (await app.count('.cc-newtrack.on')) === 2)
      check('bat dau keo: moi duong co vien o dich', await app.eval(`getComputedStyle(document.querySelector('.cc-trow[data-track-id="V2"] .cc-tlane')).outlineStyle === 'dashed'`))
      const v3 = await app.rect('.cc-trow[data-track-id="V3"] .cc-tlane')
      await drag('dragOver', Math.round(v3.x + 240), Math.round(v3.y + v3.height / 2))
      await drag('dragOver', Math.round(v3.x + 240), Math.round(v3.y + v3.height / 2))
      await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V3"]').classList.contains('drop-hover') && !!document.querySelector('.cc-trow[data-track-id="V3"] .cc-lane-ind')`, { label: 'V3 to sang + vach' })
      check('ruoc toi V3: duong V3 to sang va co vach thoi diem tha', true)
      const x = await app.eval(`parseFloat(document.querySelector('.cc-trow[data-track-id="V3"] .cc-lane-ind').style.left)`)
      check('vach nam dung thoi diem con tro (~3s = 240px)', Math.abs(x - 240) < 14, `(${x}px)`)
      check('chi mot duong sang tai mot thoi diem', (await app.count('.cc-trow.drop-hover')) === 1)
      // keo sat mep duoi khung cuon -> tu cuon xuong
      const box = await app.eval(`(() => { const r = document.querySelector('.cc-tlscroll').getBoundingClientRect(); return { x: r.left + 400, y: r.bottom - 8 } })()`)
      for (let i = 0; i < 12; i++) { await drag('dragOver', Math.round(box.x), Math.round(box.y)); await sleep(80) }
      const scrolled = await app.eval(`document.querySelector('.cc-tlscroll').scrollTop`)
      check('keo sat mep duoi: timeline tu cuon xuong de toi cac duong A', scrolled > 20, `(scrollTop ${scrolled})`)
      await drag('dragOver', Math.round(box.x), 300) // roi khoi mep -> dung cuon
      await sleep(200)
      const rest = await app.eval(`document.querySelector('.cc-tlscroll').scrollTop`)
      await sleep(300)
      check('roi khoi mep thi dung cuon', (await app.eval(`document.querySelector('.cc-tlscroll').scrollTop`)) === rest)
      await app.send('Input.dispatchDragEvent', { type: 'dragCancel', x: 640, y: 300, data })
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  // 3 duong hinh + 3 duong tieng co san de tha long nhau
  scenario('duong san co V1..V4 / A1..A4: tha long nhau ngay khong can them track', async () => {
    const app = await launchApp({ project: projectOf(fx) })
    try {
      await app.restoreProject()
      const rowIds = () => app.eval(`[...document.querySelectorAll('.cc-trow')].map((r) => r.dataset.trackId).join()`)
      const trackOf = (selector) => app.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => el.closest('.cc-trow').dataset.trackId).sort().join()`)
      check('moi du an mo ra co san 4 duong hinh va 4 duong tieng', (await rowIds()) === 'V4,V3,V2,V1,A1,A2,A3,A4', await rowIds())
      // 3 anh cung thoi diem, moi anh tha thang vao mot duong: long nhau tren V2, V3, V4
      for (const id of ['V2', 'V3', 'V4']) await app.dropOnLane({ files: [winPath(fx.image)], row: `.cc-trow[data-track-id="${id}"]`, time: 1 })
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 3`, { label: '3 anh long nhau' })
      check('3 anh cung thoi diem nam dung V2, V3, V4 (long nhau, khong sinh track moi)', (await trackOf('.cc-v2-clip')) === 'V2,V3,V4' && (await app.count('.cc-trow')) === 8)
      // 3 audio cung thoi diem tren A2, A3, A4
      for (const [id, file] of [['A2', fx.toneA], ['A3', fx.toneB], ['A4', fx.toneA]]) await app.dropOnLane({ files: [winPath(file)], row: `.cc-trow[data-track-id="${id}"]`, time: 1 })
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 3`, { label: '3 audio long nhau' })
      check('3 audio cung thoi diem nam dung A2, A3, A4', (await trackOf('.cc-audio-item-clip')) === 'A2,A3,A4' && (await app.count('.cc-trow')) === 8)
      // tha them anh vao V4 dang kin -> tu sang track moi V5
      await app.dropOnLane({ files: [winPath(fx.image)], row: '.cc-trow[data-track-id="V4"]', time: 1.5 })
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 4`, { label: 'anh thu 4' })
      check('V4 dang kin -> anh tiep theo len V5 (them track khi het duong)', (await trackOf('.cc-v2-clip')) === 'V2,V3,V4,V5')
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  // Video dai: dung mot anh keo dai 1 gio de co timeline 60 phut
  scenario('thu phong timeline 1 gio: Vua khung nam gon, moc theo phut, giu diem nhin, nut - khong xuong qua day', async () => {
    const project = { version: 4, projectId: 'e2e-hour-' + Math.random().toString(36).slice(2), clips: [{ id: 'h1', path: fx.image, name: 'image.png', kind: 'image', in: 0, out: 3600, speed: 1 }] }
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      const zoom = (index) => app.click('.cc-tlbar .zoom button', index) // 0: -, 1: Vua khung, 2: +
      const ppsNow = () => app.eval(`document.querySelector('.cc-clip').getBoundingClientRect().width / 3600`)
      const centerTime = () => app.eval(`(() => { const s = document.querySelector('.cc-tlscroll'); const pps = document.querySelector('.cc-clip').getBoundingClientRect().width / 3600; return (s.scrollLeft + (s.clientWidth - 96) / 2) / pps })()`)
      const ticks = () => app.eval(`[...document.querySelectorAll('.cc-ruler .tick')].map((el) => el.textContent)`)

      await zoom(1)
      await app.waitFor(`(() => { const s = document.querySelector('.cc-tlscroll'); return s.scrollWidth <= s.clientWidth + 2 })()`, { label: 'timeline 1 gio vua man hinh' })
      check('Vua khung: video 1 gio nam gon trong man hinh, khong can cuon ngang', true)
      check('Vua khung: khong con bi chan o 20 px/giay (cu) ma xuong ~0.3 px/giay', (await ppsNow()) < 0.5, `(${(await ppsNow()).toFixed(3)} px/s)`)
      const fitTicks = await ticks()
      check('moc thoi gian theo phut, khong lap lai "00s": 0s, 10:00, 20:00 ... 1:00:00', fitTicks[0] === '0s' && fitTicks.includes('10:00') && fitTicks.includes('1:00:00'), fitTicks.join(' '))
      check('so moc vua phai (4..40)', fitTicks.length >= 4 && fitTicks.length <= 40, `(${fitTicks.length})`)

      // phong to 3 nac: diem giua khung nhin giu nguyen
      const before = await centerTime()
      for (let i = 0; i < 3; i++) await zoom(2)
      await app.waitFor(`document.querySelector('.cc-tlscroll').scrollWidth > document.querySelector('.cc-tlscroll').clientWidth + 100`, { label: 'phong to' })
      const after = await centerTime()
      check('phong to 3 nac giu nguyen diem giua khung nhin (khong nhay ve dau)', Math.abs(after - before) < 15, `(${before.toFixed(0)}s -> ${after.toFixed(0)}s)`)
      check('phong to doi buoc moc (min hon 10 phut)', (await ticks()).length > fitTicks.length)

      // thu nho het co: phim '-' nhieu lan khong qua muc toi thieu
      await zoom(1)
      for (let i = 0; i < 40; i++) await app.key('-')
      await sleep(300)
      const floor = await ppsNow()
      check('nhan "-" nhieu lan khong thu nho qua 0.05 px/giay', floor >= 0.0499 && floor <= 0.31, `(${floor.toFixed(3)} px/s)`)

      // tua toi giua video bang cach bam len thuoc
      await zoom(1)
      await sleep(300)
      const lane = await app.eval(`(() => { const c = document.querySelector('.cc-clip').getBoundingClientRect(); return { x: c.left + c.width / 2, y: document.querySelector('.cc-ruler').getBoundingClientRect().top + 10 } })()`)
      await app.mouse('mouseMoved', Math.round(lane.x), Math.round(lane.y)); await app.mouse('mousePressed', Math.round(lane.x), Math.round(lane.y)); await app.mouse('mouseReleased', Math.round(lane.x), Math.round(lane.y))
      await app.waitFor(`/^(29|30):/.test(document.querySelector('.cc-tlbar .cur').textContent.trim())`, { label: 'tua toi ~30 phut', timeout: 8000 })
      check('bam len thuoc o muc vua khung tua dung toi giua video (~30 phut)', true)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })
}
