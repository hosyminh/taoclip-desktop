// Kiem thu thuan cho cac lenh tren clip / item cua timeline:  node test-commands.mjs
import assert from 'node:assert/strict'
import { splitTimelineItem, splitClipSource, insertFreezeFrame, duplicateClipAfter, mergeClipCaptions, splitAnchoredCaptions, MIN_PIECE, rippleTime, rippleItems, rippleOverlays } from './src/renderer/timeline/clip-commands.js'
import { HEAD_W, PPS_MIN, PPS_MAX, ZOOM_STEP, clampPps, fitPps, tickStep, tickLabel, TICK_MIN_GAP, thumbTiles, waveStyle } from './src/renderer/timeline/geometry.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log('  PASS ' + name) }

test('splitTimelineItem: video phu toc do 2x tach dung diem nguon', () => {
  const item = { id: 'v', kind: 'video', start: 2, in: 1, out: 5, speed: 2 } // dai 2s tren timeline
  const [a, b] = splitTimelineItem(item, 3, 'v2')
  assert.deepEqual([a.id, a.start, a.in, a.out], ['v', 2, 1, 3])
  assert.deepEqual([b.id, b.start, b.in, b.out], ['v2', 3, 3, 5])
  assert.equal((a.out - a.in) / 2 + (b.out - b.in) / 2, 2, 'hai manh cong lai bang do dai cu')
})

test('splitTimelineItem: anh phu tach theo thoi luong', () => {
  const [a, b] = splitTimelineItem({ id: 'i', kind: 'image', start: 1, in: 0, out: 4, speed: 1 }, 2.5, 'i2')
  assert.deepEqual([a.start, a.in, a.out], [1, 0, 1.5])
  assert.deepEqual([b.start, b.in, b.out], [2.5, 0, 2.5])
})

test('splitTimelineItem: audio xoa fade o diem cat, item loop va mep qua gan khong tach', () => {
  const [a, b] = splitTimelineItem({ id: 'a', start: 0, in: 0, out: 6, speed: 1, fadeIn: 0.5, fadeOut: 1, gain: 0.7 }, 2, 'a2')
  assert.deepEqual([a.fadeIn, a.fadeOut, b.fadeIn, b.fadeOut], [0.5, 0, 0, 1])
  assert.equal(b.gain, 0.7)
  assert.equal(splitTimelineItem({ id: 'l', start: 0, in: 0, out: 3, loop: true }, 1, 'x'), null)
  assert.equal(splitTimelineItem({ id: 'e', start: 0, in: 0, out: 3 }, MIN_PIECE / 2, 'x'), null)
  assert.equal(splitTimelineItem({ id: 'e', start: 0, in: 0, out: 3 }, 3 - MIN_PIECE / 2, 'x'), null)
  assert.equal(splitTimelineItem({ id: 'e', start: 5, in: 0, out: 3 }, 1, 'x'), null, 'ngoai item')
})

test('splitClipSource / insertFreezeFrame: chen khung dung vao giua, giu thu tu va id', () => {
  const clips = [{ id: 'a', path: 'a.mp4', in: 0, out: 5, speed: 1 }, { id: 'b', path: 'b.mp4', in: 0, out: 4, speed: 1 }]
  const freeze = { id: 'freeze', kind: 'image', path: 'f.png', in: 0, out: 3 }
  const result = insertFreezeFrame(clips, 'a', 2, freeze, 'a-right')
  assert.deepEqual(result.clips.map((clip) => clip.id), ['a', 'freeze', 'a-right', 'b'])
  assert.deepEqual([result.clips[0].out, result.clips[2].in, result.clips[2].out], [2, 2, 5])
  assert.equal(insertFreezeFrame(clips, 'a', 0.01, freeze, 'x'), null, 'qua gan dau clip')
  assert.equal(insertFreezeFrame(clips, 'a', 4.99, freeze, 'x'), null, 'qua gan cuoi clip')
  assert.equal(insertFreezeFrame([{ id: 'i', kind: 'image', in: 0, out: 3 }], 'i', 1, freeze, 'x'), null, 'anh khong co khung de dung')
  assert.equal(insertFreezeFrame(clips, 'missing', 2, freeze, 'x'), null)
})

test('duplicateClipAfter: ban sao ngay sau ban goc, id moi, tieng di kem ban sao', () => {
  const clips = [{ id: 'a', in: 0, out: 3, audioDetached: true, speed: 2 }, { id: 'b', in: 0, out: 2 }]
  const result = duplicateClipAfter(clips, 'a', 'a-copy')
  assert.deepEqual(result.clips.map((clip) => clip.id), ['a', 'a-copy', 'b'])
  assert.deepEqual([result.copy.speed, result.copy.audioDetached, clips[0].audioDetached], [2, false, true], 'ban goc khong bi doi')
  assert.equal(duplicateClipAfter(clips, 'zzz', 'x'), null)
})

test('mergeClipCaptions: chi thay phu de cua clip duoc chon', () => {
  const existing = [{ id: '1', clipId: 'a', start: 1, text: 'cu a' }, { id: '2', clipId: 'b', start: 6, text: 'b' }, { id: '3', start: 0.5, text: 'tay' }]
  const fresh = [{ id: 'n1', clipId: 'a', start: 2, text: 'moi a1' }, { id: 'n2', clipId: 'a', start: 0.2, text: 'moi a0' }]
  assert.deepEqual(mergeClipCaptions(existing, fresh, 'a').map((caption) => caption.id), ['n2', '3', 'n1', '2'])
})

test('splitAnchoredCaptions: phu de bac qua diem cat duoc chia, phan sau thuoc clip moi', () => {
  const items = [{ id: 'c1', clipId: 'a', sourceStart: 0, sourceEnd: 1 }, { id: 'c2', clipId: 'a', sourceStart: 1.5, sourceEnd: 3 },
    { id: 'c3', clipId: 'a', sourceStart: 3, sourceEnd: 4 }, { id: 'c4', clipId: 'b', sourceStart: 0, sourceEnd: 9 }, { id: 'c5', text: 'tay' }]
  const result = splitAnchoredCaptions(items, 'a', 2, 'a-right')
  assert.deepEqual(result.map((item) => [item.id, item.clipId, item.sourceStart, item.sourceEnd]),
    [['c1', 'a', 0, 1], ['c2', 'a', 1.5, 2], ['c2:split', 'a-right', 2, 3], ['c3', 'a-right', 3, 4], ['c4', 'b', 0, 9], ['c5', undefined, undefined, undefined]])
})

test('thu phong: gioi han, vua khung cho video 1 gio / 3 gio nam trong man hinh', () => {
  assert.equal(clampPps(0), PPS_MIN)
  assert.equal(clampPps(9999), PPS_MAX)
  assert.equal(clampPps(80), 80)
  for (const hours of [1, 3]) {
    const pps = fitPps(hours * 3600, 1200)
    assert.ok(pps >= PPS_MIN, `${hours}h khong bi chan o muc toi thieu`)
    assert.ok(HEAD_W + hours * 3600 * pps <= 1200, `${hours}h vua man hinh 1200px`)
  }
  assert.ok(fitPps(3600, 1200) < 0.4, '1 gio o man hinh 1200px can < 0.4 px/giay (cu: toi thieu 20)')
  assert.equal(fitPps(2, 1200), PPS_MAX, 'video rat ngan khong phong qua muc toi da')
  assert.equal(fitPps(10, 1200), 104.4)
  assert.ok(Math.abs(ZOOM_STEP ** 3 - 1.953) < 0.01)
})

test('tickStep: moc dep, cach nhau >= TICK_MIN_GAP, giu cach hien thi cu o muc thu phong thuong', () => {
  for (const pps of [PPS_MIN, 0.1, 0.28, 1, 5, 20, 49, 80, 120, 300]) {
    const step = tickStep(pps)
    assert.ok(step * pps >= TICK_MIN_GAP || step === 7200, `pps ${pps}: buoc ${step}`)
  }
  assert.equal(tickStep(300), 1)
  assert.equal(tickStep(120), 1)
  assert.equal(tickStep(80), 2)
  assert.equal(tickStep(49), 5)
  assert.equal(tickStep(20), 5)
  assert.equal(tickStep(0.28), 600, '1 gio vua 1200px: moc moi 10 phut')
  assert.ok(3 * 3600 / tickStep(fitPps(3 * 3600, 1200)) < 40, 'khong qua nhieu moc')
})

test('tickLabel: giay, phut:giay, gio:phut:giay', () => {
  assert.deepEqual([0, 5, 59, 60, 125, 600, 3599, 3600, 3725, 7200].map(tickLabel), ['0s', '5s', '59s', '1:00', '2:05', '10:00', '59:59', '1:00:00', '1:02:05', '2:00:00'])
  assert.equal(tickLabel(-3), '0s')
  assert.equal(tickLabel(1.6), '2s')
})

test('thumbTiles: so o theo be rong, khung theo doan in..out, khong vuot qua so khung', () => {
  assert.deepEqual(thumbTiles({ in: 0, out: 10, sourceDuration: 10 }, 10, 8), [4], 'item hep: 1 o, khung giua')
  assert.equal(thumbTiles({ in: 0, out: 10, sourceDuration: 10 }, 640, 8).length, 10)
  assert.equal(thumbTiles({ in: 0, out: 10 }, 99999, 8).length, 48, 'toi da 48 o')
  assert.deepEqual(thumbTiles({ in: 0, out: 8, sourceDuration: 8 }, 256, 8), [1, 3, 5, 7], 'o lay khung giua moi doan, deu tren 0..7')
  // chi dung doan sau cua nguon dai 80s (in 40..out 80): chi lay nua sau cac khung
  const tiles = thumbTiles({ in: 40, out: 80, sourceDuration: 80 }, 256, 8)
  assert.ok(tiles.every((index) => index >= 4 && index <= 7), tiles.join())
  assert.deepEqual(thumbTiles({ in: 0, out: 10 }, 100, 0), [])
  assert.deepEqual(thumbTiles({ in: 0, out: 10 }, 0, 8), [])
  assert.ok(thumbTiles({ in: 5, out: 5 }, 500, 8).every((index) => index >= 0 && index < 8), 'doan rong khong ra chi so sai')
})

test('waveStyle: anh song am co the cat theo in..out va toc do, loop / thieu anh thi khong ve', () => {
  const item = { in: 2, out: 6, sourceDuration: 10, speed: 1 }
  const style = waveStyle(item, 80, 'file:///w.png')
  assert.equal(style.backgroundSize, '800px 100%', 'ca file = 10s * 80px')
  assert.equal(style.backgroundPosition, '-160px 0', 'bo qua 2s dau')
  assert.equal(waveStyle({ ...item, speed: 2 }, 80, 'u').backgroundSize, '400px 100%', 'nhanh gap doi -> ngan mot nua')
  assert.equal(waveStyle({ ...item, loop: true }, 80, 'u'), null)
  assert.equal(waveStyle(item, 80, null), null)
  assert.equal(waveStyle({ in: 0, out: 3 }, 100, 'u').backgroundSize, '300px 100%', 'thieu sourceDuration lay out')
})

test('rippleTime: truoc doan giu, trong doan ve dau doan, sau doan lui', () => {
  assert.deepEqual([0, 2, 3, 4.5, 5, 9].map((time) => rippleTime(time, 3, 5)), [0, 2, 3, 3, 3, 7])
})

test('rippleItems: item nam tron trong doan bi xoa, item sau doan lui, item truoc doan va track khoa giu nguyen', () => {
  const items = [
    { id: 'before', start: 0, len: 2 }, { id: 'inside', start: 3.5, len: 1 }, { id: 'edge', start: 3, len: 2 },
    { id: 'straddle', start: 4, len: 3 }, { id: 'after', start: 6, len: 2 }, { id: 'locked', start: 6, len: 1, locked: true }
  ]
  const result = rippleItems(items, 3, 5, (item) => item.start + item.len, (item) => !!item.locked)
  assert.deepEqual(result.removed, ['inside', 'edge'])
  const byId = Object.fromEntries(result.items.map((item) => [item.id, item.start]))
  assert.deepEqual(byId, { before: 0, straddle: 3, after: 4, locked: 6 })
  assert.equal(items.find((item) => item.id === 'after').start, 6, 'khong sua mang goc')
})

test('rippleOverlays: chu cat hai dau theo rippleTime, qua ngan thi xoa', () => {
  const result = rippleOverlays([{ id: 'a', start: 6, end: 8 }, { id: 'b', start: 3.2, end: 4.8 }, { id: 'c', start: 1, end: 4 }], 3, 5)
  assert.deepEqual(result.map((x) => [x.id, x.start, x.end]), [['a', 4, 6], ['c', 1, 3]])
})

console.log(`\n================  ${n} PASS  ================`)
