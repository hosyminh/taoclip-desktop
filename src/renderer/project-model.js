import { normalizeTracks, assignDefaultTracks, withLayerZIndex } from './track-model.js'
import { pickTimelineFields, cleanTimelineName, MAX_TIMELINES } from './timelines-model.js'
import { DEFAULT_TRANSITION_STYLE, TRANSITION_STYLES } from './transition-styles.js'
import { stickerIdForChar } from './sticker-catalog.js'

const PROJECT_VERSION = 6

const DEFAULTS = Object.freeze({
  ratio: '9:16',
  filterKey: 'none',
  filterIntensity: 100,
  mode: 'smart',
  captions: [],
  burnCaptions: true,
  overlays: [],
  videoOverlays: [],
  audioItems: [],
  transition: 'none',
  transitionStyle: DEFAULT_TRANSITION_STYLE,
  transitionDuration: 0.5,
  clips: [],
  assets: [],
  ducking: true,
  origVolume: 1,
  syncMode: 'fit',
  slideDur: 3,
  ttsEngine: 'local',
  ttsVoice: '',
  ttsRate: 1,
  ttsPitch: 0,
  aiEdited: false,
  keepSegments: null,
  autoCut: false,
  autoInfo: null,
  silenceParams: { threshold: -30, minSilence: 0.4, pad: 0.06 },
  markers: []
})

function defaultId(prefix, index) {
  const random = globalThis.crypto?.randomUUID?.()
  return random ? `${prefix}_${random}` : `${prefix}_${Date.now().toString(36)}_${index.toString(36)}_${Math.random().toString(36).slice(2)}`
}

function mediaPathKey(value) { return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }

function inferLegacyAssets(data, makeId = defaultId) {
  const records = [
    ...(Array.isArray(data.clips) ? data.clips.map((item) => ({ ...item, kind: item.kind === 'image' ? 'image' : 'video' })) : []),
    ...(Array.isArray(data.videoOverlays) ? data.videoOverlays.map((item) => ({ ...item, kind: item.kind === 'image' ? 'image' : 'video' })) : []),
    ...(Array.isArray(data.audioItems) ? data.audioItems.map((item) => ({ ...item, kind: 'audio' })) : []),
    ...(data.music?.path ? [{ ...data.music, kind: 'audio' }] : []),
    ...(data.voice?.path ? [{ ...data.voice, kind: 'audio' }] : [])
  ]
  const byPath = new Map()
  for (const record of records) {
    if (typeof record.path !== 'string' || !record.path.trim()) continue
    const key = mediaPathKey(record.path)
    const existing = byPath.get(key)
    if (existing) {
      existing.missing = existing.missing && !!record.missing
      existing.metadata ||= record.metadata || record.src || null
      continue
    }
    byPath.set(key, {
      id: typeof record.assetId === 'string' && record.assetId ? record.assetId : makeId('asset', byPath.size),
      path: record.path, name: record.name || record.path.split(/[\\/]/).pop(), kind: record.kind,
      source: ['local', 'download', 'tts', 'ai'].includes(record.source) ? record.source : 'local',
      missing: !!record.missing, metadata: record.metadata || record.src || null
    })
  }
  return [...byPath.values()]
}

// v5: nhac nen / long tieng khong con la hai o rieng ma la audio item tren track; doi file v4 sang item.
function migrateAudioSlots(data) {
  const items = Array.isArray(data.audioItems) ? data.audioItems.slice() : []
  const has = (id, itemPath, role) => items.some((item) => item?.id === id || (item?.path === itemPath && item?.track === role))
  if (data.music?.path && !has('legacy-music', data.music.path, 'music')) {
    items.push({ id: 'legacy-music', path: data.music.path, name: data.music.name, track: 'music', start: 0, in: 0,
      out: Math.max(0.001, Number(data.bgDur) || 0.001), gain: data.musicVol ?? 0.4, loop: data.bgLoop !== false })
  }
  if (data.voice?.path && !has('legacy-voice', data.voice.path, 'voice')) {
    items.push({ id: 'legacy-voice', path: data.voice.path, name: data.voice.name, track: 'voice', start: data.voiceOffset ?? 0, in: 0,
      out: Math.max(0.001, Number(data.voiceDur) || 0.001), gain: data.voiceVol ?? 1 })
  }
  return items
}

function finite(value, label, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Project không hợp lệ: ${label}`)
  return n
}

function migrateLegacy(data) {
  const version = Number(data.version || 1)
  if (!Number.isInteger(version) || version < 1) throw new Error('Project không hợp lệ: version')
  if (version > PROJECT_VERSION) throw new Error(`Project version ${version} mới hơn phiên bản TaoClip đang hỗ trợ.`)

  const migrated = { ...data }
  if (version < 2 && data.bgAudio) {
    if (data.bgAudio.kind === 'tts') {
      migrated.voice ??= { path: data.bgAudio.path, name: data.bgAudio.name }
      migrated.voiceVol ??= data.bgVolume
    } else {
      migrated.music ??= { path: data.bgAudio.path, name: data.bgAudio.name }
      migrated.musicVol ??= data.bgVolume
    }
  }
  if (version < 2) { delete migrated.bgAudio; delete migrated.bgVolume }
  // In v1/v2 captions are in source time for one clip, and timeline time for
  // multi-clip projects. Keep every timestamp unchanged and record that fact.
  if (version < 3) {
    const clips = Array.isArray(data.clips) ? data.clips : []
    migrated.captionTimebase ??= clips.length === 1 ? 'source-legacy' : 'timeline-legacy'
    migrated.projectId ??= defaultId('project', 0)
  }
  if (version < 4) migrated.assets ??= inferLegacyAssets(migrated)
  if (version < 5) {
    migrated.audioItems = migrateAudioSlots(migrated)
    for (const key of ['music', 'voice', 'musicVol', 'voiceVol', 'bgDur', 'voiceDur', 'voiceOffset', 'bgLoop']) delete migrated[key]
  }
  // v6: noi dung (clip, track, phu de, thong so) chuyen vao timelines[]; thu vien media va projectId o lai muc du an.
  if (version < 6) {
    const content = pickTimelineFields(migrated)
    for (const key of Object.keys(content)) delete migrated[key]
    migrated.timelines = [{ name: 'Timeline 1', ...content }]
  }
  migrated.version = PROJECT_VERSION
  return migrated
}

// Sticker V2 la anh trong app nen khong co path; id phai khop bo sticker-catalog.js
const STICKER_ID = /^twemoji\/[0-9a-f]+$/

// Overlay emoji chu cu co sticker tuong ung -> item V2 kind image, giu vi tri, thoi gian va kich thuoc
function legacyEmojiToSticker(item) {
  const start = Number(item.start) || 0
  const end = Number.isFinite(Number(item.end)) ? Number(item.end) : start + 3
  const size = Number.isFinite(Number(item.size)) ? Number(item.size) : 0.14
  return {
    id: item.id, sticker: stickerIdForChar(item.text), name: item.text, kind: 'image',
    start, in: 0, out: Math.max(0.1, end - start), x: item.x ?? 0.5, y: item.y ?? 0.5,
    width: size, height: size, opacity: 1, zIndex: item.zIndex ?? 0
  }
}

// Thu vien media dung chung cua du an; file cu chua co thi suy ra tu moi timeline.
function normalizeAssets(migrated, rawTimelines, makeId) {
  const gather = (key) => rawTimelines.flatMap((timeline) => Array.isArray(timeline?.[key]) ? timeline[key] : [])
  const assetSource = Array.isArray(migrated.assets) ? migrated.assets
    : inferLegacyAssets({ clips: gather('clips'), videoOverlays: gather('videoOverlays'), audioItems: gather('audioItems') }, makeId)
  const normalizedAssets = []
  const assetIds = new Set(), assetPaths = new Set()
  for (let index = 0; index < assetSource.length; index++) {
    const asset = assetSource[index]
    if (!asset || typeof asset !== 'object' || typeof asset.path !== 'string' || !asset.path.trim()) {
      throw new Error(`Project không hợp lệ: assets[${index}].path`)
    }
    const pathKey = mediaPathKey(asset.path)
    if (assetPaths.has(pathKey)) continue
    const id = typeof asset.id === 'string' && asset.id ? asset.id : makeId('asset', index)
    if (assetIds.has(id)) throw new Error(`Project có asset trùng ID: ${id}`)
    assetIds.add(id); assetPaths.add(pathKey)
    const kind = ['video', 'image', 'audio'].includes(asset.kind) ? asset.kind : 'video'
    normalizedAssets.push({ ...asset, id, path: asset.path, name: typeof asset.name === 'string' && asset.name ? asset.name : asset.path.split(/[\\/]/).pop(),
      kind, source: ['local', 'download', 'tts', 'ai'].includes(asset.source) ? asset.source : 'local', missing: !!asset.missing,
      metadata: asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata) ? asset.metadata : null })
  }
  return normalizedAssets
}

// Chuan hoa noi dung mot timeline (clip, overlay, track, phu de, thong so xuat)
function normalizeTimeline(migrated, makeId) {
  const clips = Array.isArray(migrated.clips) ? migrated.clips : DEFAULTS.clips
  const rawOverlays = Array.isArray(migrated.overlays) ? migrated.overlays : DEFAULTS.overlays
  // Emoji chu cu co sticker thi chuyen sang V2; emoji khong co sticker va cac overlay khac giu nguyen
  const legacyStickers = rawOverlays.filter((item) => item?.type === 'emoji' && stickerIdForChar(item.text))
  const overlays = rawOverlays.filter((item) => !legacyStickers.includes(item))
  const videoOverlays = [...(Array.isArray(migrated.videoOverlays) ? migrated.videoOverlays : DEFAULTS.videoOverlays), ...legacyStickers.map(legacyEmojiToSticker)]
  const audioItems = Array.isArray(migrated.audioItems) ? migrated.audioItems : []
  const captions = Array.isArray(migrated.captions) ? migrated.captions : DEFAULTS.captions

  const normalizedClips = clips.map((clip, index) => {
    if (!clip || typeof clip !== 'object' || typeof clip.path !== 'string' || !clip.path.trim()) {
      throw new Error(`Project không hợp lệ: clips[${index}].path`)
    }
    const kind = clip.kind === 'image' ? 'image' : 'video'
    const speed = finite(clip.speed ?? 1, `clips[${index}].speed`, { min: 0.05, max: 16 })
    const input = kind === 'image' ? 0 : finite(clip.in ?? 0, `clips[${index}].in`, { min: 0 })
    const output = finite(clip.out ?? (kind === 'image' ? 3 : input + 0.1), `clips[${index}].out`, { min: input + 0.001 })
    const cropMode = clip.cropMode ?? 'fit'
    if (!['fit', 'fill'].includes(cropMode)) throw new Error(`Project không hợp lệ: clips[${index}].cropMode`)
    return {
      ...clip,
      id: typeof clip.id === 'string' && clip.id ? clip.id : makeId('clip', index),
      kind,
      in: input,
      out: output,
      speed: kind === 'image' ? 1 : speed,
      cropMode,
      audioDetached: kind === 'video' && !!clip.audioDetached,
      audioMuted: kind === 'video' && !!clip.audioMuted,
      volume: kind === 'video' ? finite(clip.volume ?? 1, `clips[${index}].volume`, { min: 0, max: 2 }) : 1,
      enhance: !!clip.enhance,
      cropX: finite(clip.cropX ?? 0.5, `clips[${index}].cropX`, { min: 0, max: 1 }),
      cropY: finite(clip.cropY ?? 0.5, `clips[${index}].cropY`, { min: 0, max: 1 }),
      name: typeof clip.name === 'string' && clip.name ? clip.name : clip.path.split(/[\\/]/).pop(),
      missing: !!clip.missing
    }
  })
  const clipIds = new Set()
  for (const clip of normalizedClips) {
    if (clipIds.has(clip.id)) throw new Error(`Project có clip trùng ID: ${clip.id}`)
    clipIds.add(clip.id)
  }
  const normalizedOverlays = overlays.map((overlay, index) => {
    if (!overlay || typeof overlay !== 'object') throw new Error(`Project không hợp lệ: overlays[${index}]`)
    const start = finite(overlay.start ?? 0, `overlays[${index}].start`, { min: 0 })
    const end = finite(overlay.end ?? start + 3, `overlays[${index}].end`, { min: start + 0.001 })
    return { ...overlay, id: overlay.id || makeId('overlay', index), start, end,
      x: finite(overlay.x ?? 0.5, `overlays[${index}].x`, { min: 0, max: 1 }),
      y: finite(overlay.y ?? 0.5, `overlays[${index}].y`, { min: 0, max: 1 }),
      size: finite(overlay.size ?? 0.07, `overlays[${index}].size`, { min: 0.005, max: 1 }),
      align: ['left', 'center', 'right'].includes(overlay.align) ? overlay.align : 'center',
      zIndex: finite(overlay.zIndex ?? index + 1, `overlays[${index}].zIndex`, { min: 0, max: 10000 }) }
  })
  const normalizedVideoOverlays = videoOverlays.map((item, index) => {
    const sticker = item && typeof item === 'object' && item.sticker ? item.sticker : null
    if (sticker && !STICKER_ID.test(sticker)) throw new Error(`Project không hợp lệ: videoOverlays[${index}].sticker`)
    if (!item || typeof item !== 'object' || (!sticker && (typeof item.path !== 'string' || !item.path.trim()))) {
      throw new Error(`Project không hợp lệ: videoOverlays[${index}].path`)
    }
    const kind = (sticker || item.kind === 'image') ? 'image' : 'video'
    const start = finite(item.start ?? 0, `videoOverlays[${index}].start`, { min: 0 })
    const input = kind === 'image' ? 0 : finite(item.in ?? 0, `videoOverlays[${index}].in`, { min: 0 })
    const output = finite(item.out ?? (kind === 'image' ? 3 : input + 0.1), `videoOverlays[${index}].out`, { min: input + 0.001 })
    return {
      ...item, id: item.id || makeId('video-overlay', index), kind, path: sticker ? '' : item.path, start, in: input, out: output,
      speed: kind === 'image' ? 1 : finite(item.speed ?? 1, `videoOverlays[${index}].speed`, { min: 0.05, max: 16 }),
      x: finite(item.x ?? 0.5, `videoOverlays[${index}].x`, { min: 0, max: 1 }),
      y: finite(item.y ?? 0.5, `videoOverlays[${index}].y`, { min: 0, max: 1 }),
      width: finite(item.width ?? 1, `videoOverlays[${index}].width`, { min: 0.001, max: 4 }),
      height: finite(item.height ?? 1, `videoOverlays[${index}].height`, { min: 0.001, max: 4 }),
      opacity: finite(item.opacity ?? 1, `videoOverlays[${index}].opacity`, { min: 0, max: 1 }),
      rotation: finite(item.rotation ?? 0, `videoOverlays[${index}].rotation`, { min: -360, max: 360 }), flipH: !!item.flipH, flipV: !!item.flipV,
      fadeIn: finite(item.fadeIn ?? 0, `videoOverlays[${index}].fadeIn`, { min: 0, max: 60 }), fadeOut: finite(item.fadeOut ?? 0, `videoOverlays[${index}].fadeOut`, { min: 0, max: 60 }),
      zIndex: finite(item.zIndex ?? index, `videoOverlays[${index}].zIndex`), missing: !!item.missing
    }
  })
  const normalizedAudioItems = audioItems.map((item, index) => {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !item.path.trim()) {
      throw new Error(`Project không hợp lệ: audioItems[${index}].path`)
    }
    const track = ['voice', 'music', 'original'].includes(item.track) ? item.track : null
    if (!track) throw new Error(`Project không hợp lệ: audioItems[${index}].track`)
    const start = finite(item.start ?? 0, `audioItems[${index}].start`, { min: 0 })
    const sourceIn = finite(item.in ?? 0, `audioItems[${index}].in`, { min: 0 })
    const sourceOut = finite(item.out ?? sourceIn + 0.1, `audioItems[${index}].out`, { min: sourceIn + 0.001 })
    return { ...item, id: item.id || makeId('audio', index), track, start, in: sourceIn, out: sourceOut,
      speed: finite(item.speed ?? 1, `audioItems[${index}].speed`, { min: 0.05, max: 16 }),
      gain: finite(item.gain ?? 1, `audioItems[${index}].gain`, { min: 0, max: 4 }),
      pan: finite(item.pan ?? 0, `audioItems[${index}].pan`, { min: -1, max: 1 }),
      fadeIn: finite(item.fadeIn ?? 0, `audioItems[${index}].fadeIn`, { min: 0 }),
      fadeOut: finite(item.fadeOut ?? 0, `audioItems[${index}].fadeOut`, { min: 0 }),
      loop: !!item.loop, muted: !!item.muted, missing: !!item.missing }
  })
  const normalizedCaptions = captions.map((caption, index) => {
    if (!caption || typeof caption !== 'object' || typeof caption.text !== 'string') {
      throw new Error(`Project không hợp lệ: captions[${index}]`)
    }
    const start = finite(caption.start ?? 0, `captions[${index}].start`, { min: 0 })
    const end = finite(caption.end ?? start + 0.1, `captions[${index}].end`, { min: start + 0.001 })
    return { ...caption, id: caption.id || makeId('caption', index), start, end }
  })
  for (const [items, label] of [[normalizedOverlays, 'overlay'], [normalizedVideoOverlays, 'video overlay'], [normalizedAudioItems, 'audio'], [normalizedCaptions, 'caption']]) {
    const ids = new Set()
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`Project có ${label} trùng ID: ${item.id}`)
      ids.add(item.id)
    }
  }

  const ratio = migrated.ratio ?? DEFAULTS.ratio
  if (!['9:16', '1:1', '4:5', '16:9', 'original'].includes(ratio)) throw new Error('Project không hợp lệ: ratio')
  if (!['none', 'bright', 'warm', 'cool', 'vivid', 'bw', 'vintage'].includes(migrated.filterKey ?? DEFAULTS.filterKey)) throw new Error('Project không hợp lệ: filterKey')
  if (!['none', 'fade', 'cross'].includes(migrated.transition ?? DEFAULTS.transition)) throw new Error('Project không hợp lệ: transition')
  // Kieu xfade chi dung khi transition = cross; project cu/kieu la thi ve mac dinh (hoa tan)
  const transitionStyle = TRANSITION_STYLES.some((item) => item.id === migrated.transitionStyle) ? migrated.transitionStyle : DEFAULT_TRANSITION_STYLE
  const transitionDuration = finite(migrated.transitionDuration ?? DEFAULTS.transitionDuration, 'transitionDuration', { min: 0.1, max: 2 })
  const filterIntensity = finite(migrated.filterIntensity ?? DEFAULTS.filterIntensity, 'filterIntensity', { min: 0, max: 100 })
  const silenceSource = migrated.silenceParams || {}
  const silenceParams = {
    threshold: finite(silenceSource.threshold ?? -30, 'silenceParams.threshold', { min: -60, max: -10 }),
    minSilence: finite(silenceSource.minSilence ?? 0.4, 'silenceParams.minSilence', { min: 0.1, max: 5 }),
    pad: finite(silenceSource.pad ?? 0.06, 'silenceParams.pad', { min: 0, max: 1 })
  }
  // Moc tren thuoc thoi gian: thoi diem >= 0, ten ngan; sap theo thoi gian, bo muc hong
  const markerIds = new Set()
  const normalizedMarkers = (Array.isArray(migrated.markers) ? migrated.markers : [])
    .filter((marker) => marker && typeof marker === 'object' && Number.isFinite(Number(marker.time)) && Number(marker.time) >= 0)
    .map((marker, index) => {
      let id = typeof marker.id === 'string' && marker.id ? marker.id : makeId('marker', index)
      if (markerIds.has(id)) id = makeId('marker', index)
      markerIds.add(id)
      return { id, time: Number(marker.time), name: typeof marker.name === 'string' ? marker.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '' }
    })
    .sort((a, b) => a.time - b.time)
  const captionTimebase = migrated.captionTimebase || 'timeline'
  if (!['timeline', 'timeline-legacy', 'source-legacy'].includes(captionTimebase)) throw new Error('Project không hợp lệ: captionTimebase')
  let keepSegments = null
  if (migrated.keepSegments != null) {
    if (!Array.isArray(migrated.keepSegments)) throw new Error('Project không hợp lệ: keepSegments')
    const source = normalizedClips.length === 1 ? normalizedClips[0] : null
    keepSegments = migrated.keepSegments.map((range, index) => {
      const start = finite(range?.start, `keepSegments[${index}].start`, { min: source?.in ?? 0 })
      const end = finite(range?.end, `keepSegments[${index}].end`, { min: start + 0.001, max: source?.out ?? Infinity })
      return { start, end }
    })
  }
  let autoInfo = null
  if (migrated.autoInfo?.duration != null) {
    const sourceInfo = migrated.autoInfo
    const duration = finite(sourceInfo.duration, 'autoInfo.duration', { min: 0.001 })
    const silences = Array.isArray(sourceInfo.silences) ? sourceInfo.silences.map((silence, index) => ({
      start: finite(silence?.start, `autoInfo.silences[${index}].start`, { min: 0, max: duration }),
      end: finite(silence?.end, `autoInfo.silences[${index}].end`, { min: 0, max: duration }),
      remove: silence?.remove !== false
    })) : []
    if (silences.some((silence) => silence.end < silence.start)) throw new Error('Project không hợp lệ: autoInfo.silences')
    const ranges = (value, label) => Array.isArray(value) ? value.map((range, index) => {
      const start = finite(range?.start, `${label}[${index}].start`, { min: 0, max: duration })
      const end = finite(range?.end, `${label}[${index}].end`, { min: start + 0.001, max: duration })
      return { start, end }
    }) : []
    const opts = sourceInfo.options || {}
    autoInfo = { duration, silences, keep: ranges(sourceInfo.keep, 'autoInfo.keep'),
      ...(typeof sourceInfo.sourceKey === 'string' ? { sourceKey: sourceInfo.sourceKey } : {}),
      removed: finite(sourceInfo.removed ?? silences.length, 'autoInfo.removed', { min: 0 }),
      saved: finite(sourceInfo.saved ?? 0, 'autoInfo.saved', { min: 0, max: duration }),
      kept: finite(sourceInfo.kept ?? 0, 'autoInfo.kept', { min: 0, max: duration }),
      options: { noise: String(opts.noise || '-30dB'), minSilence: finite(opts.minSilence ?? 0.4, 'autoInfo.options.minSilence', { min: 0.1, max: 5 }),
        pad: finite(opts.pad ?? 0.06, 'autoInfo.options.pad', { min: 0, max: 1 }) } }
  }

  // v5: moi item phu/audio thuoc mot track; du an cu duoc xep track theo thu tu thoi gian, va cham thi sang track ke tiep
  const usedTrackIds = [...normalizedVideoOverlays, ...normalizedAudioItems].map((item) => item.trackId).filter(Boolean)
  const assigned = assignDefaultTracks({ tracks: normalizeTracks(migrated.tracks, usedTrackIds),
    videoItems: normalizedVideoOverlays, audioItems: normalizedAudioItems })
  const tracks = normalizeTracks(assigned.tracks, [...assigned.videoItems, ...assigned.audioItems].map((item) => item.trackId))

  return {
    ...pickTimelineFields(DEFAULTS),
    ...pickTimelineFields(migrated),
    ratio,
    filterIntensity,
    transitionStyle,
    transitionDuration,
    clips: normalizedClips,
    overlays: normalizedOverlays,
    tracks,
    videoOverlays: withLayerZIndex(assigned.videoItems, tracks),
    audioItems: assigned.audioItems,
    captions: normalizedCaptions,
    captionTimebase,
    keepSegments,
    silenceParams,
    markers: normalizedMarkers,
    autoCut: !!migrated.autoCut,
    autoInfo
  }
}

export function normalizeProject(input, makeId = defaultId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('File dự án phải chứa một object JSON.')
  const migrated = migrateLegacy(input)
  // Never copy credentials from an imported file into the current project.
  delete migrated.apiKey
  delete migrated.googleTtsKey
  delete migrated.googleTtsKeyEnc
  const rawTimelines = Array.isArray(migrated.timelines) && migrated.timelines.length ? migrated.timelines : [{}]
  if (rawTimelines.length > MAX_TIMELINES) throw new Error(`Project không hợp lệ: tối đa ${MAX_TIMELINES} timeline`)
  rawTimelines.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Project không hợp lệ: timelines[${index}]`)
  })
  const assets = normalizeAssets(migrated, rawTimelines, makeId)
  const content = rawTimelines.map((raw) => normalizeTimeline(raw, makeId))
  const projectId = migrated.projectId || makeId('project', 0)
  // Id timeline duoc cap sau cung de khong doi id cua cac thuc the khac
  const ids = new Set()
  const timelines = rawTimelines.map((raw, index) => {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : makeId('timeline', index)
    if (ids.has(id)) throw new Error(`Project có timeline trùng ID: ${id}`)
    ids.add(id)
    return { id, name: cleanTimelineName(raw.name, `Timeline ${index + 1}`), ...content[index] }
  })
  return {
    ...migrated,
    version: PROJECT_VERSION,
    projectId,
    assets,
    activeTimelineId: ids.has(migrated.activeTimelineId) ? migrated.activeTimelineId : timelines[0].id,
    timelines
  }
}

// Timeline dang mo (hoac timeline dau tien) cua mot du an da chuan hoa
export function activeTimeline(project) {
  return project.timelines.find((timeline) => timeline.id === project.activeTimelineId) || project.timelines[0]
}

export { PROJECT_VERSION }
