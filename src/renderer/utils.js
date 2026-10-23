// Hang so + helper dung chung giua App va cac tab
import {
  Film, Music, Type, Smile, Sparkles, ArrowLeftRight, SlidersHorizontal
} from 'lucide-react'
import FILTER_PRESETS from '../shared/filter-presets.json'

export function fmt(t) {
  if (!t || t < 0) t = 0
  const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * 30)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}
// URL cho media cuc bo: giao thuc taoclip-media:// do main process phuc vu (xem electron/main.cjs); khong dung file:// vi dev (http://localhost) bi chan
export const fileUrl = (p) => 'taoclip-media://local/' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const FRAME = 1 / 30
export const SPEEDS = [0.5, 1, 1.5, 2, 4]
export const SLIDE_DURS = [2, 3, 4, 5]
export const RE_VIDEO = /\.(mp4|mov|mkv|avi|webm|m4v)$/i
export const RE_IMAGE = /\.(jpe?g|png|webp|bmp|gif)$/i
export const RE_AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i
export const isImg = (c) => c && c.kind === 'image'
export const clipOut = (c) => (c.out - c.in) / (c.speed || 1)
export function filterPreviewCss(key, intensity = 100) {
  const preset = FILTER_PRESETS.find((item) => item.k === key) || FILTER_PRESETS[0]
  const amount = clamp(Number(intensity) || 0, 0, 100) / 100
  return preset.css.map(([name, delta]) => {
    if (name === 'hue-rotate') return `hue-rotate(${delta * amount}deg)`
    if (name === 'sepia' || name === 'grayscale') return `${name}(${delta * amount})`
    const value = 1 + delta * amount
    return `${name}(${value})`
  }).join(' ') || 'none'
}
export const FILTERS = FILTER_PRESETS.map((preset) => ({ ...preset, css: filterPreviewCss(preset.k, 100) }))
export const TABS = [
  { k: 'media', Icon: Film }, { k: 'audio', Icon: Music }, { k: 'text', Icon: Type },
  { k: 'sticker', Icon: Smile }, { k: 'effect', Icon: Sparkles }, { k: 'trans', Icon: ArrowLeftRight }, { k: 'filter', Icon: SlidersHorizontal }
]
