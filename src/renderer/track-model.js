// ============================================================
//  Model track cho timeline hai vung (hinh o tren, am thanh o duoi). Toan ham thuan, khong phu thuoc React.
//
//  - Track video V1..Vn: V1 la track chinh (clips noi duoi nhau, xem timeline-plan.js); V2.. la track phu (videoOverlays).
//  - Track audio A1..An: A1 chua tieng goc cua clip V1 (khong luu, tinh tu timeline) va cac doan audio roi; A2.. chi chua doan audio.
//  - Moi item phu / audio mang `trackId`. Trong cung mot track khong cho chong nhau: neu va cham thi chon track ke tiep
//    (video: len tren, audio: xuong duoi) hoac tao track moi.
// ============================================================

export const MAIN_VIDEO_TRACK = 'V1'
export const MAIN_AUDIO_TRACK = 'A1'
const ID_PATTERN = /^([VA])(\d+)$/
const EPSILON = 1e-3

export function parseTrackId(id) {
  const match = ID_PATTERN.exec(String(id ?? ''))
  if (!match || Number(match[2]) < 1) return null
  return { kind: match[1] === 'V' ? 'video' : 'audio', number: Number(match[2]) }
}

export function makeTrack(kind, number, patch = {}) {
  const id = `${kind === 'video' ? 'V' : 'A'}${number}`
  return { id, kind, name: id, muted: false, hidden: false, locked: false, solo: false, ...patch, ...{ id, kind } }
}

// Moi timeline luon co san V1..V3 va A1..A3 (du de keo tha long nhau ngay, timeline mo ra gon); them duong bang nut +, bo duoc duong thua tu so 4
// (du an cu da luu V4 / A4 thi giu nguyen, khi trong thi co nut xoa)
export const MIN_LANES = 3
export const isCoreTrack = (id) => (parseTrackId(id)?.number ?? Infinity) <= MIN_LANES
export function defaultTracks() { return normalizeTracks([]) }

const byNumber = (a, b) => parseTrackId(a.id).number - parseTrackId(b.id).number
export const videoTracksOf = (tracks) => tracks.filter((track) => track.kind === 'video').sort(byNumber)
export const audioTracksOf = (tracks) => tracks.filter((track) => track.kind === 'audio').sort(byNumber)
export function trackById(tracks, id) { return tracks.find((track) => track.id === id) || null }

/** Gia tri hop le cua danh sach track: luon co V1..V3 va A1..A3, moi trackId dang duoc dung deu ton tai, sap xep V1..Vn roi A1..An. */
export function normalizeTracks(input, usedTrackIds = []) {
  const result = new Map()
  for (const raw of Array.isArray(input) ? input : []) {
    const parsed = parseTrackId(raw?.id)
    if (!parsed || result.has(raw.id)) continue
    result.set(raw.id, makeTrack(parsed.kind, parsed.number, {
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : `${parsed.kind === 'video' ? 'V' : 'A'}${parsed.number}`,
      muted: !!raw.muted, hidden: !!raw.hidden, locked: !!raw.locked, solo: !!raw.solo
    }))
  }
  const ensure = (id) => { const parsed = parseTrackId(id); if (parsed && !result.has(id)) result.set(id, makeTrack(parsed.kind, parsed.number)) }
  for (let number = 1; number <= MIN_LANES; number++) { ensure(`V${number}`); ensure(`A${number}`) }
  for (const id of usedTrackIds) ensure(id)
  const all = [...result.values()]
  return [...videoTracksOf(all), ...audioTracksOf(all)]
}

export function nextTrackNumber(tracks, kind) {
  return tracks.filter((track) => track.kind === kind).reduce((max, track) => Math.max(max, parseTrackId(track.id).number), 0) + 1
}

/** Chi so lop (0 = V1 duoi cung) cua track video; dung lam zIndex khi ghep. */
export function layerIndex(tracks, trackId) {
  const index = videoTracksOf(tracks).findIndex((track) => track.id === trackId)
  return index < 0 ? 0 : index
}

export function withLayerZIndex(videoItems, tracks) {
  return videoItems.map((item) => ({ ...item, zIndex: layerIndex(tracks, item.trackId) }))
}

/** Track audio nghe duoc: khong tat tieng va (neu co track solo) phai la track solo. */
export function audibleTrackIds(tracks) {
  const audio = audioTracksOf(tracks)
  const anySolo = audio.some((track) => track.solo)
  return new Set(audio.filter((track) => !track.muted && (!anySolo || track.solo)).map((track) => track.id))
}
export function visibleVideoTrackIds(tracks) {
  return new Set(videoTracksOf(tracks).filter((track) => !track.hidden).map((track) => track.id))
}

// ---------- Khoang thoi gian va va cham ----------

export function itemSpan(item, { totalDuration = 0 } = {}) {
  const start = Number(item.start) || 0
  const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
  let length = (Number(item.out) - Number(item.in || 0)) / speed
  if (!Number.isFinite(length) || length < 0) length = 0
  if (item.loop) length = Math.max(length, totalDuration - start)
  return { start, end: start + length }
}
export function spansOverlap(a, b) { return a.start < b.end - EPSILON && b.start < a.end - EPSILON }
export function spanIsFree(occupied, span) { return occupied.every((other) => !spansOverlap(other, span)) }

export function occupiedSpans(items, trackId, { excludeId = null, totalDuration = 0, extra = [] } = {}) {
  return [...items.filter((item) => item.trackId === trackId && item.id !== excludeId).map((item) => itemSpan(item, { totalDuration })), ...extra]
}

/**
 * Chon track cho mot item moi/di chuyen: uu tien `preferred`; neu va cham thi thu cac track ke tiep cung loai
 * (video: len tren, audio: xuong duoi); het thi tao track moi o cuoi.
 * extraByTrack: khoang bi chiem them (vd tieng goc cua V1 tren A1). forceNew: luon tao track moi.
 * Tra ve { trackId, created } voi created = track moi can them (hoac null).
 */
export function choosePlacement({ tracks, items, kind, preferred = null, span, excludeId = null, totalDuration = 0, extraByTrack = {}, forceNew = false }) {
  const candidates = (kind === 'video' ? videoTracksOf(tracks).filter((track) => track.id !== MAIN_VIDEO_TRACK) : audioTracksOf(tracks))
  const wanted = parseTrackId(preferred)
  if (!forceNew && wanted?.kind === kind && !tracks.some((track) => track.id === preferred) && preferred !== MAIN_VIDEO_TRACK) {
    return { trackId: preferred, created: makeTrack(kind, wanted.number) } // track duoc yeu cau chua ton tai -> tao dung track do
  }
  if (!forceNew) {
    let startIndex = candidates.findIndex((track) => track.id === preferred)
    if (startIndex < 0) startIndex = 0
    for (let i = startIndex; i < candidates.length; i++) {
      const track = candidates[i]
      if (track.locked) continue
      const occupied = occupiedSpans(items, track.id, { excludeId, totalDuration, extra: extraByTrack[track.id] || [] })
      if (spanIsFree(occupied, span)) return { trackId: track.id, created: null }
    }
  }
  const created = makeTrack(kind, nextTrackNumber(tracks, kind))
  return { trackId: created.id, created }
}

/** Gan track mac dinh cho item chua co trackId (du an cu): theo thu tu thoi gian, va cham thi sang track ke tiep. */
export function assignDefaultTracks({ tracks, videoItems = [], audioItems = [], totalDuration = 0 }) {
  let currentTracks = tracks
  const placedVideo = [], placedAudio = []
  const place = (item, kind, preferred, placed) => {
    const valid = parseTrackId(item.trackId)?.kind === kind && (kind !== 'video' || item.trackId !== MAIN_VIDEO_TRACK)
    if (valid) { placed.push(item); return }
    const { trackId, created } = choosePlacement({ tracks: currentTracks, items: placed, kind, preferred, span: itemSpan(item, { totalDuration }), totalDuration })
    if (created) currentTracks = normalizeTracks([...currentTracks, created])
    placed.push({ ...item, trackId })
  }
  const videoOrder = [...videoItems].sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0) || (Number(a.start) || 0) - (Number(b.start) || 0))
  for (const item of videoOrder) place(item, 'video', 'V2', placedVideo)
  const rolePreference = { original: 'A1', music: 'A2', voice: 'A2' }
  for (const item of audioItems) place(item, 'audio', rolePreference[item.track] || 'A2', placedAudio)
  const byId = (list) => new Map(list.map((item) => [item.id, item]))
  const videoById = byId(placedVideo), audioById = byId(placedAudio)
  return {
    tracks: currentTracks,
    videoItems: videoItems.map((item) => videoById.get(item.id) || item),
    audioItems: audioItems.map((item) => audioById.get(item.id) || item)
  }
}

// ---------- Mo vao / mo ra cua lop hinh ----------

/** He so trong suot (0..1) cua item tai thoi diem `time` theo fadeIn / fadeOut (giay); ngoai khoang item thi khong dung. */
export function fadeFactor(item, time) {
  const { start, end } = itemSpan(item)
  const fadeIn = Math.max(0, Number(item.fadeIn) || 0), fadeOut = Math.max(0, Number(item.fadeOut) || 0)
  let factor = 1
  if (fadeIn > 0) factor = Math.min(factor, (time - start) / fadeIn)
  if (fadeOut > 0) factor = Math.min(factor, (end - time) / fadeOut)
  return Math.max(0, Math.min(1, factor))
}

// ---------- Do tai: so lop hinh chong nhau ----------

export const MANY_LAYERS = 6 // tren muc nay (tinh ca V1) xuat va xem truoc se cham ro ret

/** So item chong nhau nhieu nhat tai mot thoi diem (item sat nhau khong tinh la chong). */
export function peakOverlap(items, { totalDuration = 0 } = {}) {
  const events = []
  for (const item of items) {
    const { start, end } = itemSpan(item, { totalDuration })
    if (end - start > EPSILON) events.push([start, 1], [end, -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0, peak = 0
  for (const [, delta] of events) { current += delta; if (current > peak) peak = current }
  return peak
}

// ---------- Clip V1 <-> tieng ----------

/** Khoang A1 bi chiem boi tieng goc cua cac clip V1 (chua tach). */
export function clipAudioSpans(layout) {
  return layout.filter((entry) => entry.clip?.src?.hasAudio && !entry.clip.audioDetached && !entry.clip.missing)
    .map((entry) => ({ start: entry.start, end: entry.end, clipId: entry.clipId }))
}

/** Doan audio doc lap tao ra khi "Tach am thanh" mot clip V1; giu nguyen in/out/toc do va vi tri tren timeline. */
export function buildDetachedAudioItem(clip, entry, id) {
  return {
    id, trackId: MAIN_AUDIO_TRACK, path: clip.path, name: `${clip.name || clip.path.split(/[\\/]/).pop()} ♪`, track: 'original',
    start: entry.start, in: clip.in, out: clip.out, speed: clip.speed || 1, sourceDuration: clip.src?.duration || clip.out,
    gain: 1, fadeIn: 0, fadeOut: 0, loop: false, muted: false, missing: !!clip.missing, sourceClipId: clip.id
  }
}

/** Vi tri chen vao V1 theo thoi diem tha (so clip co diem giua nho hon `time`). */
export function insertIndexForTime(layout, time) {
  return layout.filter((entry) => time > (entry.start + entry.end) / 2).length
}
