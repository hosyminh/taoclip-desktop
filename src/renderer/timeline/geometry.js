// Hang so hinh hoc chung cho timeline hai vung (khong phu thuoc React).
export const ASSET_DRAG_TYPE = 'application/x-taoclip-asset' // asset thu vien keo vao timeline (JSON {path, kind, name})
export const HEAD_W = 96 // be rong cot tieu de track (px); thoi diem t nam o x = HEAD_W + t * pps trong .cc-tlinner
export const TAIL_PX = 56 // doan dem sau cuoi timeline (< le cua fitPps de "Vua khung" van khong sinh thanh cuon ngang)
export const ROW_HEIGHT = { main: 64, overlay: 42, text: 32, audio: 44 }

// Thu phong: toi thieu 0.05 px/giay (3 gio vua ~540px) toi da 300 px/giay; moi nac nhan ZOOM_STEP de muc nao cung muot
export const PPS_MIN = 0.05
export const PPS_MAX = 300
export const ZOOM_STEP = 1.25
export const clampPps = (value) => Math.max(PPS_MIN, Math.min(PPS_MAX, value))

/** Muc thu phong (px/giay) de ca timeline vua khung nhin rong viewportWidth (da tru cot tieu de va le du cho nhan moc cuoi). */
export function fitPps(totalDuration, viewportWidth) {
  return clampPps((viewportWidth - HEAD_W - 60) / Math.max(0.001, totalDuration))
}

// Khoang cach moc thoi gian tren thuoc: buoc "dep" nho nhat de hai moc cach nhau >= TICK_MIN_GAP px
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
export const TICK_MIN_GAP = 100
export function tickStep(pps) {
  return TICK_STEPS.find((step) => step * pps >= TICK_MIN_GAP) ?? TICK_STEPS[TICK_STEPS.length - 1]
}
/** Nhan moc: 5s, 2:05, 1:05:00 (giay le chi co o muc phong to). */
export function tickLabel(seconds) {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/** Thoi gian (giay) tai toa do client X, tinh theo khung cuon cua timeline. */
export function clientXToTime(clientX, scrollEl, pps) {
  const rect = scrollEl.getBoundingClientRect()
  return (clientX - rect.left + scrollEl.scrollLeft - HEAD_W) / pps
}

/** Style anh song am (ca file) de chi lo ra doan in..out cua item audio, dung toc do; loop thi khong ve (doan lap). */
export function waveStyle(item, pps, url) {
  if (!url || item.loop) return null
  const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
  const source = Math.max(Number(item.sourceDuration) || 0, Number(item.out) || 0, 0.001)
  return { backgroundImage: `url(${url})`, backgroundSize: `${(source * pps) / speed}px 100%`, backgroundPosition: `${-((Number(item.in) || 0) * pps) / speed}px 0` }
}

export const THUMB_TILE_W = 64 // be rong toi da mot khung hinh thu nho tren item V2+ (px)

/**
 * Chi so cac khung (trong frameCount khung lay deu tren toan nguon) de lat len item rong `width` px:
 * moi o hien khung o giua doan nguon tuong ung, chi tinh phan in..out dang dung.
 */
export function thumbTiles(item, width, frameCount, tileWidth = THUMB_TILE_W, maxTiles = 48) {
  if (!frameCount || !(width > 0)) return []
  const count = Math.max(1, Math.min(maxTiles, Math.ceil(width / tileWidth)))
  const out = Number(item.out) || 0
  const source = Math.max(Number(item.sourceDuration) || 0, out, 0.001)
  const from = Math.max(0, Number(item.in) || 0)
  const span = Math.max(0.001, (out || source) - from)
  return Array.from({ length: count }, (_, i) => Math.min(frameCount - 1, Math.max(0, Math.floor(((from + ((i + 0.5) / count) * span) / source) * frameCount))))
}

/** Do dai item audio tren timeline (giay): loop keo toi het timeline, con lai theo toc do. */
export function audioItemLength(item, totalDuration) {
  if (item.loop) return Math.max(0, totalDuration - (Number(item.start) || 0))
  const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
  return Math.max(0, (Number(item.out) - Number(item.in || 0)) / speed)
}
