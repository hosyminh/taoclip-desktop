// Logic thuan (khong phu thuoc React) cho cac lenh tren clip / item cua timeline: tach, nhan ban, freeze frame, gop phu de.
export const MIN_PIECE = 0.05 // doan ngan nhat sau khi tach (giay)
export const FREEZE_SECONDS = 3 // thoi luong mac dinh cua khung hinh dung (freeze frame)

/**
 * Tach mot item phu (video/anh) hoac audio tai thoi diem `time` tren timeline. Tra ve [truoc, sau] hoac null neu tach khong hop le
 * (ngoai item, qua gan mep, hoac item loop). Anh: in = 0 va out = thoi luong; video/audio: in/out la thoi gian trong file nguon.
 */
export function splitTimelineItem(item, time, newId) {
  const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
  const start = Number(item.start) || 0
  const length = (Number(item.out) - Number(item.in || 0)) / speed
  const offset = time - start
  if (item.loop || !(length > 0) || offset <= MIN_PIECE || length - offset <= MIN_PIECE) return null
  const image = item.kind === 'image'
  const cut = (Number(item.in) || 0) + offset * speed
  const before = { ...item, out: image ? offset : cut, ...(item.fadeOut != null ? { fadeOut: 0 } : {}) }
  const after = { ...item, id: newId, start: time, in: image ? 0 : cut, out: image ? Number(item.out) - Number(item.in || 0) - offset : item.out,
    ...(item.fadeIn != null ? { fadeIn: 0 } : {}) }
  return [before, after]
}

/** Tach clip V1 (video) tai thoi diem NGUON `sourceTime`: [trai, phai]; null neu la anh hoac qua gan mep. */
export function splitClipSource(clip, sourceTime, newId, minPiece = 1 / 30) {
  if (!clip || clip.kind === 'image') return null
  if (!(sourceTime > clip.in + minPiece) || !(sourceTime < clip.out - minPiece)) return null
  return [{ ...clip, out: sourceTime }, { ...clip, id: newId, in: sourceTime }]
}

/** Chen khung hinh dung `freezeClip` vao giua clip `clipId` tai thoi diem nguon `sourceTime`. null neu khong tach duoc. */
export function insertFreezeFrame(clips, clipId, sourceTime, freezeClip, rightId) {
  const index = clips.findIndex((clip) => clip.id === clipId)
  if (index < 0) return null
  const pieces = splitClipSource(clips[index], sourceTime, rightId)
  if (!pieces) return null
  const next = [...clips.slice(0, index), pieces[0], freezeClip, pieces[1], ...clips.slice(index + 1)]
  return { clips: next, leftId: pieces[0].id, rightId, freezeId: freezeClip.id }
}

/** Nhan ban clip V1: ban sao nam ngay sau ban goc; tieng cua ban sao di kem ban sao (khong bi danh dau da tach). */
export function duplicateClipAfter(clips, clipId, newId) {
  const index = clips.findIndex((clip) => clip.id === clipId)
  if (index < 0) return null
  const copy = { ...clips[index], id: newId, audioDetached: false }
  return { clips: [...clips.slice(0, index + 1), copy, ...clips.slice(index + 1)], copy }
}

/** Tach phu de gan voi clip `clipId` tai diem nguon `splitSource`: phan sau chuyen sang clip `rightId`. */
export function splitAnchoredCaptions(items, clipId, splitSource, rightId) {
  return items.flatMap((item) => {
    if (item.clipId !== clipId || !Number.isFinite(item.sourceStart) || !Number.isFinite(item.sourceEnd)) return [item]
    const pieces = []
    if (item.sourceStart < splitSource) pieces.push({ ...item, sourceEnd: Math.min(item.sourceEnd, splitSource) })
    if (item.sourceEnd > splitSource) pieces.push({ ...item, id: pieces.length ? `${item.id}:split` : item.id, clipId: rightId, sourceStart: Math.max(item.sourceStart, splitSource) })
    return pieces
  })
}

/** Thay phu de cua mot clip bang ket qua moi, giu nguyen phu de cua clip khac / phu de thu cong, sap theo thoi gian. */
export function mergeClipCaptions(existing, fresh, clipId) {
  const kept = existing.filter((caption) => caption.clipId !== clipId)
  return [...kept, ...fresh].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0))
}

// ---- Xoa dan (ripple delete) mot doan [from, to) cua V1: cac lop khac lui theo ----

/** Thoi gian sau khi cat doan [from, to): truoc doan giu nguyen, trong doan ve from, sau doan lui (to - from). */
export function rippleTime(time, from, to) {
  return time < from ? time : time < to ? from : time - (to - from)
}

/**
 * Item (start + endOf(item)) khi xoa doan: nam tron trong doan -> bi xoa; con lai doi `start` theo rippleTime, giu nguyen do dai.
 * skip(item) = true (vd. track bi khoa) -> giu nguyen. Tra ve { items, removed: [id] }.
 */
export function rippleItems(items, from, to, endOf, skip = () => false) {
  const kept = [], removed = []
  for (const item of items) {
    if (skip(item)) { kept.push(item); continue }
    const start = Number(item.start) || 0
    if (start >= from - 1e-6 && endOf(item) <= to + 1e-6) { removed.push(item.id); continue }
    kept.push({ ...item, start: rippleTime(start, from, to) })
  }
  return { items: kept, removed }
}

/** Chu / sticker chu (start, end): ca hai dau theo rippleTime; qua ngan thi bi xoa. */
export function rippleOverlays(overlays, from, to, minLength = 0.05) {
  return overlays
    .map((overlay) => ({ ...overlay, start: rippleTime(overlay.start, from, to), end: rippleTime(overlay.end, from, to) }))
    .filter((overlay) => overlay.end - overlay.start >= minLength)
}
