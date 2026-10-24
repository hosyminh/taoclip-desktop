// Kiem thu thuan cho model track (timeline hai vung) va schema v5:  node test-tracks.mjs
import assert from 'node:assert/strict'
import {
  normalizeTracks, defaultTracks, makeTrack, MIN_LANES, isCoreTrack, videoTracksOf, audioTracksOf, nextTrackNumber, layerIndex, withLayerZIndex,
  audibleTrackIds, visibleVideoTrackIds, itemSpan, spansOverlap, occupiedSpans, choosePlacement, assignDefaultTracks,
  clipAudioSpans, buildDetachedAudioItem, insertIndexForTime, parseTrackId, peakOverlap, MANY_LAYERS, fadeFactor
} from './src/renderer/track-model.js'
import { normalizeProject as normalizeProjectFull, activeTimeline } from './src/renderer/project-model.js'
// Cac kiem tra cu doc noi dung o muc du an: tran noi dung timeline dang mo len de giu nguyen cach viet.
const normalizeProject = (data, makeId) => { const full = normalizeProjectFull(data, makeId); return { ...full, ...activeTimeline(full) } }

let n = 0
const test = (name, fn) => { fn(); n++; console.log('  PASS ' + name) }
const ids = (tracks) => tracks.map((track) => track.id)
const item = (id, trackId, start, length, extra = {}) => ({ id, trackId, start, in: 0, out: length, speed: 1, ...extra })
let counter = 0
const makeId = (kind) => `${kind}_${++counter}`

test('parseTrackId nhan dung V/A va tu choi ten la', () => {
  assert.deepEqual(parseTrackId('V2'), { kind: 'video', number: 2 })
  assert.deepEqual(parseTrackId('A10'), { kind: 'audio', number: 10 })
  for (const bad of ['V0', 'X1', 'v1', '', null, 'V', 'A1.5']) assert.equal(parseTrackId(bad), null, String(bad))
})

const CORE = ['V1', 'V2', 'V3', 'A1', 'A2', 'A3']

test('mac dinh co san V1..V3 va A1..A3 (2 duong hinh phu + 2 duong tieng phu de tha long nhau); track tu so 4 moi la track them', () => {
  assert.equal(MIN_LANES, 3)
  assert.deepEqual(ids(defaultTracks()), CORE)
  assert.deepEqual(ids(normalizeTracks([])), CORE)
  assert.deepEqual(ids(normalizeTracks(defaultTracks())), CORE, 'chuan hoa lap lai khong doi')
  assert.deepEqual(['V1', 'A3', 'V3'].map(isCoreTrack), [true, true, true])
  assert.deepEqual(['V4', 'A6', 'junk', null].map(isCoreTrack), [false, false, false, false])
})

test('normalizeTracks bo rac, khong trung, sap xep video truoc audio, giu track them tu so 4', () => {
  const messy = normalizeTracks([{ id: 'A3', muted: 1 }, { id: 'junk' }, { id: 'V2', name: '  Phu  ' }, { id: 'A3', muted: false }, null], ['V6', 'A2', 'nope'])
  assert.deepEqual(ids(messy), ['V1', 'V2', 'V3', 'V6', 'A1', 'A2', 'A3'])
  assert.equal(messy.find((track) => track.id === 'A3').muted, true, 'ban dau tien thang khi trung id')
  assert.equal(messy.find((track) => track.id === 'V2').name, 'Phu')
  assert.equal(nextTrackNumber(messy, 'video'), 7)
  assert.equal(nextTrackNumber(messy, 'audio'), 4)
  assert.deepEqual(ids(videoTracksOf(messy)), ['V1', 'V2', 'V3', 'V6'])
  assert.deepEqual(ids(audioTracksOf(messy)), ['A1', 'A2', 'A3'])
  // du an cu da luu V4 / A4 thi giu nguyen (khong phai track co san nua, nen xoa duoc khi trong)
  const legacy = normalizeTracks([{ id: 'V4' }, { id: 'A4', name: 'Nhac 2' }])
  assert.deepEqual(ids(legacy), ['V1', 'V2', 'V3', 'V4', 'A1', 'A2', 'A3', 'A4'])
  assert.deepEqual(['V4', 'A4'].map(isCoreTrack), [false, false])
})

test('layerIndex / withLayerZIndex: track cao hon nam lop tren', () => {
  const tracks = normalizeTracks([], ['V2', 'V3'])
  assert.equal(layerIndex(tracks, 'V1'), 0)
  assert.equal(layerIndex(tracks, 'V3'), 2)
  assert.deepEqual(withLayerZIndex([item('a', 'V3', 0, 1), item('b', 'V2', 0, 1)], tracks).map((x) => x.zIndex), [2, 1])
})

test('itemSpan tinh theo toc do va loop keo toi het timeline', () => {
  assert.deepEqual(itemSpan({ start: 2, in: 1, out: 5, speed: 2 }), { start: 2, end: 4 })
  assert.deepEqual(itemSpan({ start: 1, in: 0, out: 2, loop: true }, { totalDuration: 10 }), { start: 1, end: 10 })
  assert.deepEqual(itemSpan({ start: 1, in: 0, out: 20, loop: true }, { totalDuration: 10 }), { start: 1, end: 21 })
  assert.equal(spansOverlap({ start: 0, end: 2 }, { start: 2, end: 3 }), false, 'sat nhau khong tinh la chong')
  assert.equal(spansOverlap({ start: 0, end: 2.1 }, { start: 2, end: 3 }), true)
})

test('choosePlacement video: track phu dau tien la V2, va cham -> V3, sat nhau van cung track; track san co khong tao moi', () => {
  const tracks = normalizeTracks([])
  let items = []
  let place = choosePlacement({ tracks, items, kind: 'video', preferred: null, span: { start: 0, end: 3 } })
  assert.equal(place.trackId, 'V2'); assert.equal(place.created, null, 'V2 da co san')
  items = [item('a', 'V2', 0, 3)]
  place = choosePlacement({ tracks, items, kind: 'video', preferred: 'V2', span: { start: 3, end: 5 } })
  assert.equal(place.trackId, 'V2'); assert.equal(place.created, null)
  place = choosePlacement({ tracks, items, kind: 'video', preferred: 'V2', span: { start: 1, end: 2 } })
  assert.equal(place.trackId, 'V3'); assert.equal(place.created, null, 'V3 da co san')
  place = choosePlacement({ tracks, items, kind: 'video', preferred: 'V1', span: { start: 0, end: 1 } })
  assert.equal(place.trackId, 'V3', 'V1 la track chinh, khong dat item phu len do')
  place = choosePlacement({ tracks, items, kind: 'video', preferred: 'V2', span: { start: 5, end: 6 }, forceNew: true })
  assert.equal(place.trackId, 'V4'); assert.equal(place.created.id, 'V4', 'forceNew tao track sau V3')
  // V2, V3 deu kin: tao V4
  items = [item('a', 'V2', 0, 9), item('b', 'V3', 0, 9)]
  place = choosePlacement({ tracks, items, kind: 'video', preferred: 'V2', span: { start: 1, end: 2 } })
  assert.equal(place.trackId, 'V4'); assert.equal(place.created.id, 'V4')
})

test('choosePlacement bo qua track khoa va doi duoc theo track da co', () => {
  const tracks = normalizeTracks([{ id: 'V2', locked: true }, { id: 'V3' }])
  const place = choosePlacement({ tracks, items: [], kind: 'video', preferred: 'V2', span: { start: 0, end: 1 } })
  assert.equal(place.trackId, 'V3')
  assert.equal(place.created, null)
})

test('choosePlacement audio: tieng goc cua V1 tren A1 la khoang bi chiem', () => {
  const tracks = normalizeTracks([], ['A2'])
  const extra = { A1: [{ start: 0, end: 5 }] }
  assert.equal(choosePlacement({ tracks, items: [], kind: 'audio', preferred: 'A1', span: { start: 2, end: 3 }, extraByTrack: extra }).trackId, 'A2')
  assert.equal(choosePlacement({ tracks, items: [], kind: 'audio', preferred: 'A1', span: { start: 5, end: 6 }, extraByTrack: extra }).trackId, 'A1')
  const next = choosePlacement({ tracks, items: [item('x', 'A2', 0, 9)], kind: 'audio', preferred: 'A1', span: { start: 1, end: 2 }, extraByTrack: extra })
  assert.equal(next.trackId, 'A3'); assert.equal(next.created, null, 'A3 da co san')
  const full = choosePlacement({ tracks, items: [item('x', 'A2', 0, 9), item('y', 'A3', 0, 9)], kind: 'audio', preferred: 'A1', span: { start: 1, end: 2 }, extraByTrack: extra })
  assert.equal(full.trackId, 'A4'); assert.equal(full.created.id, 'A4')
})

test('choosePlacement tao dung track duoc yeu cau khi chua ton tai', () => {
  const place = choosePlacement({ tracks: normalizeTracks([]), items: [], kind: 'audio', preferred: 'A6', span: { start: 0, end: 1 } })
  assert.deepEqual([place.trackId, place.created?.id], ['A6', 'A6'])
  const existing = choosePlacement({ tracks: normalizeTracks([]), items: [], kind: 'audio', preferred: 'A2', span: { start: 0, end: 1 } })
  assert.deepEqual([existing.trackId, existing.created], ['A2', null])
})

test('occupiedSpans bo qua item dang duoc keo (excludeId)', () => {
  const items = [item('a', 'A2', 0, 2), item('b', 'A2', 3, 2), item('c', 'A3', 0, 9)]
  assert.equal(occupiedSpans(items, 'A2').length, 2)
  assert.equal(occupiedSpans(items, 'A2', { excludeId: 'a' }).length, 1)
})

test('assignDefaultTracks xep item cu theo thoi gian, chong nhau thi sang track ke tiep', () => {
  const result = assignDefaultTracks({
    tracks: normalizeTracks([]),
    videoItems: [item('p', undefined, 0, 4, { zIndex: 1 }), item('q', undefined, 2, 4, { zIndex: 0 }), item('r', undefined, 10, 2, { zIndex: 2 })],
    audioItems: [item('m', undefined, 0, 6, { track: 'music' }), item('v', undefined, 1, 2, { track: 'voice' }), item('o', undefined, 0, 3, { track: 'original' })]
  })
  const by = (list) => Object.fromEntries(list.map((x) => [x.id, x.trackId]))
  assert.deepEqual(by(result.videoItems), { p: 'V3', q: 'V2', r: 'V2' }, 'sap theo zIndex roi thoi gian; q (zIndex 0) len V2 truoc')
  assert.deepEqual(by(result.audioItems), { m: 'A2', v: 'A3', o: 'A1' })
  assert.deepEqual(ids(result.tracks), CORE, 'item cu xep vao track co san, khong sinh track thua')
  const again = assignDefaultTracks({ tracks: result.tracks, videoItems: result.videoItems, audioItems: result.audioItems })
  assert.deepEqual(again.videoItems, result.videoItems, 'chay lai khong doi gi (idempotent)')
  assert.deepEqual(again.audioItems, result.audioItems)
})

test('audibleTrackIds / visibleVideoTrackIds theo mute, solo, hidden', () => {
  let tracks = normalizeTracks([{ id: 'A2', muted: true }, { id: 'V2', hidden: true }])
  assert.deepEqual([...audibleTrackIds(tracks)].sort(), ['A1', 'A3'])
  assert.deepEqual([...visibleVideoTrackIds(tracks)], ['V1', 'V3'])
  tracks = normalizeTracks([{ id: 'A1' }, { id: 'A2', solo: true }, { id: 'A3', muted: true, solo: true }])
  assert.deepEqual([...audibleTrackIds(tracks)], ['A2'], 'co solo -> chi nghe track solo chua tat tieng')
})

test('peakOverlap: so item chong nhau nhieu nhat; sat nhau khong tinh; rong / rong 0 thi bo qua', () => {
  assert.equal(peakOverlap([]), 0)
  assert.equal(peakOverlap([item('a', 'V2', 0, 3)]), 1)
  assert.equal(peakOverlap([item('a', 'V2', 0, 3), item('b', 'V3', 3, 2)]), 1, 'sat nhau')
  assert.equal(peakOverlap([item('a', 'V2', 0, 3), item('b', 'V3', 1, 3), item('c', 'V4', 2, 3), item('d', 'V5', 10, 1)]), 3)
  assert.equal(peakOverlap([item('a', 'V2', 0, 0), item('b', 'V3', 1, 0)]), 0)
  assert.equal(peakOverlap([item('a', 'V2', 1, 2, { loop: true }), item('b', 'V3', 2, 1)], { totalDuration: 10 }), 2, 'loop keo toi het timeline')
  assert.equal(MANY_LAYERS, 6)
})

test('fadeFactor: mo vao tang dan, mo ra giam dan, giua item = 1, khong dung thi = 1', () => {
  const it = { start: 2, in: 0, out: 4, speed: 1, fadeIn: 1, fadeOut: 2 }
  const at = (time) => Number(fadeFactor(it, time).toFixed(3))
  assert.deepEqual([2, 2.5, 3, 3.5, 4, 5, 6].map(at), [0, 0.5, 1, 1, 1, 0.5, 0])
  assert.equal(fadeFactor({ start: 0, in: 0, out: 2 }, 1), 1, 'khong fade')
  assert.equal(fadeFactor({ start: 0, in: 0, out: 2, speed: 2, fadeOut: 0.5 }, 0.75), 0.5, 'theo do dai sau toc do (1s)')
  assert.equal(fadeFactor({ start: 0, in: 0, out: 1, fadeIn: 1, fadeOut: 1 }, 0.5), 0.5, 'hai fade chong nhau lay gia tri nho hon')
  assert.equal(fadeFactor(it, 99), 0, 'sau khi het item')
})

test('clipAudioSpans chi lay clip co tieng va chua tach; buildDetachedAudioItem giu in/out/toc do/vi tri', () => {
  const layout = [
    { clipId: 'a', start: 0, end: 5, clip: { src: { hasAudio: true } } },
    { clipId: 'b', start: 5, end: 8, clip: { src: { hasAudio: false } } },
    { clipId: 'c', start: 8, end: 10, clip: { src: { hasAudio: true }, audioDetached: true } },
    { clipId: 'd', start: 10, end: 12, clip: { src: { hasAudio: true }, missing: true } }
  ]
  assert.deepEqual(clipAudioSpans(layout), [{ start: 0, end: 5, clipId: 'a' }])
  const detached = buildDetachedAudioItem({ id: 'a', name: 'a.mp4', path: 'C:/a.mp4', in: 1, out: 5, speed: 2, src: { duration: 9 } }, layout[0], 'audio_x')
  assert.deepEqual([detached.trackId, detached.track, detached.start, detached.in, detached.out, detached.speed, detached.sourceDuration, detached.sourceClipId],
    ['A1', 'original', 0, 1, 5, 2, 9, 'a'])
})

test('insertIndexForTime: chen V1 theo diem giua clip', () => {
  const layout = [{ start: 0, end: 4 }, { start: 4, end: 10 }]
  assert.deepEqual([0, 1.9, 2.1, 4, 6.9, 7.1, 20].map((time) => insertIndexForTime(layout, time)), [0, 0, 1, 1, 1, 2, 2])
})

test('schema v5: slot nhac/giong cua v4 thanh audio item, khong nhan doi voi legacy-*', () => {
  const fromSlots = normalizeProject({ version: 4, clips: [], music: { path: 'm.mp3', name: 'm' }, voice: { path: 'v.wav', name: 'v' },
    bgDur: 30, voiceDur: 4, voiceOffset: 2, musicVol: 0.3, voiceVol: 0.9, bgLoop: true }, makeId)
  assert.equal(fromSlots.version, 6)
  assert.equal(fromSlots.music, undefined); assert.equal(fromSlots.voice, undefined); assert.equal(fromSlots.bgDur, undefined)
  assert.deepEqual(fromSlots.audioItems.map(({ id, track, start, out, gain, loop, trackId }) => [id, track, start, out, gain, !!loop, trackId]),
    [['legacy-music', 'music', 0, 30, 0.3, true, 'A2'], ['legacy-voice', 'voice', 2, 4, 0.9, false, 'A2']].map((row, index) => index === 1 ? [...row.slice(0, 6), 'A3'] : row),
    'giong chong len nhac trong 0..30s nen sang A3')
  const twice = normalizeProject({ version: 4, clips: [], music: { path: 'm.mp3', name: 'm' }, bgDur: 30,
    audioItems: [{ id: 'legacy-music', path: 'm.mp3', name: 'm', track: 'music', start: 0, in: 0, out: 30, gain: 0.4, loop: true }] }, makeId)
  assert.equal(twice.audioItems.length, 1)
})

test('schema v5: tracks, trackId, zIndex va round-trip on dinh', () => {
  const project = normalizeProject({ version: 4, clips: [{ id: 'c', path: 'a.mp4', in: 0, out: 6 }],
    videoOverlays: [{ id: 'o1', path: 'x.png', kind: 'image', start: 0, out: 4 }, { id: 'o2', path: 'y.png', kind: 'image', start: 2, out: 5 }],
    audioItems: [{ id: 'a1', path: 'm.mp3', track: 'music', start: 0, out: 3 }] }, makeId)
  assert.deepEqual(ids(project.tracks), CORE)
  assert.deepEqual(project.videoOverlays.map((x) => [x.id, x.trackId, x.zIndex]), [['o1', 'V2', 1], ['o2', 'V3', 2]])
  const round = normalizeProject(JSON.parse(JSON.stringify(project)), makeId)
  assert.deepEqual(round.tracks, project.tracks)
  assert.deepEqual(round.videoOverlays, project.videoOverlays)
  assert.deepEqual(round.audioItems, project.audioItems)
  assert.equal(round.audioItems[0].speed, 1)
})

test('schema v5: giu trackId hop le, sua trackId sai, nhan role original va audioDetached', () => {
  const project = normalizeProject({ version: 5, tracks: [{ id: 'A2', muted: true, name: 'Nhac' }], clips: [
    { id: 'c', path: 'a.mp4', in: 0, out: 6, audioDetached: true }, { id: 'i', path: 'p.png', kind: 'image', audioDetached: true }],
  videoOverlays: [{ id: 'bad', path: 'x.png', kind: 'image', start: 0, out: 2, trackId: 'V1' }, { id: 'ok', path: 'y.png', kind: 'image', start: 0, out: 2, trackId: 'V5' }],
  audioItems: [{ id: 'k', path: 'a.mp4', track: 'original', start: 0, in: 0, out: 6, speed: 2, sourceClipId: 'c', trackId: 'A1' },
    { id: 'm', path: 'm.mp3', track: 'music', start: 0, out: 3, trackId: 'A2' }] }, makeId)
  assert.deepEqual(project.videoOverlays.map((x) => [x.id, x.trackId]), [['bad', 'V2'], ['ok', 'V5']], 'item phu khong duoc o V1')
  assert.deepEqual(project.audioItems.map((x) => [x.id, x.trackId, x.speed]), [['k', 'A1', 2], ['m', 'A2', 1]])
  assert.equal(project.clips[0].audioDetached, true)
  assert.equal(project.clips[1].audioDetached, false, 'anh khong co tieng de tach')
  assert.equal(project.tracks.find((track) => track.id === 'A2').muted, true)
  assert.equal(project.tracks.find((track) => track.id === 'A2').name, 'Nhac')
})

test('schema v5: van tu choi file moi hon va audio sai vai tro', () => {
  assert.throws(() => normalizeProject({ version: 7, clips: [] }), /mới hơn/)
  assert.throws(() => normalizeProject({ version: 5, clips: [], audioItems: [{ path: 'a.wav', track: 'fx', out: 1 }] }, makeId), /audioItems\[0\]\.track/)
})

console.log(`\n================  ${n} PASS  ================`)
