import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { fileUrl } from '../utils.js'
import { DEFAULT_WATERMARK } from '../project-model.js'
import { LOGO_PRESETS, logoPresetUrl } from '../logo-presets.js'

// Luoi 3x3 vi tri: [anchorX, anchorY, mui ten]; 0 trai/tren, 0.5 giua, 1 phai/duoi
const ANCHORS = [[0, 0, '↖'], [0.5, 0, '↑'], [1, 0, '↗'], [0, 0.5, '←'], [0.5, 0.5, '•'], [1, 0.5, '→'], [0, 1, '↙'], [0.5, 1, '↓'], [1, 1, '↘']]

// SVG (base64) -> PNG (base64) de luu vao thu vien; canh dai toi da 1024 px
function svgToPngBase64(base64) {
  return new Promise((resolve, reject) => {
    const bytes = Uint8Array.from(window.atob(base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || 512, height = img.naturalHeight || 512
        const scale = Math.min(1, 1024 / Math.max(width, height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(width * scale))
        canvas.height = Math.max(1, Math.round(height * scale))
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png').split(',')[1])
      } catch (error) { reject(error) } finally { URL.revokeObjectURL(url) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg')) }
    img.src = url
  })
}

// Tab Logo (duoi tab Sticker): thu vien logo cua nguoi dung va watermark hien suot video
export default function LogoTab({ watermark, patchWatermark, pushHistory, beginEdit, endEdit, notify }) {
  const { t } = useI18n()
  const [library, setLibrary] = useState([])
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const wm = watermark || DEFAULT_WATERMARK

  useEffect(() => {
    window.taoclip.logoList().then(setLibrary).catch(() => {})
  }, [])

  // Kiem tra file logo con ton tai (chi khi duong dan thay doi)
  useEffect(() => {
    if (!wm.path) { setMissing(false); return undefined }
    let alive = true
    window.taoclip.probe(wm.path).then(() => alive && setMissing(false)).catch(() => alive && setMissing(true))
    return () => { alive = false }
  }, [wm.path])

  async function addLogo() {
    if (busy) return
    setBusy(true)
    try {
      const picked = await window.taoclip.logoPick()
      if (!picked) return
      let pngBase64 = picked.base64
      if (picked.ext === 'svg') {
        try { pngBase64 = await svgToPngBase64(picked.base64) } catch { notify(t('logo_svg_error'), 'err'); return }
      }
      const entry = await window.taoclip.logoSave({ name: picked.name, pngBase64 })
      setLibrary((items) => [...items, entry])
      notify(t('logo_saved'))
    } catch (error) {
      notify(error.message || String(error), 'err')
    } finally {
      setBusy(false)
    }
  }

  function useLogo(entry) {
    pushHistory()
    patchWatermark({ path: entry.path, name: entry.name, enabled: true })
  }

  // Mau co san: main sao chep vao thu vien (mot ban cho moi mau) roi dung nhu logo cua nguoi dung
  async function usePresetLogo(preset) {
    try {
      const entry = await window.taoclip.logoUsePreset(preset.id)
      setLibrary((items) => (items.some((item) => item.id === entry.id) ? items : [...items, entry]))
      useLogo(entry)
    } catch (error) {
      notify(error.message || String(error), 'err')
    }
  }

  async function removeLogo(entry) {
    if (!window.confirm(t('logo_remove_confirm'))) return
    try {
      await window.taoclip.logoRemove(entry.id)
      setLibrary((items) => items.filter((item) => item.id !== entry.id))
      if (wm.path === entry.path) { pushHistory(); patchWatermark({ path: '', name: '', enabled: false }) }
    } catch (error) {
      notify(error.message || String(error), 'err')
    }
  }

  return (
    <div className="cc-cap">
      <label className="grp-lbl">{t('logo_library')}</label>
      <button className="cc-import" onClick={addLogo} disabled={busy}>{t('logo_add')}</button>
      {library.length === 0 ? <small className="cap-hint">{t('logo_empty')}</small> : (
        <div className="logo-grid">
          {library.map((entry) => (
            <div key={entry.id} className={`logo-card ${wm.path === entry.path ? 'on' : ''}`}>
              <button className="logo-pick" title={entry.name} onClick={() => useLogo(entry)}>
                <img src={fileUrl(entry.path)} alt={entry.name} draggable={false} />
              </button>
              <button className="logo-del" title={t('logo_remove')} onClick={() => removeLogo(entry)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      <label className="grp-lbl">{t('logo_presets')}</label>
      <div className="logo-grid">
        {LOGO_PRESETS.map((preset) => (
          <div key={preset.id} className="logo-card">
            <button className="logo-pick" title={`${t(`logo_shape_${preset.shape}`)} · ${t(`logo_color_${preset.color}`)}`} onClick={() => usePresetLogo(preset)}>
              <img src={logoPresetUrl(preset.id)} alt="" draggable={false} />
            </button>
          </div>
        ))}
      </div>
      <small className="cap-hint">{t('logo_presets_hint')}</small>

      <div className="grp" style={{ marginTop: 6 }}>
        <label className="chk"><input type="checkbox" checked={!!wm.enabled && !!wm.path} disabled={!wm.path} onChange={(e) => { pushHistory(); patchWatermark({ enabled: e.target.checked }) }} /> {t('logo_watermark_on')}</label>
        {!wm.path && <small className="cap-hint">{t('logo_pick_first')}</small>}
        {missing && <small className="cap-hint warn">{t('logo_missing')}</small>}
        <small className="cap-hint">{t('logo_hint')}</small>

        <label style={{ marginTop: 10 }}>{t('logo_position')}</label>
        <div className="crop-anchors">
          {ANCHORS.map(([ax, ay, arrow]) => {
            const on = wm.anchorX === ax && wm.anchorY === ay
            return <button key={`${ax}-${ay}`} className={on ? 'on' : ''} title={t('logo_position')} aria-pressed={on}
              onClick={() => { pushHistory(); patchWatermark({ anchorX: ax, anchorY: ay }) }}>{arrow}</button>
          })}
        </div>

        <label style={{ marginTop: 10 }}>{t('logo_size')} <b>{Math.round(wm.size * 100)}%</b></label>
        <input type="range" min="0.02" max="0.5" step="0.01" value={wm.size} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => patchWatermark({ size: Number(e.target.value) })} />
        <label style={{ marginTop: 6 }}>{t('logo_margin')} <b>{Math.round(wm.margin * 100)}%</b></label>
        <input type="range" min="0" max="0.2" step="0.005" value={wm.margin} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => patchWatermark({ margin: Number(e.target.value) })} />
        <label style={{ marginTop: 6 }}>{t('logo_opacity')} <b>{Math.round(wm.opacity * 100)}%</b></label>
        <input type="range" min="0.1" max="1" step="0.01" value={wm.opacity} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => patchWatermark({ opacity: Number(e.target.value) })} />
        <label style={{ marginTop: 6 }}>{t('logo_fade_in')} <b>{wm.fadeIn.toFixed(1)}s</b></label>
        <input type="range" min="0" max="3" step="0.1" value={wm.fadeIn} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => patchWatermark({ fadeIn: Number(e.target.value) })} />
        <label style={{ marginTop: 6 }}>{t('logo_fade_out')} <b>{wm.fadeOut.toFixed(1)}s</b></label>
        <input type="range" min="0" max="3" step="0.1" value={wm.fadeOut} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => patchWatermark({ fadeOut: Number(e.target.value) })} />
      </div>
    </div>
  )
}
