// Mo hinh thuan cho nhieu timeline trong mot du an: moi timeline la mot "tap phim" co noi dung rieng
// (clip, overlay, track, phu de, thong so xuat), con thu vien media (assets) dung chung.

// Moi truong thuoc ve rieng tung timeline; phan con lai (assets, projectId...) la cua ca du an.
export const TIMELINE_KEYS = Object.freeze([
  'ratio', 'filterKey', 'filterIntensity', 'mode', 'captions', 'burnCaptions', 'overlays', 'videoOverlays', 'audioItems', 'tracks',
  'transition', 'transitionStyle', 'transitionDuration', 'watermark', 'clips', 'ducking', 'origVolume', 'syncMode', 'slideDur',
  'ttsEngine', 'ttsVoice', 'ttsRate', 'ttsPitch', 'aiEdited', 'keepSegments', 'autoCut', 'autoInfo', 'silenceParams', 'captionTimebase', 'markers'
])

export const MAX_TIMELINES = 12
export const MAX_NAME_LENGTH = 60

export function pickTimelineFields(source) {
  const out = {}
  for (const key of TIMELINE_KEYS) if (source && source[key] !== undefined) out[key] = source[key]
  return out
}

export function cleanTimelineName(value, fallback) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
  return name || fallback
}

// "Timeline 1", "Timeline 2", ...: so nho nhat chua duoc dung (khong dung length + 1 vi tab o giua co the da bi xoa)
export function nextTimelineName(timelines, prefix = 'Timeline') {
  const used = new Set((timelines || []).map((timeline) => timeline.name))
  for (let n = 1; n <= (timelines?.length || 0) + 1; n++) if (!used.has(`${prefix} ${n}`)) return `${prefix} ${n}`
  return `${prefix} ${(timelines?.length || 0) + 1}`
}

// Ten cho ban sao: "Ten (2)", "Ten (3)"...
export function copyTimelineName(timelines, name) {
  const used = new Set((timelines || []).map((timeline) => timeline.name))
  const base = String(name || 'Timeline').replace(/ \(\d+\)$/, '')
  for (let n = 2; n < 1000; n++) {
    const candidate = cleanTimelineName(`${base} (${n})`, `${base} (${n})`)
    if (!used.has(candidate)) return candidate
  }
  return `${base} (copy)`
}

// Sau khi xoa tab `id`: tab nao duoc chon. Giu tab dang mo neu khong bi xoa, neu khong thi tab ke ben (uu tien ben trai).
export function activeAfterRemove(timelines, removedId, activeId) {
  if (removedId !== activeId) return activeId
  const index = timelines.findIndex((timeline) => timeline.id === removedId)
  const rest = timelines.filter((timeline) => timeline.id !== removedId)
  return (rest[Math.max(0, index - 1)] || rest[0] || null)?.id ?? null
}

export function moveTimeline(timelines, id, toIndex) {
  const from = timelines.findIndex((timeline) => timeline.id === id)
  if (from < 0) return timelines
  const clamped = Math.max(0, Math.min(timelines.length - 1, toIndex))
  if (clamped === from) return timelines
  const next = timelines.slice()
  const [moved] = next.splice(from, 1)
  next.splice(clamped, 0, moved)
  return next
}

function mediaKey(value) { return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }

// Cac duong dan media ma noi dung mot timeline (dang file hoac snapshot) dang dung
export function referencedPaths(timeline) {
  const paths = new Set()
  for (const list of [timeline?.clips, timeline?.videoOverlays, timeline?.audioItems]) {
    for (const item of list || []) if (item?.path) paths.add(mediaKey(item.path))
  }
  return paths
}

// Undo/redo khoi phuc thu vien cua thoi diem snapshot. Thu vien dung chung nhieu timeline, nen mot media
// con duoc timeline KHAC dung thi khong duoc bien mat chi vi hoan tac trong tab nay.
export function libraryAfterRestore(restoredAssets, currentAssets, otherTimelines) {
  const restored = Array.isArray(restoredAssets) ? restoredAssets : []
  const keep = new Set()
  for (const timeline of otherTimelines || []) for (const key of referencedPaths(timeline)) keep.add(key)
  const have = new Set(restored.map((asset) => mediaKey(asset.path)))
  const extra = (currentAssets || []).filter((asset) => !have.has(mediaKey(asset.path)) && keep.has(mediaKey(asset.path)))
  return extra.length ? [...restored, ...extra] : restored
}

// Tong thoi luong (giay) cua mot timeline dang file: V1 noi duoi nhau (tru chuyen canh) hoac item phu dai nhat.
// Chi de hien thi tren tab; tinh gan dung, khong thay buildTimelinePlan.
export function approxTimelineDuration(timeline) {
  const clips = (timeline?.clips || []).reduce((sum, clip) => {
    const length = clip.kind === 'image' ? (clip.out ?? 0) : Math.max(0, (clip.out - clip.in) / Math.max(0.05, clip.speed || 1))
    return sum + length
  }, 0)
  const tail = (list, length) => (list || []).reduce((max, item) => Math.max(max, (item.start || 0) + length(item)), 0)
  const overlays = tail(timeline?.videoOverlays, (item) => (item.out - item.in) / Math.max(0.05, item.speed || 1))
  const audio = tail(timeline?.audioItems, (item) => (item.out - item.in) / Math.max(0.05, item.speed || 1))
  return Math.max(clips, overlays, audio)
}
