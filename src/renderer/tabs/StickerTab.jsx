import React from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

const EMOJIS = ['😀', '😂', '😍', '😎', '🥰', '😱', '🤔', '👍', '👏', '🙌', '🔥', '✨', '⭐', '❤️', '💯', '🎉', '🎬', '📌', '✅', '❌', '⚡', '💡', '🚀', '🏆']

// Tab Sticker: luoi emoji + danh sach sticker da them
export default function StickerTab({ hasClips, overlays, selOv, setSelOv, addEmoji, updateOverlay, delOverlay, moveOverlayLayer = () => {}, setOverlayBoundaryAtPlayhead = () => {}, seekGlobal, current, beginEdit = () => {}, endEdit = () => {} }) {
  const { t } = useI18n()
  return (
    <div className="cc-cap">
      <label className="grp-lbl">{t('sticker_pick')}</label>
      <div className="emoji-grid">
        {EMOJIS.map((em) => (
          <button key={em} className="emoji-btn" onClick={() => addEmoji(em)} disabled={!hasClips}>{em}</button>
        ))}
      </div>
      <div className="cap-list">
        {overlays.filter((o) => o.type === 'emoji').map((o) => (
          <div key={o.id} className={`ov-row ${selOv === o.id ? 'on' : ''}`} onClick={() => { setSelOv(o.id); seekGlobal(o.start) }}>
            <span className="ov-em">{o.text}</span>
            <button className="cap-del" onClick={(e) => { e.stopPropagation(); delOverlay(o.id) }}><X size={13} /></button>
            <div className="ov-sub">
              <span>{t('ov_size')}</span><input type="range" min={0.05} max={0.4} step={0.01} value={o.size} onMouseDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { size: Number(e.target.value) })} />
              <label>X % <input type="number" min="0" max="100" step="0.1" value={(o.x * 100).toFixed(1)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { x: Number(e.target.value) / 100 })} /></label>
              <label>Y % <input type="number" min="0" max="100" step="0.1" value={(o.y * 100).toFixed(1)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { y: Number(e.target.value) / 100 })} /></label>
              <label>{t('ov_in_s')} <input type="number" min="0" step="0.01" value={o.start.toFixed(2)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { start: Number(e.target.value) })} /></label>
              <label>{t('ov_out_s')} <input type="number" min="0" step="0.01" value={o.end.toFixed(2)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { end: Number(e.target.value) })} /></label>
              <button onClick={(e) => { e.stopPropagation(); moveOverlayLayer(o.id, 1) }}>{t('layer_up')}</button>
              <button onClick={(e) => { e.stopPropagation(); moveOverlayLayer(o.id, -1) }}>{t('layer_down')}</button>
              <button onClick={(e) => { e.stopPropagation(); setOverlayBoundaryAtPlayhead(o.id, 'start') }}>⏱{t('trim_in')}</button>
              <button onClick={(e) => { e.stopPropagation(); setOverlayBoundaryAtPlayhead(o.id, 'end') }}>⏱{t('trim_out')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
