// Kiem thu thuan cho nhieu timeline trong mot du an (schema v6):  node test-timelines.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { normalizeProject, activeTimeline, PROJECT_VERSION } from './src/renderer/project-model.js'
import {
  TIMELINE_KEYS, MAX_TIMELINES, pickTimelineFields, cleanTimelineName, nextTimelineName, copyTimelineName,
  activeAfterRemove, moveTimeline, referencedPaths, libraryAfterRestore, approxTimelineDuration
} from './src/renderer/timelines-model.js'
const require = createRequire(import.meta.url)
const projectStore = require('./electron/project-store.cjs')
const portableProject = require('./electron/portable-project.cjs')

let n = 0
const test = (name, fn) => { fn(); n++; console.log('  PASS ' + name) }
let counter = 0
const makeId = (kind) => `${kind}_${++counter}`
const clip = (id, file, extra = {}) => ({ id, path: file, in: 0, out: 4, ...extra })

test('file v5 thanh mot timeline "Timeline 1"; noi dung vao timelines[], thu vien o lai muc du an', () => {
  const project = normalizeProject({ version: 5, projectId: 'p1', ratio: '16:9', clips: [clip('c1', 'a.mp4')],
    captions: [{ id: 'k', text: 'hi', start: 0, end: 1 }], assets: [{ id: 'as1', path: 'a.mp4', kind: 'video' }] }, makeId)
  assert.equal(project.version, PROJECT_VERSION)
  assert.equal(PROJECT_VERSION, 6)
  assert.equal(project.timelines.length, 1)
  assert.equal(project.timelines[0].name, 'Timeline 1')
  assert.equal(project.activeTimelineId, project.timelines[0].id)
  assert.equal(project.timelines[0].ratio, '16:9')
  assert.equal(project.timelines[0].clips[0].id, 'c1')
  assert.equal(project.timelines[0].captions[0].text, 'hi')
  assert.equal(project.projectId, 'p1')
  assert.deepEqual(project.assets.map((asset) => asset.id), ['as1'])
  for (const key of TIMELINE_KEYS) assert.ok(!(key in project), `${key} khong con o muc du an`)
})

test('thieu timelines -> mot timeline rong; vong luu/doc on dinh', () => {
  const empty = normalizeProject({ version: 6 }, makeId)
  assert.equal(empty.timelines.length, 1)
  assert.deepEqual(empty.timelines[0].clips, [])
  const once = normalizeProject({ version: 5, clips: [clip('c1', 'a.mp4')], tracks: [{ id: 'A2', muted: true }] }, makeId)
  const twice = normalizeProject(JSON.parse(JSON.stringify(once)), makeId)
  assert.deepEqual(twice, once)
})

test('nhieu timeline: noi dung doc lap, cai dat rieng (ti le, loc), ten va tab dang mo duoc giu', () => {
  const project = normalizeProject({ version: 6, projectId: 'p2', activeTimelineId: 'tl-b', assets: [],
    timelines: [
      { id: 'tl-a', name: 'Tap 1', ratio: '9:16', clips: [clip('c1', 'a.mp4')] },
      { id: 'tl-b', name: 'Tap 2', ratio: '16:9', filterKey: 'warm', clips: [clip('c1', 'b.mp4')], overlays: [{ id: 'o1', text: 'x', start: 0, end: 1 }] }
    ] }, makeId)
  assert.deepEqual(project.timelines.map((timeline) => timeline.name), ['Tap 1', 'Tap 2'])
  assert.equal(activeTimeline(project).id, 'tl-b')
  assert.equal(project.timelines[0].ratio, '9:16')
  assert.equal(project.timelines[1].ratio, '16:9')
  assert.equal(project.timelines[1].filterKey, 'warm')
  assert.equal(project.timelines[0].filterKey, 'none')
  assert.equal(project.timelines[0].overlays.length, 0)
  assert.equal(project.timelines[1].overlays.length, 1)
  // cung id clip o hai timeline khac nhau la hop le
  assert.equal(project.timelines[0].clips[0].path, 'a.mp4')
  assert.equal(project.timelines[1].clips[0].path, 'b.mp4')
  // assets: [] khai bao ro rang thi giu nguyen, khong tu suy ra
  assert.deepEqual(project.assets.map((asset) => asset.path).sort(), [])
})

test('thu vien suy ra tu moi timeline khi file khong co assets', () => {
  const project = normalizeProject({ version: 6, timelines: [
    { id: 'x', clips: [clip('c1', 'a.mp4')] },
    { id: 'y', clips: [clip('c2', 'b.mp4'), clip('c3', 'a.mp4')], audioItems: [{ id: 'au', path: 'm.mp3', track: 'music', out: 5 }] }
  ] }, makeId)
  assert.deepEqual(project.assets.map((asset) => asset.path).sort(), ['a.mp4', 'b.mp4', 'm.mp3'])
})

test('tab dang mo khong ton tai -> tab dau; tab trung id, qua nhieu tab, timeline hong bi tu choi', () => {
  const one = normalizeProject({ version: 6, activeTimelineId: 'gone', timelines: [{ id: 'a' }, { id: 'b' }] }, makeId)
  assert.equal(one.activeTimelineId, 'a')
  assert.throws(() => normalizeProject({ version: 6, timelines: [{ id: 'a' }, { id: 'a' }] }, makeId), /trùng ID: a/)
  assert.throws(() => normalizeProject({ version: 6, timelines: Array.from({ length: MAX_TIMELINES + 1 }, (_, i) => ({ id: `t${i}` })) }, makeId), /tối đa/)
  assert.throws(() => normalizeProject({ version: 6, timelines: [null] }, makeId), /timelines\[0\]/)
  assert.throws(() => normalizeProject({ version: 6, timelines: [{ id: 'a', ratio: '5:4' }] }, makeId), /ratio/)
  assert.throws(() => normalizeProject({ version: 6, timelines: [{ id: 'a', clips: [{ path: '', in: 0, out: 1 }] }] }, makeId), /clips\[0\]\.path/)
})

test('ten timeline duoc don dep va co ten mac dinh', () => {
  const project = normalizeProject({ version: 6, timelines: [{ id: 'a', name: '  Tập   1  ' }, { id: 'b', name: '   ' }, { id: 'c' }, { id: 'd', name: 'x'.repeat(200) }] }, makeId)
  assert.deepEqual(project.timelines.slice(0, 3).map((timeline) => timeline.name), ['Tập 1', 'Timeline 2', 'Timeline 3'])
  assert.equal(project.timelines[3].name.length, 60)
  assert.equal(cleanTimelineName(undefined, 'Z'), 'Z')
})

test('khong ro ri khoa API cua file, ke ca khi nam trong du an v6', () => {
  const project = normalizeProject({ version: 6, apiKey: 'x', googleTtsKey: 'y', timelines: [{ id: 'a' }] }, makeId)
  assert.ok(!('apiKey' in project) && !('googleTtsKey' in project))
})

test('nextTimelineName tim so nho nhat chua dung; copyTimelineName them (2), (3)', () => {
  const list = (...names) => names.map((name) => ({ name }))
  assert.equal(nextTimelineName(list()), 'Timeline 1')
  assert.equal(nextTimelineName(list('Timeline 1')), 'Timeline 2')
  assert.equal(nextTimelineName(list('Timeline 1', 'Timeline 3')), 'Timeline 2')
  assert.equal(nextTimelineName(list('Timeline 2')), 'Timeline 1')
  assert.equal(copyTimelineName(list('Tap 1'), 'Tap 1'), 'Tap 1 (2)')
  assert.equal(copyTimelineName(list('Tap 1', 'Tap 1 (2)'), 'Tap 1'), 'Tap 1 (3)')
  assert.equal(copyTimelineName(list('Tap 1', 'Tap 1 (2)'), 'Tap 1 (2)'), 'Tap 1 (3)')
})

test('activeAfterRemove: giu tab dang mo, xoa tab dang mo thi sang tab ben trai', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(activeAfterRemove(tabs, 'b', 'a'), 'a')
  assert.equal(activeAfterRemove(tabs, 'b', 'b'), 'a')
  assert.equal(activeAfterRemove(tabs, 'a', 'a'), 'b')
  assert.equal(activeAfterRemove(tabs, 'c', 'c'), 'b')
  assert.equal(activeAfterRemove([{ id: 'a' }], 'a', 'a'), null)
})

test('moveTimeline doi cho tab, chan chi so ngoai bien va khong doi mang goc', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(moveTimeline(tabs, 'a', 2).map((tab) => tab.id), ['b', 'c', 'a'])
  assert.deepEqual(moveTimeline(tabs, 'c', 0).map((tab) => tab.id), ['c', 'a', 'b'])
  assert.deepEqual(moveTimeline(tabs, 'b', 99).map((tab) => tab.id), ['a', 'c', 'b'])
  assert.equal(moveTimeline(tabs, 'b', 1), tabs)
  assert.equal(moveTimeline(tabs, 'zz', 0), tabs)
  assert.deepEqual(tabs.map((tab) => tab.id), ['a', 'b', 'c'])
})

test('pickTimelineFields chi lay truong cua timeline', () => {
  const picked = pickTimelineFields({ ratio: '1:1', clips: [], assets: [1], projectId: 'p', version: 5, nonsense: 1 })
  assert.deepEqual(Object.keys(picked).sort(), ['clips', 'ratio'])
})

test('kieu chuyen canh va sticker V2 la cua rieng tung timeline', () => {
  const project = normalizeProject({ version: 6, projectId: 'st', assets: [], timelines: [
    { id: 'a', transition: 'cross', transitionStyle: 'wipeleft', videoOverlays: [{ id: 's1', sticker: 'twemoji/1f600', name: 'x', start: 1, out: 3 }] },
    { id: 'b', transition: 'cross', transitionStyle: 'nonsense' }
  ] }, makeId)
  assert.equal(project.timelines[0].transitionStyle, 'wipeleft')
  assert.equal(project.timelines[1].transitionStyle, 'fade', 'kieu la thi ve mac dinh')
  const [sticker] = project.timelines[0].videoOverlays
  assert.equal(sticker.sticker, 'twemoji/1f600')
  assert.equal(sticker.path, '')
  assert.equal(sticker.kind, 'image')
  assert.ok(sticker.trackId, 'sticker duoc xep vao mot track V')
  assert.equal(project.timelines[1].videoOverlays.length, 0)
  assert.equal(project.assets.length, 0, 'sticker khong vao thu vien media')
  assert.throws(() => normalizeProject({ version: 6, timelines: [{ id: 'a', videoOverlays: [{ sticker: '../../etc/passwd', out: 1 }] }] }, makeId), /sticker/)
})

test('emoji chu cu (du an v5) doi thanh sticker V2 trong timeline duy nhat', () => {
  const project = normalizeProject({ version: 5, clips: [clip('c1', 'a.mp4')],
    overlays: [{ id: 'e1', type: 'emoji', text: '😀', start: 0.5, end: 2.5, x: 0.3, y: 0.4, size: 0.2 }, { id: 't1', type: 'text', text: 'hi', start: 0, end: 1 }] }, makeId)
  const [timeline] = project.timelines
  assert.deepEqual(timeline.overlays.map((item) => item.id), ['t1'])
  assert.equal(timeline.videoOverlays.length, 1)
  assert.equal(timeline.videoOverlays[0].id, 'e1')
  assert.match(timeline.videoOverlays[0].sticker, /^twemoji\//)
  assert.equal(timeline.videoOverlays[0].start, 0.5)
})

test('moc: chuan hoa (sap theo thoi gian, bo muc hong, ten gon), mac dinh rong, vong luu / doc on dinh', () => {
  const project = normalizeProject({ version: 6, assets: [], timelines: [
    { id: 'a', markers: [{ id: 'm2', time: 5, name: '  Canh   hai ' }, { id: 'm1', time: 1.5 }, { time: -1, name: 'am' }, { time: 'x' }, null, { id: 'm2', time: 9, name: 'trung id' }, { time: 3, name: 'x'.repeat(200) }] },
    { id: 'b' }
  ] }, makeId)
  const markers = project.timelines[0].markers
  assert.deepEqual(markers.map((m) => m.time), [1.5, 3, 5, 9], 'sap theo thoi gian, bo thoi diem am / khong phai so')
  assert.equal(markers.find((m) => m.time === 5).name, 'Canh hai')
  assert.equal(markers.find((m) => m.time === 3).name.length, 60)
  assert.equal(markers.find((m) => m.time === 1.5).name, '')
  assert.equal(new Set(markers.map((m) => m.id)).size, 4, 'id duy nhat (id trung duoc cap lai)')
  assert.deepEqual(project.timelines[1].markers, [])
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(project)), makeId), project)
  assert.ok(TIMELINE_KEYS.includes('markers'))
})

test('lop hinh: xoay / lat / mo vao ra co mac dinh, gioi han hop le, giu qua vong luu doc', () => {
  const overlay = { id: 'o', path: 'a.png', kind: 'image', start: 0, out: 3 }
  const base = normalizeProject({ version: 6, assets: [], timelines: [{ id: 't', videoOverlays: [overlay] }] }, makeId).timelines[0].videoOverlays[0]
  assert.deepEqual([base.rotation, base.flipH, base.flipV, base.fadeIn, base.fadeOut], [0, false, false, 0, 0])
  const set = normalizeProject({ version: 6, assets: [], timelines: [{ id: 't', videoOverlays: [{ ...overlay, rotation: -90, flipH: 1, fadeIn: 0.5, fadeOut: 1.5 }] }] }, makeId)
  const item = set.timelines[0].videoOverlays[0]
  assert.deepEqual([item.rotation, item.flipH, item.flipV, item.fadeIn, item.fadeOut], [-90, true, false, 0.5, 1.5])
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(set)), makeId), set)
  for (const bad of [{ rotation: 361 }, { rotation: 'x' }, { fadeIn: -1 }, { fadeOut: 61 }]) {
    assert.throws(() => normalizeProject({ version: 6, assets: [], timelines: [{ id: 't', videoOverlays: [{ ...overlay, ...bad }] }] }, makeId), /videoOverlays\[0\]/, JSON.stringify(bad))
  }
})

test('am luong clip V1 va can bang item tieng: mac dinh, gioi han, giu qua vong luu doc', () => {
  const make = (clipExtra, audioExtra) => normalizeProject({ version: 6, assets: [], timelines: [{ id: 't',
    clips: [{ id: 'c', path: 'a.mp4', in: 0, out: 3, ...clipExtra }, { id: 'i', path: 'p.png', kind: 'image', in: 0, out: 2, volume: 0.3 }],
    audioItems: [{ id: 'a', path: 'm.mp3', track: 'music', out: 2, ...audioExtra }] }] }, makeId).timelines[0]
  const base = make({}, {})
  assert.equal(base.clips[0].volume, 1)
  assert.equal(base.clips[1].volume, 1, 'anh khong co tieng: am luong luon 1')
  assert.equal(base.audioItems[0].pan, 0)
  const set = make({ volume: 0.5 }, { pan: -0.4 })
  assert.equal(set.clips[0].volume, 0.5)
  assert.equal(set.audioItems[0].pan, -0.4)
  assert.equal(make({ volume: 2 }, { pan: 1 }).clips[0].volume, 2)
  for (const clipExtra of [{ volume: 2.1 }, { volume: -0.1 }, { volume: 'x' }]) assert.throws(() => make(clipExtra, {}), /clips\[0\]\.volume/)
  for (const audioExtra of [{ pan: 1.1 }, { pan: -2 }, { pan: 'x' }]) assert.throws(() => make({}, audioExtra), /audioItems\[0\]\.pan/)
  const round = normalizeProject(JSON.parse(JSON.stringify({ version: 6, assets: [], timelines: [set] })), makeId)
  assert.equal(round.timelines[0].clips[0].volume, 0.5)
})

test('tieng cua video phu: file cu tat tieng (giu nguyen ban xuat cu), item moi tu chon, anh / sticker luon tat', () => {
  const make = (extra) => normalizeProject({ version: 6, assets: [], timelines: [{ id: 't', videoOverlays: [{ id: 'o', path: 'a.mp4', kind: 'video', start: 0, out: 3, ...extra }] }] }, makeId).timelines[0].videoOverlays[0]
  assert.deepEqual([make({}).audioMuted, make({}).volume], [true, 1], 'thieu truong -> tat tieng (file cu)')
  assert.equal(make({ audioMuted: false }).audioMuted, false)
  assert.equal(make({ audioMuted: false, volume: 1.5 }).volume, 1.5)
  const image = normalizeProject({ version: 6, assets: [], timelines: [{ id: 't', videoOverlays: [{ id: 'i', path: 'a.png', kind: 'image', out: 3, audioMuted: false }, { id: 's', sticker: 'twemoji/1f600', out: 3, audioMuted: false }] }] }, makeId).timelines[0].videoOverlays
  assert.deepEqual(image.map((item) => item.audioMuted), [true, true], 'anh / sticker khong co tieng')
  for (const bad of [{ volume: 2.5 }, { volume: -1 }, { volume: 'x' }]) assert.throws(() => make(bad), /videoOverlays\[0\]\.volume/)
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify({ version: 6, assets: [], timelines: [{ id: 't', videoOverlays: [make({ audioMuted: false, volume: 0.5 })] }] })), makeId).timelines[0].videoOverlays[0].volume, 0.5)
})

test('referencedPaths + libraryAfterRestore: undo trong tab nay khong lam mat media tab khac dang dung', () => {
  const other = { clips: [{ path: 'C:\\m\\Shared.mp4' }], videoOverlays: [{ path: 'o.png' }], audioItems: [{ path: 'a.wav' }] }
  assert.deepEqual([...referencedPaths(other)].sort(), ['c:/m/shared.mp4', 'a.wav', 'o.png'].sort())
  const restored = [{ id: 'old', path: 'old.mp4' }]
  const current = [{ id: 'old', path: 'old.mp4' }, { id: 'new', path: 'c:/m/shared.mp4' }, { id: 'tmp', path: 'only-here.mp4' }]
  const merged = libraryAfterRestore(restored, current, [other])
  assert.deepEqual(merged.map((asset) => asset.id), ['old', 'new'])
  // khong co tab khac: hoan tac nhap khau xoa luon media do (hanh vi cu)
  assert.deepEqual(libraryAfterRestore(restored, current, []).map((asset) => asset.id), ['old'])
  assert.equal(libraryAfterRestore(undefined, [], []).length, 0)
})

test('approxTimelineDuration lay doan dai nhat giua V1, video phu va audio', () => {
  assert.equal(approxTimelineDuration({}), 0)
  assert.equal(approxTimelineDuration({ clips: [{ in: 0, out: 4, speed: 2 }, { kind: 'image', in: 0, out: 3 }] }), 5)
  assert.equal(approxTimelineDuration({ clips: [{ in: 0, out: 2, speed: 1 }], audioItems: [{ start: 10, in: 0, out: 5, speed: 1 }] }), 15)
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-timelines-'))
test('luu file: duong dan media cua MOI timeline thanh tuong doi roi doc lai', () => {
  try {
    const a = path.join(dir, 'media', 'a.mp4'), b = path.join(dir, 'media', 'b.mp4'), m = path.join(dir, 'media', 'm.mp3')
    const project = normalizeProject({ version: 6, projectId: 'store', timelines: [
      { id: 't1', name: 'T1', clips: [clip('c1', a)] },
      { id: 't2', name: 'T2', clips: [clip('c1', b)], audioItems: [{ id: 'au', path: m, track: 'music', out: 5 }] }
    ] }, makeId)
    const file = path.join(dir, 'p.taoclip')
    projectStore.writeProject(file, project)
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(onDisk.timelines[0].clips[0].path, 'media/a.mp4')
    assert.equal(onDisk.timelines[1].clips[0].path, 'media/b.mp4')
    assert.equal(onDisk.timelines[1].audioItems[0].path, 'media/m.mp3')
    assert.equal(onDisk.assets.length, 3)
    for (const asset of onDisk.assets) assert.ok(!path.isAbsolute(asset.path))
    const resolved = portableProject.resolveProjectPaths(projectStore.readProject(file), dir)
    assert.equal(resolved.timelines[1].clips[0].path, path.resolve(dir, 'media', 'b.mp4'))
    assert.equal(normalizeProject(resolved, makeId).timelines.length, 2)
  } finally { /* don o cuoi */ }
})

test('thu thap du an: copy media cua tat ca timeline, dung chung mot ban sao khi trung file', () => {
  const src = path.join(dir, 'src'); fs.mkdirSync(src, { recursive: true })
  const a = path.join(src, 'a.mp4'), b = path.join(src, 'b.mp4')
  fs.writeFileSync(a, 'AAAA'); fs.writeFileSync(b, 'BBBBBB')
  const project = normalizeProject({ version: 6, projectId: 'collect', timelines: [
    { id: 't1', clips: [clip('c1', a)] },
    { id: 't2', clips: [clip('c9', b), clip('c8', a)] }
  ] }, makeId)
  const result = portableProject.collectProject(project, path.join(dir, 'out', 'collected.taoclip'))
  const t1 = result.project.timelines[0].clips[0].path, t2 = result.project.timelines[1].clips
  assert.ok(fs.existsSync(t1) && fs.existsSync(t2[0].path))
  assert.equal(fs.readFileSync(t1, 'utf8'), 'AAAA')
  assert.equal(fs.readFileSync(t2[0].path, 'utf8'), 'BBBBBB')
  assert.equal(t2[1].path, t1, 'cung mot file nguon chi copy mot lan')
  assert.equal(fs.readdirSync(result.assetDirectory).length, 2)
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n================  ${n} PASS  ================`)
