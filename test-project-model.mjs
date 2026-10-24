import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeProject as normalizeProjectFull, activeTimeline } from './src/renderer/project-model.js'
// Cac kiem tra cu doc noi dung o muc du an: tran noi dung timeline dang mo len de giu nguyen cach viet.
const normalizeProject = (data, makeId) => { const full = normalizeProjectFull(data, makeId); return { ...full, ...activeTimeline(full) } }
import { createAsyncResourceGuard } from './src/renderer/async-resource-guard.js'
import { attachDocumentMouseDrag } from './src/renderer/drag-utils.js'
import { aggregateBatchProgress } from './src/renderer/export-progress.js'
import { snapshotHistoryClips, restoreHistoryClips, historySnapshotsEqual, restoreHistorySelection } from './src/renderer/history-model.js'
import { buildTimelinePlan, fitImageDurationToTarget, mapSourceRange, mapTimelineTime, mapTimelineRangeToSources, resolvePreviewSource, toExportSegments, snapToFrameTime } from './src/renderer/timeline-plan.js'
const require = createRequire(import.meta.url)
const ffmpegOps = require('./electron/ffmpeg-ops.cjs')
const projectStore = require('./electron/project-store.cjs')
const portableProject = require('./electron/portable-project.cjs')
const outputStore = require('./electron/output-store.cjs')
const recoveryStore = require('./electron/recovery-store.cjs')
const downloader = require('./electron/downloader.cjs')
const captionsModule = require('./electron/captions.cjs')
const ttsText = require('./electron/tts-text.cjs')
const ttsGoogle = require('./electron/tts-google.cjs')
const settingsModule = require('./electron/settings.cjs')
const faceSwap = require('./electron/face-swap.cjs')
const { createPriorityQueue } = require('./electron/cache-queue.cjs')

const priorityQueue = createPriorityQueue(1)
const queuedOrder = []
let releaseQueueBlocker
let signalQueueBlocker
const queueBlocker = new Promise((resolve) => { releaseQueueBlocker = resolve })
const queueStarted = new Promise((resolve) => { signalQueueBlocker = resolve })
const queueResults = [
  priorityQueue.enqueue(async () => { signalQueueBlocker(); await queueBlocker; queuedOrder.push('blocker') }),
  priorityQueue.enqueue(async () => { queuedOrder.push('first') }, { sourceKey: 'first' }),
  priorityQueue.enqueue(async () => { queuedOrder.push('selected') }, { sourceKey: 'selected' }),
  priorityQueue.enqueue(async () => { queuedOrder.push('last') }, { sourceKey: 'last' })
]
await queueStarted
priorityQueue.prioritize('selected')
releaseQueueBlocker()
await Promise.all(queueResults)
assert.deepEqual(queuedOrder, ['blocker', 'selected', 'first', 'last'], 'selected asset cache work is promoted while queued')

const boundedQueue = createPriorityQueue(2)
let activeCacheTasks = 0, maxActiveCacheTasks = 0
await Promise.all(Array.from({ length: 7 }, (_, index) => boundedQueue.enqueue(async () => {
  activeCacheTasks++
  maxActiveCacheTasks = Math.max(maxActiveCacheTasks, activeCacheTasks)
  await new Promise((resolve) => setTimeout(resolve, 5))
  activeCacheTasks--
  return index
})))
assert.equal(maxActiveCacheTasks, 2, 'cache generation respects its concurrency limit')

const historyClip = { id: 'clip-1', path: 'source.mp4', kind: 'video', in: 0, out: 5, thumbs: ['data:image/png;base64,large'], wave: { values: new Float32Array(1000) }, thumbLoading: true, waveError: true }
const resourceGuard = createAsyncResourceGuard()
const oldThumbRequest = resourceGuard.begin('clip:one:thumbnail', 'before-relink.mp4', 1)
assert.equal(resourceGuard.isCurrent(oldThumbRequest, 'after-relink.mp4', 1), false, 'old thumbnail cannot attach to a relinked source')
const currentThumbRequest = resourceGuard.begin('clip:one:thumbnail', 'after-relink.mp4', 1)
assert.equal(resourceGuard.isCurrent(oldThumbRequest, 'after-relink.mp4', 1), false, 'new retry supersedes an older request for the same clip')
assert.equal(resourceGuard.isCurrent(currentThumbRequest, 'after-relink.mp4', 1), true)
assert.equal(resourceGuard.isCurrent(currentThumbRequest, 'after-relink.mp4', 2), false, 'resource results are scoped to a project load')
resourceGuard.invalidateAll()
assert.equal(resourceGuard.isCurrent(currentThumbRequest, 'after-relink.mp4', 1), false, 'opening a project invalidates previous pending resources')
const historySnapshot = snapshotHistoryClips([historyClip])
assert.equal(historySnapshotsEqual(historySnapshot, snapshotHistoryClips([{ ...historyClip, wave: null, thumbs: ['different-derived-cache'] }])), true,
  'history comparison ignores derived cache fields and deeply compares edit data')
assert.equal(historySnapshotsEqual(historySnapshot, snapshotHistoryClips([{ ...historyClip, in: 1 }])), false,
  'history comparison detects a nested clip edit')
const historyUiState = { ratio: '9:16', selectedClipId: 'clip-1', selectedOverlayId: 'overlay-a', activeClipId: 'clip-1', activeClipIndex: 0 }
assert.equal(historySnapshotsEqual(historyUiState, { ...historyUiState, selectedClipId: null, selectedOverlayId: null, activeClipIndex: 2 }), true,
  'selection and preview focus do not create content-only undo steps')
assert.deepEqual(restoreHistorySelection(historyUiState, [{ id: 'clip-2' }, { id: 'clip-1' }], [{ id: 'overlay-a' }]),
  { activeClipIndex: 1, selectedClipId: 'clip-1', selectedOverlayId: 'overlay-a' }, 'undo restores selection by stable IDs after reorder')
assert.deepEqual(restoreHistorySelection(historyUiState, [{ id: 'clip-2' }], []),
  { activeClipIndex: 0, selectedClipId: null, selectedOverlayId: null }, 'undo clears selection when its item no longer exists')
assert.equal(Object.hasOwn(historySnapshot[0], 'thumbs'), false)
assert.equal(Object.hasOwn(historySnapshot[0], 'wave'), false)
const restoredHistoryClips = restoreHistoryClips(historySnapshot, [{ ...historyClip, path: 'other.mp4' }])
assert.deepEqual(restoredHistoryClips[0].thumbs, [])
assert.equal(restoredHistoryClips[0].wave, null)
assert.deepEqual(restoreHistoryClips(historySnapshot, [historyClip])[0].thumbs, historyClip.thumbs)
assert.equal(aggregateBatchProgress(0, 2, 50), 25, 'batch export progress includes completed and current output work')
assert.equal(aggregateBatchProgress(1, 2, 50), 75)
assert.equal(aggregateBatchProgress(1, 2, 100), 100)

const previousDocument = globalThis.document, previousWindow = globalThis.window
const makeEventTarget = () => {
  const listeners = new Map()
  return {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name) },
    listeners
  }
}
globalThis.document = makeEventTarget()
globalThis.window = makeEventTarget()
try {
  let dragFinished = 0
  const move = () => {}
  const endDrag = attachDocumentMouseDrag(move, () => { dragFinished++ })
  assert.ok(document.listeners.has('mousemove'))
  assert.ok(document.listeners.has('mouseup'))
  window.listeners.get('blur')()
  endDrag()
  assert.equal(dragFinished, 1, 'window blur ends a drag transaction exactly once')
  assert.equal(document.listeners.size, 0, 'ending a drag removes document listeners')
  assert.equal(window.listeners.size, 0, 'ending a drag removes blur listener')
} finally {
  if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow
}

assert.equal(faceSwap.requireOneFace([], 'MULTIPLE_TARGET_FACES', 'video'), null)
assert.deepEqual(faceSwap.requireOneFace([{ id: 1 }], 'MULTIPLE_SOURCE_FACES', 'image'), { id: 1 })
assert.throws(() => faceSwap.requireOneFace([{ id: 1 }, { id: 2 }], 'MULTIPLE_SOURCE_FACES', 'image'), (error) => error.code === 'MULTIPLE_SOURCE_FACES')
assert.throws(() => faceSwap.requireOneFace([{ id: 1 }, { id: 2 }], 'MULTIPLE_TARGET_FACES', 'video'), (error) => error.code === 'MULTIPLE_TARGET_FACES')

const longVietnamese = ('Xin chào thế giới. Đây là kiểm tra TTS có dấu và khoảng trắng.\n').repeat(180)
const googleChunks = ttsText.splitGoogleText(longVietnamese)
assert.ok(googleChunks.length > 1)
assert.ok(googleChunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 4500))
assert.equal(googleChunks.join(''), longVietnamese.trim())
assert.deepEqual(ttsGoogle.voiceCapabilities('vi-VN-Chirp3-HD-Aoede'), { speakingRate: false, pitch: false, source: 'google-voice-family' })

assert.equal(downloader.checkUrl(' https://example.com/watch?v=1 '), 'https://example.com/watch?v=1')
assert.throws(() => downloader.checkUrl('file:///C:/private.txt'), /http\/https/)
assert.equal(downloader.buildFormatSelector(720), 'bv*[height<=?720]+ba/b[height<=?720]')
assert.equal(downloader.buildFormatSelector(999), 'bv*[height<=?1080]+ba/b[height<=?1080]')
let id = 0
const makeId = (kind) => `${kind}_${++id}`
const cropProject = normalizeProject({ version: 3, clips: [{ id: 'crop-me', path: 'crop.mp4', in: 0, out: 2, cropMode: 'fill', cropX: 0.8, cropY: 0.2 }] }, () => 'crop-test')
assert.deepEqual([cropProject.clips[0].cropMode, cropProject.clips[0].cropX, cropProject.clips[0].cropY], ['fill', 0.8, 0.2])
const filterProject = normalizeProject({ version: 3, filterKey: 'warm', filterIntensity: 37, clips: [] }, () => 'filter-test')
assert.deepEqual([filterProject.filterKey, filterProject.filterIntensity], ['warm', 37])
assert.throws(() => normalizeProject({ version: 3, filterKey: 'unknown', clips: [] }), /filterKey/)
assert.throws(() => normalizeProject({ version: 3, filterIntensity: 101, clips: [] }), /filterIntensity/)
const transitionProject = normalizeProject({ version: 3, transition: 'cross', transitionDuration: 1.2, clips: [] }, () => 'transition-test')
assert.deepEqual([transitionProject.transition, transitionProject.transitionDuration], ['cross', 1.2])
assert.throws(() => normalizeProject({ version: 3, transitionDuration: 3, clips: [] }), /transitionDuration/)
const styleProject = normalizeProject({ version: 3, transition: 'cross', transitionStyle: 'wipeleft', clips: [] }, () => 'style-test')
assert.equal(styleProject.transitionStyle, 'wipeleft')
assert.equal(normalizeProject({ version: 3, clips: [] }, () => 'style-default').transitionStyle, 'fade')
assert.equal(normalizeProject({ version: 3, transitionStyle: 'nope', clips: [] }, () => 'style-bad').transitionStyle, 'fade')
const stickerProject = normalizeProject({ version: 3, clips: [], videoOverlays: [{ id: 'st1', sticker: 'twemoji/1f600', start: 1, out: 2, x: 0.3, y: 0.4, width: 0.2, height: 0.2 }] }, () => 'sticker-test')
assert.deepEqual([stickerProject.videoOverlays[0].kind, stickerProject.videoOverlays[0].path, stickerProject.videoOverlays[0].sticker], ['image', '', 'twemoji/1f600'])
assert.throws(() => normalizeProject({ version: 3, clips: [], videoOverlays: [{ sticker: '../secret', start: 0, out: 1 }] }, () => 'sticker-test'), /sticker/)
// Emoji chu cu co sticker -> V2; emoji khong co sticker va overlay chu giu nguyen
const emojiMigration = normalizeProject({ version: 3, clips: [], overlays: [
  { id: 'old-fire', type: 'emoji', text: '🔥', start: 0.5, end: 2.5, x: 0.4, y: 0.6, size: 0.12 },
  { id: 'old-dino', type: 'emoji', text: '🦖', start: 0, end: 1, x: 0.5, y: 0.5, size: 0.1 },
  { id: 'old-text', type: 'text', text: 'hi', start: 0, end: 1, x: 0.5, y: 0.5, size: 0.07 }] }, () => 'sticker-test')
assert.deepEqual(emojiMigration.videoOverlays.map(({ id, sticker, start, out, width }) => [id, sticker, start, out, width]), [['old-fire', 'twemoji/1f525', 0.5, 2, 0.12]])
assert.deepEqual(emojiMigration.overlays.map((o) => o.id), ['old-dino', 'old-text'])
// Watermark: moi timeline co the co logo rieng; gia tri sai bi dua ve mac dinh hoac gioi han
assert.equal(normalizeProject({ version: 3, clips: [] }, () => 'wm-none').timelines[0].watermark, null)
const watermarkProject = normalizeProject({ version: 3, clips: [], watermark: { path: 'C:/logos/a.png', anchorX: 0, anchorY: 0.7, size: 5, margin: -1, opacity: 0.5, fadeIn: 9 } }, () => 'wm-test')
assert.deepEqual(watermarkProject.timelines[0].watermark, { path: 'C:/logos/a.png', name: '', enabled: true, anchorX: 0, anchorY: 1, size: 0.5, margin: 0, opacity: 0.5, fadeIn: 3, fadeOut: 0.5 })
const overlayProject = normalizeProject({ version: 3, clips: [], overlays: [{ id: 'text1', text: 'Xin chào\n{đẹp} \\ test', start: 0.25, end: 1.5, x: 0.2, y: 0.7, align: 'right', zIndex: 4 }] }, () => 'overlay-test')
assert.deepEqual([overlayProject.overlays[0].align, overlayProject.overlays[0].zIndex, overlayProject.overlays[0].x], ['right', 4, 0.2])
const overlayAss = captionsModule.toAss([{ start: 0.25, end: 1.5, text: 'Xin chào\n{đẹp} \\ test', pos: { x: 216, y: 1344 }, fs: 120, align: 'right', layer: 4 }], { width: 1080, height: 1920 })
assert.match(overlayAss, /Dialogue: 4,0:00:00\.25,0:00:01\.50/)
assert.match(overlayAss, /\\an6\\pos\(216,1344\)/)
assert.match(overlayAss, /Xin chào\\N\\\{đẹp\\\} \\\\ test/)
const srtSample = '1\r\n00:00:59,999 --> 00:01:02,999\r\nXin chào\r\n\r\n2\r\n00:01:02.999 --> 00:01:03.001\r\nThế giới'
const parsedSrt = captionsModule.parseSrt(srtSample)
assert.deepEqual(parsedSrt.map(({ start, end, text }) => [start, end, text]), [[59.999, 62.999, 'Xin chào'], [62.999, 63.001, 'Thế giới']])
assert.match(captionsModule.toSrt([{ start: 62.9996, end: 63.001, text: 'Carry' }]), /00:01:03,000 --> 00:01:03,001/)
assert.throws(() => captionsModule.parseSrt('1\n00:00:03,000 --> 00:00:02,000\nSai'), /kết thúc phải sau/)
const t01Plan = buildTimelinePlan([{ id: 't01', path: 't01.mp4', in: 2, out: 6, speed: 2 }])
assert.ok(Math.abs(snapToFrameTime(2.017, 30) - 61 / 30) < 1e-12, 'frame snap rounds source time to the nearest source frame')
assert.equal(snapToFrameTime(2.08, 25), 2.08, 'frame snap preserves a value already on frame boundary')
assert.throws(() => snapToFrameTime(Number.NaN, 30), /không hợp lệ/)
assert.equal(t01Plan.duration, 2)
assert.deepEqual(mapSourceRange(t01Plan, 't01', 3, 4).map(({ start, end }) => [start, end]), [[0.5, 1]])
const t02Plan = buildTimelinePlan([
  { id: 't02a', path: 'a.mp4', in: 0, out: 3, speed: 1 },
  { id: 't02b', path: 'b.mp4', in: 0, out: 4, speed: 1 }
], { transition: 'cross', transitionDuration: 0.5 })
assert.equal(t02Plan.entries[1].start, 2.5)
assert.equal(t02Plan.duration, 6.5)
const shortCrossPlan = buildTimelinePlan([
  { id: 'short-a', path: 'a.mp4', in: 0, out: 0.3, speed: 1 },
  { id: 'short-b', path: 'b.mp4', in: 0, out: 0.4, speed: 1 }
], { transition: 'cross', transitionDuration: 0.5 })
assert.equal(shortCrossPlan.entries[1].overlapIn, 0.15)
assert.ok(Math.abs(shortCrossPlan.duration - 0.55) < 1e-8)
const slideshowFitClips = [
  { id: 'fit-v1', path: 'v1.mp4', kind: 'video', in: 0, out: 10, speed: 1 },
  { id: 'fit-i1', path: 'i1.png', kind: 'image', in: 0, out: 3, speed: 1 },
  { id: 'fit-v2', path: 'v2.mp4', kind: 'video', in: 0, out: 5, speed: 1 },
  { id: 'fit-i2', path: 'i2.png', kind: 'image', in: 0, out: 3, speed: 1 }
]
const fittedSlideshow = fitImageDurationToTarget(slideshowFitClips, 20, { transition: 'cross', transitionDuration: 0.5 })
const fittedPlan = buildTimelinePlan(slideshowFitClips.map((clip) => clip.kind === 'image' ? { ...clip, out: fittedSlideshow.imageDuration } : clip), { transition: 'cross', transitionDuration: 0.5 })
assert.ok(Math.abs(fittedPlan.duration - 20) < 0.001)
assert.ok(fittedSlideshow.imageDuration > 2.5) // Music target accounts for V1 video and three crossfades.
assert.deepEqual(mapTimelineRangeToSources(t02Plan, 2.4, 3.6).map(({ clipId, start, end }) => [clipId, start, end]), [
  ['t02a', 2.4, 2.75], ['t02b', 2.75, 3.6]
])
const legacy = normalizeProject({ version: 1, clips: [{ path: 'C:/media/a.mp4', in: 2, out: 6, speed: 2 }],
  bgAudio: { kind: 'tts', path: 'C:/voice.wav', name: 'voice' }, bgVolume: 0.7,
  captions: [{ start: 3, end: 4, text: 'hello' }] }, makeId)
assert.equal(legacy.version, 6)
assert.equal(legacy.captionTimebase, 'source-legacy')
assert.equal(legacy.voice, undefined, 'v5 no longer keeps a separate voice slot')
assert.equal(legacy.audioItems[0].path, 'C:/voice.wav')
assert.equal(legacy.audioItems[0].trackId, 'A2', 'migrated voice goes to the first free audio track after A1')
assert.equal(legacy.clips[0].id, 'clip_1')
assert.equal(legacy.captions[0].id, 'caption_2')
assert.equal(legacy.clips[0].speed, 2)
assert.equal(legacy.audioItems[0].track, 'voice')
assert.deepEqual(legacy.assets.map((asset) => [asset.path, asset.kind]), [['C:/media/a.mp4', 'video'], ['C:/voice.wav', 'audio']],
  'v1 migration creates one independent library asset for each distinct referenced media file')

const trackProject = normalizeProject({ version: 3, clips: [{ id: 'v1', path: 'main.mp4', in: 0, out: 8 }],
  videoOverlays: [{ id: 'v2-item', path: 'overlay.png', kind: 'image', start: 2, out: 4, x: 0.3, y: 0.4, width: 0.5, height: 0.6, opacity: 0.8 }],
  audioItems: [{ id: 'voice-part', path: 'voice.wav', track: 'voice', start: 2, in: 1, out: 3, gain: 0.7, fadeIn: 0.2 }] }, makeId)
assert.deepEqual(trackProject.videoOverlays.map(({ id, start, out, width, height, opacity }) => [id, start, out, width, height, opacity]),
  [['v2-item', 2, 4, 0.5, 0.6, 0.8]])
assert.deepEqual(trackProject.audioItems.map(({ id, track, start, in: sourceIn, out, gain }) => [id, track, start, sourceIn, out, gain]),
  [['voice-part', 'voice', 2, 1, 3, 0.7]])
const trackRoundTrip = normalizeProject(JSON.parse(JSON.stringify(trackProject)), makeId)
assert.deepEqual(trackRoundTrip.videoOverlays, trackProject.videoOverlays)
assert.deepEqual(trackRoundTrip.audioItems, trackProject.audioItems)
assert.deepEqual(trackProject.assets.map((asset) => [asset.path, asset.kind]), [['main.mp4', 'video'], ['overlay.png', 'image'], ['voice.wav', 'audio']],
  'v3 migration builds a de-duplicated asset library across V1, V2 and audio references')
const libraryProject = normalizeProject({ version: 4, clips: [], assets: [
  { id: 'asset-one', path: 'orphan.mp4', name: 'orphan.mp4', kind: 'video', source: 'download' },
  { id: 'asset-duplicate-path', path: 'ORPHAN.mp4', name: 'duplicate', kind: 'video' }
] }, makeId)
assert.deepEqual(libraryProject.assets.map(({ id, path: assetPath, source }) => [id, assetPath, source]), [['asset-one', 'orphan.mp4', 'download']],
  'explicit v4 library keeps unreferenced assets and de-duplicates paths')
assert.throws(() => normalizeProject({ version: 3, clips: [], videoOverlays: [{ path: '', start: 0, out: 1 }] }, makeId), /videoOverlays\[0\]\.path/)
assert.throws(() => normalizeProject({ version: 3, clips: [], audioItems: [{ path: 'a.wav', track: 'fx', out: 1 }] }, makeId), /audioItems\[0\]\.track/)

const two = normalizeProject({ version: 2, clips: [
  { id: 'a', path: 'a.mp4', in: 0, out: 3 },
  { id: 'b', path: 'b.mp4', in: 1, out: 5, speed: 2 }
], transition: 'cross' }, makeId)
assert.equal(two.captionTimebase, 'timeline-legacy')
const plan = buildTimelinePlan(two.clips, { transition: 'cross', transitionDuration: 0.5 })
assert.equal(plan.entries[1].start, 2.5)
assert.equal(plan.duration, 4.5) // B plays 2s, so 3s - overlap 0.5 + 2s.
assert.deepEqual(mapSourceRange(plan, 'b', 3, 5).map(({ start, end }) => [start, end]), [[3.5, 4.5]])
assert.deepEqual(mapTimelineTime(plan, 2.75).map((entry) => entry.clipId), ['a', 'b'])
assert.equal(resolvePreviewSource(plan, 2.6).clipId, 'a')
assert.equal(resolvePreviewSource(plan, 2.9).clipId, 'b')
assert.equal(toExportSegments(plan).length, 2)

const cut = buildTimelinePlan([{ id: 'c', path: 'c.mp4', in: 0, out: 6, speed: 1 }], {
  keepByClip: { c: [{ start: 0, end: 2 }, { start: 4, end: 6 }] }
})
assert.equal(cut.duration, 4)
assert.deepEqual(mapSourceRange(cut, 'c', 4.5, 5).map(({ start, end }) => [start, end]), [[2.5, 3]])

assert.throws(() => normalizeProject({ version: 99, clips: [] }), /mới hơn/)
assert.throws(() => normalizeProject({ version: 3, clips: [{ path: '', in: 0, out: 2 }] }), /clips\[0\]\.path/)
assert.throws(() => buildTimelinePlan([{ id: 'bad', in: 1, out: 1 }]), /không hợp lệ/)
assert.equal(buildTimelinePlan([{ id: 'silent', in: 0, out: 3 }], { keepByClip: { silent: [] } }).duration, 0)
const noSecrets = normalizeProject({ version: 3, projectId: 'safe', clips: [], googleTtsKey: 'do-not-save', apiKey: 'do-not-save' }, makeId)
assert.equal('googleTtsKey' in noSecrets, false)
assert.equal('apiKey' in noSecrets, false)
const silenceProject = normalizeProject({ version: 3, clips: [{ id: 'silence', path: 's.mp4', in: 0, out: 6 }],
  keepSegments: [{ start: 0, end: 2 }, { start: 4, end: 6 }], autoCut: true,
  autoInfo: { duration: 6, silences: [{ start: 2, end: 4, remove: false }], keep: [{ start: 0, end: 6 }], removed: 1, saved: 0, kept: 6,
    options: { noise: '-32dB', minSilence: 0.6, pad: 0.08 } } }, makeId)
assert.deepEqual(silenceProject.keepSegments, [{ start: 0, end: 2 }, { start: 4, end: 6 }])
assert.equal(silenceProject.autoCut, true)
assert.deepEqual(silenceProject.silenceParams, { threshold: -30, minSilence: 0.4, pad: 0.06 }, 'legacy silence settings get stable defaults')
assert.deepEqual(silenceProject.autoInfo, { duration: 6, silences: [{ start: 2, end: 4, remove: false }], keep: [{ start: 0, end: 6 }],
  removed: 1, saved: 0, kept: 6, options: { noise: '-32dB', minSilence: 0.6, pad: 0.08 } })
assert.deepEqual(normalizeProject({ version: 3, clips: [], silenceParams: { threshold: -42, minSilence: 1.2, pad: 0.2 } }, makeId).silenceParams,
  { threshold: -42, minSilence: 1.2, pad: 0.2 }, 'project persists silence configuration')
assert.throws(() => normalizeProject({ version: 3, clips: [], silenceParams: { threshold: -70 } }, makeId), /silenceParams\.threshold/)
assert.throws(() => normalizeProject({ version: 3, clips: [{ path: 's.mp4', in: 0, out: 6 }], keepSegments: [{ start: 5, end: 7 }] }, makeId), /keepSegments\[0\]\.end/)
assert.deepEqual(ffmpegOps.computeKeep(10, [{ start: 0, end: 2 }, { start: 8, end: null }], 0.1), [
  { start: 1.9, end: 8.1 }
])
assert.deepEqual(ffmpegOps.computeKeep(3, [], 0.06), [{ start: 0, end: 3 }], 'no detected silence keeps the full clip')
assert.deepEqual(ffmpegOps.computeKeep(5, [{ start: 0, end: 5 }], 0.1), [], 'all-silence media must not produce a fake kept segment')
assert.deepEqual(ffmpegOps.computeKeep(6, [{ start: 1, end: 3 }, { start: 2.8, end: 4 }], 0), [
  { start: 0, end: 1 }, { start: 4, end: 6 }
], 'overlapping detected silence windows are merged before computing keep ranges')

const jobA = ffmpegOps.beginJob('unit-job-a')
const jobB = ffmpegOps.beginJob('unit-job-b')
let releaseJobs
const jobsGate = new Promise((resolve) => { releaseJobs = resolve })
const stateA = ffmpegOps.runJob(jobA, async () => { await jobsGate; return ffmpegOps.isCancelled() })
const stateB = ffmpegOps.runJob(jobB, async () => { await jobsGate; return ffmpegOps.isCancelled() })
assert.equal(ffmpegOps.cancelJob('unit-job-a'), true)
releaseJobs()
assert.deepEqual(await Promise.all([stateA, stateB]), [true, false])
ffmpegOps.endJob('unit-job-a')
ffmpegOps.endJob('unit-job-b')
const encoderA = ffmpegOps.runJob(ffmpegOps.beginJob('unit-encoder-a'), async () => {
  ffmpegOps.setEncoder('nvenc')
  return ffmpegOps.getEncoder()
})
const encoderB = ffmpegOps.runJob(ffmpegOps.beginJob('unit-encoder-b'), async () => ffmpegOps.getEncoder())
assert.deepEqual(await Promise.all([encoderA, encoderB]), ['nvenc', 'cpu'])
ffmpegOps.endJob('unit-encoder-a')
ffmpegOps.endJob('unit-encoder-b')

const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taoclip-project-store-'))
try {
  const sourceA = path.join(storeDir, 'source-a', 'same.mp4')
  const sourceB = path.join(storeDir, 'source-b', 'same.mp4')
  const sourceC = path.join(storeDir, 'source-c', 'unused.mp4')
  fs.mkdirSync(path.dirname(sourceA), { recursive: true })
  fs.mkdirSync(path.dirname(sourceB), { recursive: true })
  fs.writeFileSync(sourceA, 'clip-a-content')
  fs.writeFileSync(sourceB, 'clip-b-content')
  fs.mkdirSync(path.dirname(sourceC), { recursive: true })
  fs.writeFileSync(sourceC, 'library-only-content')
  const portableTarget = path.join(storeDir, 'portable', 'demo.taoclip')
  const portableResult = portableProject.collectProject({ version: 3, clips: [
    { id: 'a', path: sourceA, name: 'same.mp4' }, { id: 'b', path: sourceB, name: 'same.mp4' }
  ], videoOverlays: [{ id: 'v2', path: sourceA, name: 'same.mp4' }], audioItems: [{ id: 'audio', path: sourceB, name: 'same.mp4' }],
  assets: [{ id: 'unused', path: sourceC, name: 'unused.mp4', kind: 'video' }] }, portableTarget)
  const portableStored = projectStore.readProject(portableTarget)
  assert.equal(path.isAbsolute(portableStored.clips[0].path), false, 'portable project stores asset paths relative to its folder')
  assert.equal(portableStored.clips[0].path, portableStored.videoOverlays[0].path, 'reused asset is collected only once')
  assert.equal(portableStored.clips[1].path, portableStored.audioItems[0].path, 'audio reuses the same collected copy')
  assert.notEqual(portableStored.clips[0].path, portableStored.clips[1].path, 'same-basename sources get distinct collected names')
  assert.equal(path.isAbsolute(portableStored.assets[0].path), false, 'portable project stores library-only asset paths relatively')
  const portableResolved = portableProject.resolveProjectPaths(portableStored, path.dirname(portableTarget))
  assert.equal(fs.readFileSync(portableResolved.clips[0].path, 'utf8'), 'clip-a-content')
  assert.equal(fs.readFileSync(portableResolved.clips[1].path, 'utf8'), 'clip-b-content')
  assert.equal(fs.readFileSync(portableResolved.assets[0].path, 'utf8'), 'library-only-content', 'collect includes assets not yet used on the timeline')
  assert.equal(fs.existsSync(sourceA), true, 'collection never moves or deletes source media')
  assert.equal(fs.existsSync(sourceB), true, 'collection never moves or deletes source media')
  assert.equal(portableResult.filePath, portableTarget)
  assert.throws(() => portableProject.collectProject({ version: 3, clips: [{ path: path.join(storeDir, 'missing.mp4') }] }, portableTarget), /Không tìm thấy media/)
  assert.equal(fs.existsSync(portableTarget), true, 'failed collection keeps any earlier project file')
  const movedPortableDir = path.join(storeDir, 'portable-moved')
  fs.renameSync(path.dirname(portableTarget), movedPortableDir)
  const movedPortablePath = path.join(movedPortableDir, path.basename(portableTarget))
  const movedPortable = portableProject.resolveProjectPaths(projectStore.readProject(movedPortablePath), movedPortableDir)
  assert.equal(fs.readFileSync(movedPortable.clips[0].path, 'utf8'), 'clip-a-content', 'portable project keeps working after its folder is moved')
  assert.equal(fs.readFileSync(movedPortable.audioItems[0].path, 'utf8'), 'clip-b-content')
  const storeFile = path.join(storeDir, 'sample.taoclip')
  projectStore.writeProject(storeFile, { version: 3, clips: [{ id: 'one' }] })
  assert.deepEqual(projectStore.readProject(storeFile), { version: 3, clips: [{ id: 'one' }] })
  projectStore.writeProject(storeFile, { version: 3, clips: [{ id: 'two' }] })
  assert.deepEqual(projectStore.readProject(storeFile), { version: 3, clips: [{ id: 'two' }] })
  const backupFile = `${storeFile}.bak`
  fs.renameSync(storeFile, backupFile)
  assert.deepEqual(projectStore.readProject(storeFile), { version: 3, clips: [{ id: 'two' }] })
  assert.equal(fs.existsSync(backupFile), false)
  assert.throws(() => projectStore.writeProject(storeFile, { text: 'x'.repeat(projectStore.MAX_PROJECT_BYTES) }), /25 MB/)
  assert.deepEqual(projectStore.readProject(storeFile), { version: 3, clips: [{ id: 'two' }] })
  const outputFile = path.join(storeDir, 'render.mp4')
  fs.writeFileSync(outputFile, 'old-valid-output')
  const sourceMedia = path.join(storeDir, 'source.mp4')
  fs.writeFileSync(sourceMedia, 'source-content')
  assert.equal(outputStore.validateExportPaths([sourceMedia], outputFile), outputFile)
  assert.throws(() => outputStore.validateExportPaths([sourceMedia], sourceMedia), /không được ghi đè media nguồn/i)
  assert.throws(() => outputStore.validateExportPaths([path.join(storeDir, 'missing.mp4')], outputFile), /không tìm thấy media nguồn/i)
  const failedStage = outputStore.createStagingPath(outputFile, 'job:cancelled')
  fs.writeFileSync(failedStage, 'partial-output')
  outputStore.discardOutput(failedStage)
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'old-valid-output')
  const goodStage = outputStore.createStagingPath(outputFile, 'job:success')
  fs.writeFileSync(goodStage, 'validated-output')
  assert.equal(outputStore.publishOutput(goodStage, outputFile), outputFile)
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'validated-output')
  assert.equal(fs.existsSync(goodStage), false)
  const emptyStage = outputStore.createStagingPath(outputFile, 'job:empty')
  fs.writeFileSync(emptyStage, '')
  assert.throws(() => outputStore.publishOutput(emptyStage, outputFile), /rỗng/)
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'validated-output')
  const recoveryRoot = path.join(storeDir, 'recovery')
  const settingsRoot = path.join(storeDir, 'user-data')
  const settings = settingsModule.createSettingsStore({ app: { getPath: () => settingsRoot }, safeStorage: { isEncryptionAvailable: () => false } })
  const sessionKeyState = settings.setApiKey('session-secret')
  assert.deepEqual(sessionKeyState, { saved: true, persistent: false, encrypted: false })
  assert.equal(settings.getApiKey(), 'session-secret')
  assert.equal(settings.getStatus().configured, true)
  assert.equal(JSON.stringify(fs.readFileSync(path.join(settingsRoot, 'taoclip-settings.json'), 'utf8')).includes('session-secret'), false)
  settings.setApiKey('')
  assert.equal(settings.hasApiKey(), false)
  const encryptedSettings = settingsModule.createSettingsStore({ app: { getPath: () => settingsRoot }, safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, '')
  } })
  assert.deepEqual(encryptedSettings.setApiKey('persistent-secret'), { saved: true, persistent: true, encrypted: true })
  assert.equal(encryptedSettings.getApiKey(), 'persistent-secret')
  const persistedSettings = fs.readFileSync(path.join(settingsRoot, 'taoclip-settings.json'), 'utf8')
  assert.equal(persistedSettings.includes('persistent-secret'), false)
  assert.equal(JSON.parse(persistedSettings).googleTtsKeyEnc, true)

  const previousFetch = global.fetch
  try {
    global.fetch = async (_url, options = {}) => {
      const request = JSON.parse(options.body)
      global.lastGoogleAudioConfig = request.audioConfig
      return { ok: true, json: async () => ({ audioContent: Buffer.from('audio').toString('base64') }) }
    }
    await ttsGoogle.synthesize('xin chào', path.join(storeDir, 'chirp.mp3'), { apiKey: 'k', voiceName: 'vi-VN-Chirp3-HD-Aoede', rate: 1.4, pitch: 4 })
    assert.deepEqual(global.lastGoogleAudioConfig, { audioEncoding: 'MP3' })
    await ttsGoogle.synthesize('xin chào', path.join(storeDir, 'neural.mp3'), { apiKey: 'k', voiceName: 'vi-VN-Neural2-A', rate: 1.4, pitch: 4 })
    assert.deepEqual(global.lastGoogleAudioConfig, { audioEncoding: 'MP3', speakingRate: 1.4, pitch: 4 })
    await assert.rejects(ttsGoogle.synthesize('x'.repeat(5001), path.join(storeDir, 'too-long.mp3'), { apiKey: 'k', voiceName: 'vi-VN-Neural2-A' }), /5.000 byte/)
    let requestCount = 0
    global.fetch = async () => { requestCount++; return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => '{"error":{"message":"API key invalid"}}' } }
    await assert.rejects(ttsGoogle.listVoices('bad-key'), /401: API key invalid/)
    assert.equal(requestCount, 1, 'Google errors are returned without automatic charged retries')
    global.fetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'quota exceeded' })
    await assert.rejects(ttsGoogle.listVoices('k'), /429: quota exceeded/)
    global.fetch = async () => { throw new Error('offline') }
    await assert.rejects(ttsGoogle.listVoices('k'), /Không kết nối được Google TTS: offline/)
    global.fetch = async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error }
    await assert.rejects(ttsGoogle.listVoices('k'), /hết thời gian chờ/)
  } finally { global.fetch = previousFetch; delete global.lastGoogleAudioConfig }
  const recoveryProject = { version: 3, projectId: 'recovery-project', clips: [] }
  for (let i = 0; i < 7; i++) recoveryStore.writeRecovery(recoveryRoot, { ...recoveryProject, editRevision: i })
  const recovery = recoveryStore.getRecovery(recoveryRoot, recoveryProject.projectId)
  assert.equal(recovery.revision, 7)
  assert.equal(recovery.project.editRevision, 6)
  const projectRecoveryDir = path.join(recoveryRoot, require('node:crypto').createHash('sha256').update(recoveryProject.projectId).digest('hex').slice(0, 24))
  assert.equal(fs.readdirSync(projectRecoveryDir).filter((name) => /^rev-\d+\.json$/.test(name)).length, recoveryStore.KEEP_REVISIONS)
  fs.writeFileSync(path.join(projectRecoveryDir, 'rev-7.json'), '{broken')
  const fallbackRecovery = recoveryStore.getRecovery(recoveryRoot, recoveryProject.projectId)
  assert.equal(fallbackRecovery.revision, 6)
  assert.equal(fallbackRecovery.corruptPrevious, true)
  recoveryStore.dismissRecovery(recoveryRoot, recoveryProject.projectId, fallbackRecovery.revision)
  assert.equal(recoveryStore.getPendingRecovery(recoveryRoot, recoveryProject.projectId).corruptPrevious, true)
} finally {
  const safeTempRoot = path.resolve(os.tmpdir()) + path.sep
  assert.ok(path.resolve(storeDir).startsWith(safeTempRoot), 'test cleanup must stay inside the OS temp directory')
  fs.rmSync(storeDir, { recursive: true, force: true })
}
console.log('Project schema, timeline plan, isolated jobs, safe project store and cache queue priority/concurrency: PASS')
