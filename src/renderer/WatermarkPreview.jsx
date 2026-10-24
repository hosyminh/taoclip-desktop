import React from 'react'
import { fileUrl } from './utils.js'

// Canh flex theo luoi 3x3: 0 = dau (trai/tren), 0.5 = giua, 1 = cuoi (phai/duoi)
const ALIGN = { 0: 'flex-start', 0.5: 'center', 1: 'flex-end' }

// Watermark tren preview, cung bo cuc voi khi xuat: o vuong canh size x canh ngan nhat khung, le margin,
// mo dan fadeIn o dau va fadeOut o cuoi video (total = thoi luong timeline). cqmin = 1% canh ngan nhat cua khung.
export default function WatermarkPreview({ wm, current, total }) {
  if (!wm || !wm.enabled || !wm.path || !(total > 0) || current < 0 || current >= total) return null
  let factor = 1
  if (wm.fadeIn > 0) factor = Math.min(factor, current / wm.fadeIn)
  if (wm.fadeOut > 0) factor = Math.min(factor, (total - current) / wm.fadeOut)
  const opacity = Number((wm.opacity * Math.max(0, Math.min(1, factor))).toFixed(3))
  return (
    <div style={{ position: 'absolute', inset: 0, containerType: 'size', pointerEvents: 'none', zIndex: 500 }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', boxSizing: 'border-box', padding: `calc(${wm.margin} * 100cqmin)`, justifyContent: ALIGN[wm.anchorX], alignItems: ALIGN[wm.anchorY] }}>
        <img src={fileUrl(wm.path)} alt="" draggable={false}
          style={{ flexShrink: 0, width: `calc(${wm.size} * 100cqmin)`, height: `calc(${wm.size} * 100cqmin)`, objectFit: 'contain', objectPosition: `${wm.anchorX * 100}% ${wm.anchorY * 100}%`, opacity }} />
      </div>
    </div>
  )
}
