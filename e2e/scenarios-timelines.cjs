// Kich ban e2e cho nhieu timeline (tab) trong mot du an. Duoc nap tu e2e/run.cjs.
const fs = require('fs')
const path = require('path')

module.exports = function register({ scenario, check, near, fx, launchApp, projectOf, probeDuration, rmsAt, channelRmsAt, probeStreams, sleep }) {
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

  scenario('doi ten duong (nhap doi), de trong = ten mac dinh, o "+ Track" o dau/cuoi them duong, ten luu trong file', async () => {
    const file = path.join(fx.dir, 'multi-trackname.taoclip')
    try { fs.rmSync(file, { force: true }) } catch {}
    const app = await launchApp({ project: projectOf(fx), dialogs: { saveProject: file } })
    try {
      await app.restoreProject()
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const nameOf = (id) => app.eval(`document.querySelector('.cc-trow[data-track-id="${id}"] .cc-thead .name')?.textContent`)
      const dbl = (id) => app.eval(`document.querySelector('.cc-trow[data-track-id="${id}"] .cc-thead .name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
      await dbl('V3')
      await app.waitFor(`!!document.querySelector('.cc-thead .name-edit')`, { label: 'o doi ten' })
      await app.send('Input.insertText', { text: 'Logo' })
      await app.key('Enter')
      await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V3"] .cc-thead .name')?.textContent === 'Logo'`, { label: 'ten moi' })
      check('nhap doi vao ten V3, go "Logo", Enter -> doi ten', (await nameOf('V3')) === 'Logo')
      await dbl('V3')
      await app.waitFor(`!!document.querySelector('.cc-thead .name-edit')`, { label: 'o doi ten 2' })
      await app.send('Input.insertText', { text: 'Se huy' })
      await app.key('Escape')
      await app.waitFor(`!document.querySelector('.cc-thead .name-edit')`, { label: 'thoat' })
      check('Escape huy, ten giu nguyen', (await nameOf('V3')) === 'Logo')
      await dbl('A2')
      await app.waitFor(`!!document.querySelector('.cc-thead .name-edit')`, { label: 'o doi ten A2' })
      await app.send('Input.insertText', { text: 'Nhac' })
      await app.eval(`document.querySelector('.cc-thead .name-edit').blur()`)
      await app.waitFor(`document.querySelector('.cc-trow[data-track-id="A2"] .cc-thead .name')?.textContent === 'Nhac'`, { label: 'blur chot ten' })
      check('roi o nhap (blur) cung chot ten', true)
      // de trong -> ten mac dinh
      await dbl('V3')
      await app.waitFor(`!!document.querySelector('.cc-thead .name-edit')`, { label: 'o doi ten 3' })
      await app.send('Input.insertText', { text: '   ' }); await app.key('Enter')
      await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V3"] .cc-thead .name')?.textContent === 'V3'`, { label: 'ten mac dinh' })
      check('de trong -> ve ten mac dinh V3', (await nameOf('V3')) === 'V3')
      await dbl('V3')
      await app.waitFor(`!!document.querySelector('.cc-thead .name-edit')`, { label: 'o doi ten 4' })
      await app.send('Input.insertText', { text: 'Logo' }); await app.key('Enter')
      await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V3"] .cc-thead .name')?.textContent === 'Logo'`, { label: 'ten Logo' })
      // hoan tac doi ten
      await app.key('z', 2)
      await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V3"] .cc-thead .name')?.textContent === 'V3'`, { label: 'hoan tac ten' })
      check('Ctrl+Z hoan tac doi ten', true)
      await app.key('y', 2)
      await app.waitFor(`document.querySelector('.cc-trow[data-track-id="V3"] .cc-thead .name')?.textContent === 'Logo'`, { label: 'lam lai ten' })
      // o "+ Track" luon thay duoc, bam la them duong
      check('o "+ Track hinh" / "+ Track tieng" thay duoc khi khong keo', (await app.text('.cc-newtrack.video')).includes('Track hình') && (await app.text('.cc-newtrack.audio')).includes('Track tiếng'))
      await app.click('.cc-newtrack.video')
      await app.waitFor(`!!document.querySelector('.cc-trow[data-track-id="V5"]')`, { label: 'V5 tu o +' })
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 99999`)
      await app.click('.cc-newtrack.audio')
      await app.waitFor(`!!document.querySelector('.cc-trow[data-track-id="A5"]')`, { label: 'A5 tu o +' })
      check('bam o "+" them V5 va A5', true)
      // ten luu trong file va doc lai
      await app.key('s', 2)
      await app.waitFor(`document.querySelector('.cc-proj').title.endsWith('multi-trackname.taoclip')`, { label: 'luu' })
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
      const names = Object.fromEntries(onDisk.timelines[0].tracks.map((track) => [track.id, track.name]))
      check('ten duong duoc luu trong file (V3 = Logo, A2 = Nhac, V1 giu mac dinh)', names.V3 === 'Logo' && names.A2 === 'Nhac' && names.V1 === 'V1', JSON.stringify(names))
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('item audio roi co song am (cat theo in..out), loop thi khong ve', async () => {
    const audio = (id, extra) => ({ id, path: fx.toneA, name: id, track: 'music', start: 0, in: 0, out: 3, gain: 1, sourceDuration: 3, ...extra })
    const project = projectOf(fx, { audioItems: [audio('plain', { start: 0 }), audio('cut', { start: 4, in: 1, out: 3 }), audio('looped', { start: 8, loop: true })] })
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 3`, { label: '3 audio item' })
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip .cc-item-wave').length >= 2`, { label: 'song am', timeout: 20000 })
      const style = (id) => app.eval(`(() => { const w = document.querySelector('.cc-audio-item-clip[data-item-id="${id}"] .cc-item-wave'); if (!w) return null; const s = getComputedStyle(w); return { image: s.backgroundImage.slice(0, 20), size: s.backgroundSize, pos: s.backgroundPosition } })()`)
      const plain = await style('plain'), cut = await style('cut'), looped = await style('looped')
      check('item audio co anh song am (anh nen la file that)', !!plain && plain.image.startsWith('url('), JSON.stringify(plain))
      check('song am ca file: rong 3s = 240px', plain.size.startsWith('240px'), plain.size)
      check('doan cat in 1..3: song am dich 1s (-80px)', cut.pos.startsWith('-80px'), cut.pos)
      check('item loop khong ve song am (doan lap)', looped === null)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('chon nhieu: Ctrl+click, quet chon, Ctrl+A; xoa / sao chep / nhan ban / tat tieng / keo ca nhom, hoan tac', async () => {
    const overlay = (id, start) => ({ id, path: fx.image, name: id + '.png', kind: 'image', start, in: 0, out: 2, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 })
    const audio = (id, start) => ({ id, path: fx.toneA, name: id, track: 'music', start, in: 0, out: 2, gain: 1, sourceDuration: 3 })
    const project = projectOf(fx, { videoOverlays: [overlay('o1', 0), overlay('o2', 3)], audioItems: [audio('m1', 0), audio('m2', 3)] })
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2 && document.querySelectorAll('.cc-audio-item-clip').length === 2`, { label: 'item' })
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const selCount = () => app.eval(`document.querySelectorAll('.cc-v2-clip.sel, .cc-audio-item-clip.sel').length`)
      const selAll = () => app.eval(`document.querySelectorAll('.cc-clip.sel, .cc-v2-clip.sel, .cc-audio-item-clip.sel').length`)
      const lefts = (selector) => app.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => Math.round(parseFloat(el.style.left))).sort((a, b) => a - b)`)
      const ctrlClick = async (selector, index = 0) => {
        const p = await app.center(selector, index)
        await app.mouse('mouseMoved', p.x, p.y)
        await app.mouse('mousePressed', p.x, p.y, { modifiers: 2 }); await app.mouse('mouseReleased', p.x, p.y, { modifiers: 2 })
      }
      // Ctrl+click: chon them
      await app.click('.cc-v2-clip', 0)
      await ctrlClick('.cc-v2-clip', 1)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip.sel').length === 2`, { label: 'Ctrl+click chon 2' })
      check('Ctrl+click: chon them mot muc, ca hai sang', (await selCount()) === 2)
      await ctrlClick('.cc-v2-clip', 1)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip.sel').length === 1`, { label: 'Ctrl+click bo chon' })
      check('Ctrl+click lan nua vao muc dang chon: bo chon muc do', (await selCount()) === 1)
      // quet chon: keo khung qua hang V2 tu vung trong ben phai sang trai, bao ca hai hinh
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      await app.click('.cc-clip', 0)
      const row = await app.rect('.cc-trow[data-track-id="V2"] .cc-tlane')
      await app.dragBy({ x: Math.round(row.x + 700), y: Math.round(row.y + row.height - 4) }, { x: Math.round(row.x + 8), y: Math.round(row.y + 4) })
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip.sel').length === 2`, { label: 'quet chon 2 hinh', timeout: 5000 })
      check('quet chon: khung keo qua hang V2 bao ca 2 hinh -> chon ca 2', (await selCount()) === 2)
      check('quet chon xong khung bien mat', (await app.count('.cc-marquee')) === 0)

      // keo ca nhom sang phai 1s (80px): tren item hinh o1
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const before = JSON.stringify(await lefts('.cc-v2-clip'))
      const o1 = await app.center('.cc-v2-clip', 0)
      await app.dragBy(o1, { x: o1.x + 80, y: o1.y })
      await app.waitFor(`Math.abs(Math.min(...[...document.querySelectorAll('.cc-v2-clip')].map(e => parseFloat(e.style.left))) - 80) < 14`, { label: 'keo nhom' })
      const afterV = await lefts('.cc-v2-clip'), afterA = await lefts('.cc-audio-item-clip')
      check('keo nhom: 2 hinh dang chon cung dich ~+1s, giu khoang cach; tieng khong dang chon thi dung yen', afterV[0] >= 66 && afterV[1] - afterV[0] === 240 && afterA[0] === 0 && afterA[1] === 240, JSON.stringify({ before, afterV, afterA }))
      await app.key('z', 2)
      await app.waitFor(`Math.round(Math.min(...[...document.querySelectorAll('.cc-v2-clip')].map(e => parseFloat(e.style.left)))) === 0`, { label: 'hoan tac keo nhom' })
      check('Ctrl+Z hoan tac keo nhom chi mot buoc (hinh ve 0 va 240)', JSON.stringify(await lefts('.cc-v2-clip')) === '[0,240]')

      // tat tieng ca nhom (M)
      await app.click('.cc-audio-item-clip', 0)
      await ctrlClick('.cc-audio-item-clip', 1)
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip.sel').length === 2`, { label: 'chon 2 tieng' })
      await app.key('m')
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip.muted').length === 2`, { label: 'tat tieng nhom' })
      check('phim M tat tieng ca nhom (2 item)', true)
      await app.key('m')
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip.muted').length === 0`, { label: 'bat tieng lai' })
      check('M lan nua bat tieng lai ca nhom', true)

      // Ctrl+A chon het, Escape bo
      await app.key('a', 2)
      await app.waitFor(`document.querySelectorAll('.cc-clip.sel, .cc-v2-clip.sel, .cc-audio-item-clip.sel').length === 6`, { label: 'Ctrl+A' })
      check('Ctrl+A chon het: 2 clip V1 + 2 hinh + 2 tieng = 6 muc', (await selAll()) === 6)
      await app.key('Escape')
      await sleep(250)
      check('Escape bo chon nhieu: chi con muc chinh', (await selAll()) <= 2)

      // sao chep + dan ca nhom: chon 2 hinh, Ctrl+C, dat playhead 6s, Ctrl+V
      await app.click('.cc-v2-clip', 0)
      await ctrlClick('.cc-v2-clip', 1)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip.sel').length === 2`, { label: 'chon 2 hinh' })
      await app.key('c', 2)
      await app.seekTo(6)
      await app.key('v', 2)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 4`, { label: 'dan nhom' })
      const pasted = await lefts('.cc-v2-clip')
      check('dan nhom: them 2 hinh, giu khoang cach 3s (240px) bat dau tai playhead 6s (480px)', pasted.length === 4 && pasted.includes(480) && pasted.includes(720), JSON.stringify(pasted))
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2`, { label: 'hoan tac dan' })
      check('Ctrl+Z hoan tac dan nhom', true)

      // nhan ban nhom (Ctrl+D) roi xoa nhom (Del)
      // hoan tac xoa lua chon, nen chon lai 2 hinh
      await app.click('.cc-v2-clip', 0)
      await ctrlClick('.cc-v2-clip', 1)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip.sel').length === 2`, { label: 'chon lai 2 hinh' })
      await app.key('d', 2)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 4`, { label: 'nhan ban nhom' })
      check('Ctrl+D nhan ban ca nhom (2 hinh -> 4)', (await app.count('.cc-v2-clip')) === 4)
      await app.key('Delete')
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2`, { label: 'xoa nhom' })
      check('Del xoa ca nhom dang chon (ban sao) con lai 2 hinh goc', (await app.count('.cc-v2-clip')) === 2)
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 4`, { label: 'hoan tac xoa nhom' })
      check('Ctrl+Z hoan tac xoa nhom chi mot buoc', true)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('cat mep bang chuot: anh / video V2+ va item audio, hai mep, gioi han theo nguon, hoan tac', async () => {
    const project = projectOf(fx, {
      videoOverlays: [
        { id: 'img', path: fx.image, name: 'img.png', kind: 'image', start: 1, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1, sourceDuration: 3 },
        { id: 'vid', path: fx.videoA, name: 'vid.mp4', kind: 'video', start: 6, in: 1, out: 4, speed: 1, sourceDuration: 5, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 }],
      audioItems: [{ id: 'aud', path: fx.toneA, name: 'aud', track: 'music', start: 1, in: 0, out: 3, gain: 1, sourceDuration: 3 }]
    })
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2 && document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'item' })
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const geo = (selector) => app.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return [Math.round(parseFloat(el.style.left)), Math.round(parseFloat(el.style.width))] })()`)
      const trim = async (selector, edge, dx) => {
        const handle = await app.center(`${selector} .cc-trim.${edge}`)
        await app.dragBy(handle, { x: handle.x + dx, y: handle.y })
        await sleep(150)
      }
      const IMG = '.cc-v2-clip[data-item-id="img"]', VID = '.cc-v2-clip[data-item-id="vid"]', AUD = '.cc-audio-item-clip[data-item-id="aud"]'
      check('truoc khi cat: anh [80,240], video [480,240], tieng [80,240]', JSON.stringify([await geo(IMG), await geo(VID), await geo(AUD)]) === '[[80,240],[480,240],[80,240]]')
      // anh: mep trai +1s (80px) -> bat dau 2s, ngan con 2s
      await trim(IMG, 'l', 80)
      check('anh: keo mep trai +1s -> bat dau 2s, dai 2s', JSON.stringify(await geo(IMG)) === '[160,160]', JSON.stringify(await geo(IMG)))
      await app.key('z', 2)
      await app.waitFor(`Math.round(parseFloat(document.querySelector('${IMG}').style.left)) === 80`, { label: 'hoan tac cat trai' })
      check('Ctrl+Z hoan tac cat mep trai mot buoc', JSON.stringify(await geo(IMG)) === '[80,240]')
      // anh: mep phai +2s (160px): anh keo dai tu do (khong bi chan boi do dai ban dau)
      await trim(IMG, 'r', 160)
      check('anh: keo mep phai +2s -> dai 5s (anh khong gioi han theo nguon)', JSON.stringify(await geo(IMG)) === '[80,400]', JSON.stringify(await geo(IMG)))
      // video (in 1, out 4, nguon 5s): mep trai +1s -> in 2, bat dau 7s, dai 2s
      await trim(VID, 'l', 80)
      check('video: mep trai +1s -> bat dau 7s, dai 2s (in doi theo)', JSON.stringify(await geo(VID)) === '[560,160]', JSON.stringify(await geo(VID)))
      // video: keo mep phai rat xa -> chi toi het nguon (out 5): dai 3s
      await trim(VID, 'r', 400)
      check('video: mep phai bi chan o het nguon (out <= 5s): dai 3s', JSON.stringify(await geo(VID)) === '[560,240]', JSON.stringify(await geo(VID)))
      // video: mep trai keo ve trai rat xa -> bi chan o dau nguon (in >= 0)
      await trim(VID, 'l', -800)
      const vid = await geo(VID)
      check('video: mep trai bi chan o dau nguon (in >= 0): bat dau 4s... khong am', vid[0] >= 0 && vid[1] <= 400, JSON.stringify(vid))
      // tieng: mep trai +1s, song am dich theo
      await trim(AUD, 'l', 80)
      check('tieng: mep trai +1s -> bat dau 2s, dai 2s', JSON.stringify(await geo(AUD)) === '[160,160]', JSON.stringify(await geo(AUD)))
      const wavePos = await app.eval(`getComputedStyle(document.querySelector('${AUD} .cc-item-wave')).backgroundPosition`)
      check('tieng: song am dich 1s theo diem vao (-80px)', wavePos.startsWith('-80px'), wavePos)
      await trim(AUD, 'r', 400)
      check('tieng: mep phai bi chan o het file (3s): dai 2s con lai', JSON.stringify(await geo(AUD)) === '[160,160]', JSON.stringify(await geo(AUD)))
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('moc tren thuoc: them (Shift+M), nhay [ ], doi ten, xoa, hoan tac, luu trong file va rieng tung tab', async () => {
    const file = path.join(fx.dir, 'multi-markers.taoclip')
    try { fs.rmSync(file, { force: true }) } catch {}
    const app = await launchApp({ project: projectOf(fx), dialogs: { saveProject: file } })
    try {
      await app.restoreProject()
      const markerLefts = () => app.eval(`[...document.querySelectorAll('.cc-ruler .cc-marker')].map((el) => Math.round(parseFloat(el.style.left))).sort((a, b) => a - b)`)
      const cur = () => app.text('.cc-tlbar .cur')
      await app.seekTo(2)
      await app.key('M', 8) // Shift+M
      await app.waitFor(`document.querySelectorAll('.cc-ruler .cc-marker').length === 1`, { label: 'moc 1' })
      await app.seekTo(5)
      await app.key('M', 8)
      await app.waitFor(`document.querySelectorAll('.cc-ruler .cc-marker').length === 2`, { label: 'moc 2' })
      const lefts = await markerLefts()
      check('Shift+M them moc tai playhead (2s = 160px, 5s = 400px)', Math.abs(lefts[0] - 160) <= 3 && Math.abs(lefts[1] - 400) <= 3, JSON.stringify(lefts))
      check('moi moc co duong ke doc xuong cac duong', (await app.count('.cc-marker-line')) === 2)
      await app.key('M', 8)
      await sleep(200)
      check('Shift+M tai cho da co moc: khong them trung', (await app.count('.cc-ruler .cc-marker')) === 2)
      // nhay moc
      await app.seekTo(0)
      await app.key(']')
      await app.waitFor(`/^00:02/.test(document.querySelector('.cc-tlbar .cur').textContent.trim())`, { label: 'nhay toi moc 1' })
      await app.key(']')
      await app.waitFor(`/^00:05/.test(document.querySelector('.cc-tlbar .cur').textContent.trim())`, { label: 'nhay toi moc 2' })
      await app.key('[')
      await app.waitFor(`/^00:02/.test(document.querySelector('.cc-tlbar .cur').textContent.trim())`, { label: 'nhay lui' })
      check('phim ] / [ nhay toi moc sau / truoc', true, await cur())
      // bam vao co moc de tua
      await app.seekTo(8)
      await app.click('.cc-marker .flag', 1)
      await app.waitFor(`/^00:05/.test(document.querySelector('.cc-tlbar .cur').textContent.trim())`, { label: 'bam moc tua' })
      check('bam vao co moc: tua toi moc', true)
      // doi ten (nhap doi)
      await sleep(300) // cho tua xong (render lai) roi moi nhap doi
      await app.eval(`document.querySelector('.cc-marker[data-marker-id] .flag').parentElement.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
      await app.waitFor(`!!document.querySelector('.cc-marker .name-edit')`, { label: 'o ten moc' })
      await app.send('Input.insertText', { text: 'Mo dau' })
      await app.key('Enter')
      await app.waitFor(`!!document.querySelector('.cc-marker .lbl')`, { label: 'ten moc' })
      check('nhap doi co moc, go "Mo dau", Enter -> hien ten', (await app.text('.cc-marker .lbl')) === 'Mo dau')
      // xoa bang menu chuot phai
      await app.rightClick('.cc-marker .flag', 1)
      await app.waitFor(`!!document.querySelector('.cc-ctxmenu')`, { label: 'menu moc' })
      await app.click('.cc-ctxmenu [data-ctx="marker-delete"]')
      await app.waitFor(`document.querySelectorAll('.cc-ruler .cc-marker').length === 1`, { label: 'xoa moc' })
      check('chuot phai -> Xoa moc: con 1 moc', true)
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-ruler .cc-marker').length === 2`, { label: 'hoan tac xoa moc' })
      check('Ctrl+Z hoan tac xoa moc', true)
      // luu
      await app.key('s', 2)
      await app.waitFor(`document.querySelector('.cc-proj').title.endsWith('multi-markers.taoclip')`, { label: 'luu' })
      const markers = JSON.parse(fs.readFileSync(file, 'utf8')).timelines[0].markers
      check('moc va ten luu trong file', markers.length === 2 && markers.some((m) => m.name === 'Mo dau'), JSON.stringify(markers))
      // moc rieng tung tab
      await app.click('.cc-tltab-add')
      await app.waitFor(`document.querySelectorAll('.cc-tltab').length === 2`, { label: 'tab 2' })
      check('tab moi khong co moc cua tab 1', (await app.count('.cc-ruler .cc-marker')) === 0)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('xoa dan (Shift+Del) clip V1: cac lop phia sau lui, muc nam trong doan bi xoa, xoa thuong thi khong dan, hoan tac', async () => {
    const overlay = (id, start) => ({ id, path: fx.image, name: id, kind: 'image', start, in: 0, out: 1, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 })
    const project = projectOf(fx, {
      videoOverlays: [overlay('inside', 1), overlay('after', 6)],
      audioItems: [{ id: 'm-in', path: fx.toneA, name: 'm-in', track: 'music', start: 1, in: 0, out: 2, gain: 1, sourceDuration: 3 }, { id: 'm-after', path: fx.toneA, name: 'm-after', track: 'music', start: 7, in: 0, out: 2, gain: 1, sourceDuration: 3 }],
      overlays: [{ id: 't1', type: 'text', text: 'Chu', start: 6, end: 8, x: 0.5, y: 0.5, size: 0.07, color: '#fff' }]
    })
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 2 && document.querySelectorAll('.cc-audio-item-clip').length === 2`, { label: 'item' })
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const lefts = (selector) => app.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => Math.round(parseFloat(el.style.left))).sort((a, b) => a - b)`)
      const total = () => app.text('.cc-tlbar .cur')
      // xoa thuong (Del) clip dau: cac lop giu nguyen vi tri
      await app.click('.cc-clip', 0)
      await app.key('Delete')
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'xoa thuong' })
      check('Del thuong: clip roi V1 nhung hinh phu / tieng giu nguyen vi tri (480, 80...)', JSON.stringify(await lefts('.cc-v2-clip')) === '[80,480]', JSON.stringify(await lefts('.cc-v2-clip')))
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 2`, { label: 'hoan tac xoa thuong' })
      // xoa dan (Shift+Del) clip dau (0-5s)
      await app.click('.cc-clip', 0)
      await app.key('Delete', 8)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 1`, { label: 'xoa dan' })
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 1`, { label: 'item trong doan bi xoa' })
      check('xoa dan: hinh phu nam trong doan 0-5s bi xoa cung', (await app.count('.cc-v2-clip')) === 1)
      check('xoa dan: hinh phu sau doan lui 5s (6s -> 1s = 80px)', JSON.stringify(await lefts('.cc-v2-clip')) === '[80]', JSON.stringify(await lefts('.cc-v2-clip')))
      check('xoa dan: tieng trong doan bi xoa, tieng sau doan lui 5s (7s -> 2s = 160px)', (await app.count('.cc-audio-item-clip')) === 1 && JSON.stringify(await lefts('.cc-audio-item-clip')) === '[160]', JSON.stringify(await lefts('.cc-audio-item-clip')))
      check('xoa dan: tong thoi luong con 4s', /\/ 00:04/.test(await total()), await total())
      await app.key('z', 2)
      await app.waitFor(`document.querySelectorAll('.cc-clip').length === 2 && document.querySelectorAll('.cc-v2-clip').length === 2 && document.querySelectorAll('.cc-audio-item-clip').length === 2`, { label: 'hoan tac xoa dan' })
      check('Ctrl+Z hoan tac xoa dan: ve nhu cu trong mot buoc', JSON.stringify(await lefts('.cc-v2-clip')) === '[80,480]' && JSON.stringify(await lefts('.cc-audio-item-clip')) === '[80,560]')
      // menu chuot phai co muc "Xoa va don cac lop"
      await app.rightClick('.cc-clip', 0)
      await app.waitFor(`!!document.querySelector('.cc-ctxmenu [data-ctx="ripple"]')`, { label: 'muc ripple' })
      check('menu chuot phai clip V1 co "Xoa va don cac lop"', true)
      await app.key('Escape')
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('thu gon duong trong (hien lai khi keo) va canh bao qua nhieu lop hinh cung luc', async () => {
    const overlay = (id, trackId) => ({ id, trackId, path: fx.image, name: id, kind: 'image', start: 0, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 })
    const project = projectOf(fx, {
      videoOverlays: [overlay('o3', 'V3')],
      audioItems: [{ id: 'm2', trackId: 'A2', path: fx.toneA, name: 'm2', track: 'music', start: 0, in: 0, out: 3, gain: 1, sourceDuration: 3 }]
    })
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      const rowIds = () => app.eval(`[...document.querySelectorAll('.cc-trow')].map((r) => r.dataset.trackId).join()`)
      check('mac dinh hien du 8 duong', (await rowIds()) === 'V4,V3,V2,V1,A1,A2,A3,A4', await rowIds())
      check('chua co canh bao qua nhieu lop (V1 + 1 lop phu)', (await app.count('.tb-warn')) === 0)
      await app.click('.tb-compact')
      await app.waitFor(`document.querySelectorAll('.cc-trow').length === 4`, { label: 'thu gon' })
      check('thu gon: chi con V3 (co item), V1, A1, A2 (co item)', (await rowIds()) === 'V3,V1,A1,A2', await rowIds())
      check('nut thu gon bao so duong dang an (4)', (await app.text('.tb-compact small')) === '4')
      // keo file -> hien du duong de tha
      const data = { items: [], files: [fx.image.split('/').join(String.fromCharCode(92))], dragOperationsMask: 1 }
      await app.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 640, y: 300, data })
      await app.send('Input.dispatchDragEvent', { type: 'dragOver', x: 640, y: 300, data })
      await app.waitFor(`document.querySelectorAll('.cc-trow').length === 8`, { label: 'hien du khi keo' })
      check('dang keo file: hien lai du 8 duong de tha vao', true)
      // roi khoi cua so khi dang keo (dragleave khong co relatedTarget)
      await app.eval(`document.querySelector('.cc').dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null }))`)
      await app.waitFor(`document.querySelectorAll('.cc-trow').length === 4`, { label: 'thu gon lai' })
      check('keo xong: thu gon lai', true)
      await app.click('.tb-compact')
      await app.waitFor(`document.querySelectorAll('.cc-trow').length === 8`, { label: 'mo rong' })
      check('bam lai: hien du 8 duong', true)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }

    // 6 lop phu cung luc + V1 = 7 lop > 6: hien canh bao
    const stack = projectOf(fx, { videoOverlays: ['V2', 'V3', 'V4', 'V5', 'V6', 'V7'].map((trackId) => overlay('o' + trackId, trackId)) })
    const busy = await launchApp({ project: stack })
    try {
      await busy.restoreProject()
      await busy.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 6`, { label: '6 lop phu' })
      check('7 lop hinh cung luc (V1 + 6): hien canh bao tren thanh cong cu', (await busy.count('.tb-warn')) === 1 && /7/.test(await busy.text('.tb-warn')), await busy.text('.tb-warn'))
      await busy.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      // an mot lop (mat) -> con 6 lop: het canh bao
      await busy.click('.cc-trow[data-track-id="V7"] .cc-thead .tools button', 0)
      await busy.waitFor(`document.querySelectorAll('.tb-warn').length === 0`, { label: 'het canh bao' })
      check('an bot mot lop (con 6): canh bao bien mat', true)
      check('khong co loi runtime', busy.errors.length === 0, busy.errors.slice(0, 2).join(' | '))
    } finally { busy.close() }
  })

  scenario('bang thuoc tinh theo muc dang chon: V1, lop hinh, sticker, tieng, chu, nhieu muc; sua so, khoa ti le, hoan tac', async () => {
    const overlay = (id, extra) => ({ id, name: id, start: 1, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.2, opacity: 1, ...extra })
    const project = projectOf(fx, {
      videoOverlays: [
        overlay('vid', { path: fx.videoA, kind: 'video', start: 1, in: 0, out: 4, sourceDuration: 5, speed: 1 }),
        overlay('img', { path: fx.image, kind: 'image', start: 6 }),
        overlay('stk', { sticker: 'twemoji/1f600', path: '', kind: 'image', start: 8, width: 0.2, height: 0.2 })],
      audioItems: [{ id: 'aud', path: fx.toneA, name: 'aud', track: 'music', start: 0, in: 0, out: 3, gain: 1, sourceDuration: 3 }],
      overlays: [{ id: 'txt', type: 'text', text: 'Chu thu', start: 2, end: 4, x: 0.5, y: 0.5, size: 0.07, color: '#ffffff' }]
    })
    const app = await launchApp({ project })
    try {
      await app.restoreProject()
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip').length === 3 && document.querySelectorAll('.cc-audio-item-clip').length === 1`, { label: 'item' })
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const panel = () => app.eval(`document.querySelector('.cc-insp [data-inspector]')?.dataset.inspector || null`)
      const prop = (name) => app.eval(`Number(document.querySelector('.cc-insp [data-prop="${name}"]').value)`)
      const setProp = async (name, value) => {
        await app.eval(`(() => { const el = document.querySelector('.cc-insp [data-prop="${name}"]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${value}'); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur() })()`)
        await sleep(150)
      }
      const geo = (selector) => app.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return [Math.round(parseFloat(el.style.left)), Math.round(parseFloat(el.style.width))] })()`)
      check('chon clip V1: bang thuoc tinh clip (toc do, cat, vua khung...)', (await app.click('.cc-clip', 0), await sleep(150), await panel()) === 'clip')
      // lop hinh video
      await app.click('.cc-v2-clip[data-item-id="vid"]')
      await app.waitFor(`document.querySelector('.cc-insp [data-inspector]')?.dataset.inspector === 'overlay'`, { label: 'bang lop hinh' })
      check('chon video V2: bang thuoc tinh cua lop hinh (khong con hien clip V1)', (await panel()) === 'overlay' && (await app.count('.cc-insp [data-inspector="clip"]')) === 0)
      check('hien dung gia tri: X 50, Y 50, rong 40, cao 20, bat dau 1, toc do 1', JSON.stringify([await prop('x'), await prop('y'), await prop('width'), await prop('height'), await prop('start'), await prop('speed')]) === '[50,50,40,20,1,1]')
      await setProp('x', 30)
      check('sua X = 30% -> vi tri trong khung xem trước doi (left 30%)', (await app.eval(`document.querySelector('.cc-frame .cc-v2-preview')?.parentElement?.style.left || document.querySelector('.cc-frame .cc-v2-preview')?.style.left || ''`)).startsWith('30') || (await prop('x')) === 30)
      await app.key('z', 2)
      await app.waitFor(`Number(document.querySelector('.cc-insp [data-prop="x"]').value) === 50`, { label: 'hoan tac X' })
      check('Ctrl+Z hoan tac mot lan sua so', true)
      // khoa ti le: rong 40 -> 80 thi cao 20 -> 40
      await setProp('width', 80)
      check('khoa ti le: rong 80% thi cao tu doi thanh 40%', (await prop('width')) === 80 && (await prop('height')) === 40, `(${await prop('width')} x ${await prop('height')})`)
      await app.click('.cc-insp [data-prop="lock"]')
      await setProp('height', 10)
      check('tat khoa ti le: sua cao 10% khong doi rong (80%)', (await prop('height')) === 10 && (await prop('width')) === 80)
      // thoi gian: bat dau + toc do
      await setProp('start', 2)
      const g1 = await geo('.cc-v2-clip[data-item-id="vid"]')
      check('sua bat dau = 2s: item tren timeline dich toi 160px', g1[0] === 160, JSON.stringify(g1))
      await setProp('speed', 2)
      const g2 = await geo('.cc-v2-clip[data-item-id="vid"]')
      check('toc do 2x: item ngan mot nua (4s -> 2s = 160px)', g2[1] === 160, JSON.stringify(g2))
      await setProp('out', 99)
      check('diem ra bi chan o het nguon (5s)', (await prop('out')) === 5, String(await prop('out')))
      // anh va sticker: khong co diem vao / toc do
      await app.click('.cc-v2-clip[data-item-id="img"]')
      await app.waitFor(`!!document.querySelector('.cc-insp [data-prop="out"]') && !document.querySelector('.cc-insp [data-prop="speed"]')`, { label: 'bang anh' })
      check('anh phu: co thoi luong, khong co diem vao / toc do', (await app.count('.cc-insp [data-prop="in"]')) === 0 && (await app.count('.cc-insp [data-prop="speed"]')) === 0)
      await setProp('out', 6)
      const g3 = await geo('.cc-v2-clip[data-item-id="img"]')
      check('anh keo dai 6s tren timeline (480px), khong gioi han theo nguon', g3[1] === 480, JSON.stringify(g3))
      await app.click('.cc-v2-clip[data-item-id="stk"]')
      await app.waitFor(`document.querySelector('.cc-insp [data-inspector="overlay"] label b')?.textContent === 'stk'`, { label: 'bang sticker' })
      check('sticker: bang thuoc tinh rieng (khong co diem vao / toc do)', (await app.count('.cc-insp [data-prop="speed"]')) === 0 && (await app.count('.cc-insp [data-prop="x"]')) === 1)
      // tieng
      await app.click('.cc-audio-item-clip[data-item-id="aud"]')
      await app.waitFor(`document.querySelector('.cc-insp [data-inspector]')?.dataset.inspector === 'audio'`, { label: 'bang tieng' })
      check('chon item tieng: bang thuoc tinh tieng (bat dau, cat, toc do, am luong, fade)', (await panel()) === 'audio' && (await app.count('.cc-insp [data-prop="speed"]')) === 1 && (await app.count('.cc-insp [data-prop="fadeIn"]')) === 1)
      await setProp('speed', 2)
      const ga = await geo('.cc-audio-item-clip[data-item-id="aud"]')
      check('tieng toc do 2x: ngan mot nua (3s -> 1.5s = 120px)', ga[1] === 120, JSON.stringify(ga))
      await setProp('fadeIn', 0.5)
      check('fade in 0.5s ghi nhan', (await prop('fadeIn')) === 0.5)
      // chu
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      await app.click('.cc-oclip')
      await app.waitFor(`document.querySelector('.cc-insp [data-inspector]')?.dataset.inspector === 'text'`, { label: 'bang chu' })
      check('chon chu: bang tom tat va nut mo tab Van ban', (await app.count('.cc-insp [data-inspector="text"] .cc-auto')) === 1)
      // nhieu muc
      await app.click('.cc-v2-clip[data-item-id="vid"]')
      const p = await app.center('.cc-v2-clip[data-item-id="img"]')
      await app.mouse('mouseMoved', p.x, p.y); await app.mouse('mousePressed', p.x, p.y, { modifiers: 2 }); await app.mouse('mouseReleased', p.x, p.y, { modifiers: 2 })
      await app.waitFor(`document.querySelector('.cc-insp [data-inspector]')?.dataset.inspector === 'multi'`, { label: 'bang nhieu muc' })
      check('chon nhieu muc: bang tom tat nhom', (await panel()) === 'multi')
      // danh sach cu da bo
      await app.key('Escape')
      check('khong con danh sach "liet ke tat ca" o tab Media va tab Am thanh', (await app.count('.cc-v2-controls')) === 0 && (await app.count('.cc-audio-item:not(.cc-audio-item-clip)')) === 0)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('xoay / lat / mo vao ra cho lop hinh: bang thuoc tinh, xem truoc, hoan tac, luu trong file', async () => {
    const file = path.join(fx.dir, 'multi-transform.taoclip')
    try { fs.rmSync(file, { force: true }) } catch {}
    const project = projectOf(fx, { videoOverlays: [{ id: 'img', path: fx.image, name: 'img.png', kind: 'image', start: 1, in: 0, out: 3, x: 0.5, y: 0.5, width: 0.4, height: 0.2, opacity: 1 }] })
    const app = await launchApp({ project, dialogs: { saveProject: file } })
    try {
      await app.restoreProject()
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      await app.click('.cc-v2-clip')
      await app.waitFor(`!!document.querySelector('.cc-insp [data-prop="rotation"]')`, { label: 'bang thuoc tinh' })
      const prop = (name) => app.eval(`Number(document.querySelector('.cc-insp [data-prop="${name}"]').value)`)
      const setProp = async (name, value) => {
        await app.eval(`(() => { const el = document.querySelector('.cc-insp [data-prop="${name}"]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${value}'); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur() })()`)
        await sleep(150)
      }
      const preview = () => app.eval(`(() => { const el = document.querySelector('.cc-frame .cc-v2-preview'); return el ? { transform: el.style.transform, opacity: Number(el.style.opacity) } : null })()`)
      await app.seekTo(1.1)
      await app.waitFor(`!!document.querySelector('.cc-frame .cc-v2-preview')`, { label: 'lop hinh trong khung xem' })
      check('mac dinh: khong xoay, khong lat', (await prop('rotation')) === 0 && !(await preview()).transform.includes('rotate(90'))
      await app.click('.cc-insp [data-act="rot-right"]')
      await app.waitFor(`Number(document.querySelector('.cc-insp [data-prop="rotation"]').value) === 90`, { label: 'xoay phai 90' })
      check('nut xoay phai 90 do: goc = 90, khung xem truoc xoay theo', (await preview()).transform.includes('rotate(90deg)'), (await preview()).transform)
      await app.click('.cc-insp [data-act="rot-left"]')
      await app.click('.cc-insp [data-act="rot-left"]')
      await app.waitFor(`Number(document.querySelector('.cc-insp [data-prop="rotation"]').value) === -90`, { label: 'xoay trai 2 lan' })
      check('xoay trai 2 lan tu 90: goc = -90', (await prop('rotation')) === -90)
      await setProp('rotation', 45)
      check('go goc 45 do: ghi nhan, xem truoc rotate(45deg)', (await prop('rotation')) === 45 && (await preview()).transform.includes('rotate(45deg)'))
      await app.click('.cc-insp [data-act="flip-h"]')
      await app.waitFor(`document.querySelector('.cc-insp [data-act="flip-h"]').getAttribute('aria-pressed') === 'true'`, { label: 'lat ngang' })
      check('lat ngang: nut sang, xem truoc scale(-1, 1)', (await preview()).transform.includes('scale(-1, 1)'), (await preview()).transform)
      await app.click('.cc-insp [data-act="flip-v"]')
      await app.waitFor(`document.querySelector('.cc-insp [data-act="flip-v"]').getAttribute('aria-pressed') === 'true'`, { label: 'lat doc' })
      check('lat doc: scale(-1, -1)', (await preview()).transform.includes('scale(-1, -1)'))
      // hoan tac lat doc
      await app.key('z', 2)
      await app.waitFor(`document.querySelector('.cc-insp [data-act="flip-v"]').getAttribute('aria-pressed') === 'false'`, { label: 'hoan tac lat doc' })
      check('Ctrl+Z hoan tac mot buoc (lat doc)', (await preview()).transform.includes('scale(-1, 1)'))
      // mo vao 1s: tai 1.25s (0.25s sau khi bat dau) do trong suot ~ 0.25
      await setProp('fadeIn', 1)
      await app.seekTo(1.25)
      await sleep(250)
      const faded = await preview()
      check('mo vao 1s: tai 0.25s sau khi bat dau, do trong suot ~0.25 trong khung xem', faded && faded.opacity > 0.1 && faded.opacity < 0.45, JSON.stringify(faded))
      await app.seekTo(2.5)
      await sleep(250)
      check('sau khi mo xong: do trong suot day du (1)', Math.abs((await preview()).opacity - 1) < 0.01)
      await setProp('fadeOut', 1)
      await app.seekTo(3.75)
      await sleep(250)
      const out = await preview()
      check('mo ra 1s: tai 0.25s truoc khi het, do trong suot ~0.25', out && out.opacity > 0.1 && out.opacity < 0.45, JSON.stringify(out))
      // luu
      await app.key('s', 2)
      await app.waitFor(`document.querySelector('.cc-proj').title.endsWith('multi-transform.taoclip')`, { label: 'luu' })
      const item = JSON.parse(fs.readFileSync(file, 'utf8')).timelines[0].videoOverlays[0]
      check('file luu co xoay 45, lat ngang, mo vao / ra 1s', item.rotation === 45 && item.flipH === true && item.flipV === false && item.fadeIn === 1 && item.fadeOut === 1, JSON.stringify({ r: item.rotation, h: item.flipH, v: item.flipV, i: item.fadeIn, o: item.fadeOut }))
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  scenario('am luong rieng tung clip V1 va can bang trai / phai item tieng: bang thuoc tinh, luu, xuat that', async () => {
    const file = path.join(fx.dir, 'multi-volume.taoclip')
    const out = path.join(fx.dir, 'e2e-clip-volume.mp4')
    for (const f of [file, out]) { try { fs.rmSync(f, { force: true }) } catch {} }
    const single = { version: 4, projectId: 'e2e-volume-' + Math.random().toString(36).slice(2), clips: [{ id: 'c1', path: fx.videoA, name: 'video-a.mp4', kind: 'video', in: 0, out: 5, speed: 1 }],
      audioItems: [{ id: 'aud', path: fx.toneA, name: 'aud', track: 'music', start: 4, in: 0, out: 1, gain: 1, sourceDuration: 3 }] }
    const app = await launchApp({ project: single, dialogs: { saveProject: file, saveVideo: out.replace(/\\/g, '/') } })
    try {
      await app.restoreProject()
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      const setProp = async (name, value) => {
        await app.eval(`(() => { const el = document.querySelector('.cc-insp [data-prop="${name}"]'); el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${value}'); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur() })()`)
        await sleep(150)
      }
      await app.click('.cc-clip', 0)
      await app.waitFor(`!!document.querySelector('.cc-insp [data-prop="clipVolume"]')`, { label: 'thanh am luong clip' })
      check('clip V1 co tieng: bang thuoc tinh co thanh "Am luong clip" (mac dinh 100%)', Number(await app.eval(`document.querySelector('.cc-insp [data-prop="clipVolume"]').value`)) === 1)
      await setProp('clipVolume', 0.5)
      check('keo ve 50%: ghi nhan', Number(await app.eval(`document.querySelector('.cc-insp [data-prop="clipVolume"]').value`)) === 0.5)
      await setProp('clipVolume', 1.5)
      check('tren 100%: hien chu thich xem truoc toi da 100%', (await app.count('.cc-insp [data-inspector="clip"] .cap-hint')) >= 1 && Number(await app.eval(`document.querySelector('.cc-insp [data-prop="clipVolume"]').value`)) === 1.5)
      await setProp('clipVolume', 0.5)
      // can bang cua item tieng
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 99999`)
      await app.click('.cc-audio-item-clip')
      await app.waitFor(`!!document.querySelector('.cc-insp [data-prop="pan"]')`, { label: 'thanh can bang' })
      await setProp('pan', -1)
      check('item tieng: keo can bang ve ben trai hoan toan (-1) va co chu thich "chi khi xuat"', Number(await app.eval(`document.querySelector('.cc-insp [data-prop="pan"]').value`)) === -1 && (await app.count('.cc-insp [data-inspector="audio"] .cap-hint')) >= 1)
      await app.key('s', 2)
      await app.waitFor(`document.querySelector('.cc-proj').title.endsWith('multi-volume.taoclip')`, { label: 'luu' })
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')).timelines[0]
      check('file luu co am luong clip 0.5 va can bang -1', saved.clips[0].volume === 0.5 && saved.audioItems[0].pan === -1, JSON.stringify({ v: saved.clips[0].volume, p: saved.audioItems[0].pan }))
      // xuat that: bo item tieng truoc (khi co item, nguon mono duoc tron sang stereo nen muc doi -3 dB) de do dung am luong clip
      await app.key('Delete')
      await app.waitFor(`document.querySelectorAll('.cc-audio-item-clip').length === 0`, { label: 'xoa item tieng' })
      // xuat that: am luong 0.5 -> muc tieng dau ra ~ mot nua nguon
      await app.click('.cc-top .cc-export')
      await app.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
      await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === '720p').click()`)
      await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === 'Nhỏ gọn').click()`)
      await app.click('.cc-modal-box .exp-start')
      await app.waitFor(`!document.querySelector('.cc-modal-box')`, { timeout: 120000, label: 'xuat xong', interval: 500 })
      const source = rmsAt(fx.videoA, 0.5, 0.6), exported = rmsAt(out, 0.5, 0.6)
      check('xuat that: tieng clip chi con ~50% so voi nguon', source > 0.02 && Math.abs(exported / source - 0.5) < 0.12, `(${(exported / source).toFixed(2)})`)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }
  })

  // Xuat that bang giao dien (720p, nho gon)
  const exportFromUi = async (app) => {
    await app.click('.cc-top .cc-export')
    await app.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
    await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === '720p').click()`)
    await app.eval(`[...document.querySelectorAll('.cc-modal-box .seg button')].find(b => b.textContent.trim() === 'Nhỏ gọn').click()`)
    await app.click('.cc-modal-box .exp-start')
    await app.waitFor(`!document.querySelector('.cc-modal-box')`, { timeout: 120000, label: 'xuat xong', interval: 500 })
  }

  scenario('tieng cua video phu (V2+): file cu tat tieng, bat bang hop kiem thi xuat co tieng; can bang trai / phai khi xuat that', async () => {
    const out = path.join(fx.dir, 'e2e-overlay-audio.mp4')
    try { fs.rmSync(out, { force: true }) } catch {}
    const project = { version: 4, projectId: 'e2e-ovaudio-' + Math.random().toString(36).slice(2),
      clips: [{ id: 'c1', path: fx.videoSilent, name: 'video-silent.mp4', kind: 'video', in: 0, out: 3, speed: 1 }],
      videoOverlays: [{ id: 'ov', path: fx.videoA, name: 'video-a.mp4', kind: 'video', start: 0, in: 0, out: 3, speed: 1, sourceDuration: 5, x: 0.5, y: 0.5, width: 0.4, height: 0.4, opacity: 1 }] }
    const app = await launchApp({ project, dialogs: { saveVideo: out.replace(/\\/g, '/') } })
    try {
      await app.restoreProject()
      await app.eval(`document.querySelector('.cc-tlscroll').scrollTop = 0`)
      await app.click('.cc-v2-clip')
      await app.waitFor(`!!document.querySelector('.cc-insp [data-prop="useSound"]')`, { label: 'hop kiem tieng' })
      check('du an cu: video phu mac dinh tat tieng (hop kiem trong, khong co bieu tuong loa)', !(await app.eval(`document.querySelector('.cc-insp [data-prop="useSound"]').checked`)) && (await app.count('.cc-v2-clip .ov-audio')) === 0)
      await exportFromUi(app)
      check('xuat khi tat tieng video phu: khong co luong audio (giu hanh vi cu)', !probeStreams(out).includes('audio'), probeStreams(out).join(','))
      await app.click('.cc-insp [data-prop="useSound"]')
      await app.waitFor(`!!document.querySelector('.cc-v2-clip .ov-audio') && !!document.querySelector('.cc-insp [data-prop="overlayVolume"]')`, { label: 'bat tieng' })
      check('bat tieng: bieu tuong loa tren item va thanh am luong hien ra', true)
      try { fs.rmSync(out, { force: true }) } catch {}
      await exportFromUi(app)
      const level = rmsAt(out, 0.5, 0.6)
      check('xuat khi bat tieng video phu: co audio va co muc tieng (>0.02)', probeStreams(out).includes('audio') && level > 0.02, `(rms ${level.toFixed(3)})`)
      // M tat lai
      await app.key('m')
      await app.waitFor(`document.querySelectorAll('.cc-v2-clip .ov-audio').length === 0`, { label: 'M tat tieng' })
      check('phim M tat / bat tieng cua video phu', true)
      check('khong co loi runtime', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
    } finally { app.close() }

    // can bang: tieng item (mono) dat hoan toan ben trai
    const panOut = path.join(fx.dir, 'e2e-pan.mp4')
    try { fs.rmSync(panOut, { force: true }) } catch {}
    const panProject = { version: 4, projectId: 'e2e-pan-' + Math.random().toString(36).slice(2),
      clips: [{ id: 'c1', path: fx.videoSilent, name: 'video-silent.mp4', kind: 'video', in: 0, out: 3, speed: 1 }],
      audioItems: [{ id: 'aud', path: fx.toneA, name: 'aud', track: 'music', start: 0, in: 0, out: 3, gain: 1, sourceDuration: 3, pan: -1 }] }
    const pan = await launchApp({ project: panProject, dialogs: { saveVideo: panOut.replace(/\\/g, '/') } })
    try {
      await pan.restoreProject()
      await exportFromUi(pan)
      const left = channelRmsAt(panOut, 0, 0.5, 1), right = channelRmsAt(panOut, 1, 0.5, 1)
      check('xuat that voi can bang -1: chi kenh trai co tieng', left > 0.03 && right < 0.003, `(L ${left.toFixed(3)} R ${right.toFixed(3)})`)
      check('khong co loi runtime', pan.errors.length === 0, pan.errors.slice(0, 2).join(' | '))
    } finally { pan.close() }
  })

  scenario('ti le khung + vung an toan o thanh duoi khung xem truoc (ap dung ca video), khong con trong bang thuoc tinh clip', async () => {
    const app = await launchApp({ project: projectOf(fx) })
    try {
      await app.restoreProject()
      const frameRatio = () => app.eval(`document.querySelector('.cc-frame').style.aspectRatio`)
      const buttonRatio = () => app.eval(`document.querySelector('.cc-format-btn').dataset.ratio`)
      check('bang thuoc tinh clip khong con nhom "Ti le khung" / "Vung an toan"', !(await app.eval(`/Tỉ lệ khung|vùng an toàn/i.test(document.querySelector('.cc-insp').innerText)`)))
      check('thanh duoi khung xem truoc co nut ti le (mac dinh 9:16)', (await buttonRatio()) === '9:16' && (await frameRatio()) === '9 / 16')
      await app.click('.cc-format-btn')
      await app.waitFor(`!!document.querySelector('.cc-format-menu')`, { label: 'menu ti le' })
      const options = await app.eval(`[...document.querySelectorAll('.cc-format-menu [data-ratio-option]')].map((b) => b.dataset.ratioOption).join()`)
      check('menu liet ke 9:16, 1:1, 4:5, 16:9, Goc va co ghi chu "ca video"', options === '9:16,1:1,4:5,16:9,original' && /CẢ video/.test(await app.text('.cc-format-menu')), options)
      await app.click('.cc-format-menu [data-ratio-option="16:9"]')
      await app.waitFor(`document.querySelector('.cc-frame').style.aspectRatio === '16 / 9'`, { label: 'doi sang 16:9' })
      check('chon 16:9: khung xem truoc doi theo, menu dong', (await buttonRatio()) === '16:9' && (await app.count('.cc-format-menu')) === 0)
      await app.key('z', 2)
      await app.waitFor(`document.querySelector('.cc-frame').style.aspectRatio === '9 / 16'`, { label: 'hoan tac ti le' })
      check('Ctrl+Z hoan tac doi ti le', (await buttonRatio()) === '9:16')
      // vung an toan
      check('chua bat: khong co vung an toan trong khung', (await app.count('.cc-frame .safe')) === 0)
      await app.click('.cc-format-btn')
      await app.click('.cc-format-menu [data-safezone]')
      await app.waitFor(`!!document.querySelector('.cc-frame .safe')`, { label: 'vung an toan' })
      check('bat "Hien vung an toan": hien lop vung an toan tren khung', true)
      // dong menu bang Escape va bam ra ngoai
      await app.key('Escape')
      await app.waitFor(`!document.querySelector('.cc-format-menu')`, { label: 'dong bang Escape' })
      await app.click('.cc-format-btn')
      await app.waitFor(`!!document.querySelector('.cc-format-menu')`, { label: 'mo lai' })
      await app.click('.cc-tlbar .cur')
      await app.waitFor(`!document.querySelector('.cc-format-menu')`, { label: 'dong khi bam ra ngoai' })
      check('menu dong bang Escape va khi bam ra ngoai', true)
      // moi timeline mot ti le
      await app.click('.cc-format-btn'); await app.click('.cc-format-menu [data-ratio-option="1:1"]')
      await app.waitFor(`document.querySelector('.cc-frame').style.aspectRatio === '1 / 1'`, { label: '1:1' })
      await app.click('.cc-tltab-add')
      await app.waitFor(`document.querySelectorAll('.cc-tltab').length === 2`, { label: 'tab 2' })
      await app.click('.cc-format-btn'); await app.click('.cc-format-menu [data-ratio-option="16:9"]')
      await app.waitFor(`document.querySelector('.cc-format-btn').dataset.ratio === '16:9'`, { label: 'tab 2 16:9' })
      await app.click('.cc-tltab .nm', 0)
      await app.waitFor(`document.querySelector('.cc-format-btn').dataset.ratio === '1:1'`, { label: 've tab 1' })
      check('moi timeline (tab) giu ti le rieng: tab 1 = 1:1, tab 2 = 16:9', true)
      // hop Xuat nhac ve nut ti le
      await app.click('.cc-top .cc-export')
      await app.waitFor(`!!document.querySelector('.cc-modal-box .exp-start')`, { label: 'hop thoai xuat' })
      check('hop Xuat co ghi chu: doi ti le chinh o nut duoi khung xem truoc', /nút tỉ lệ dưới khung xem trước/.test(await app.text('.cc-modal-box')))
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
