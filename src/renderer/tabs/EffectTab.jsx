import React, { useState } from 'react'
import { ImageIcon, ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { fileUrl } from '../utils.js'

const BG_COLORS = ['#00c853', '#3a7afe', '#ffd600', '#ff4081', '#ffffff', '#000000']

function Sec({ id, title, acc, setAcc, children }) {
  const on = !!acc[id]
  return (
    <div className={`acc ${on ? 'open' : ''}`}>
      <button className="acc-head" onClick={() => setAcc((a) => ({ ...a, [id]: !a[id] }))}>
        {on ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>{title}</span>
      </button>
      {on && <div className="acc-body">{children}</div>}
    </div>
  )
}

// Tab Hieu ung: doi nen (RVM) + doi khuon mat (insightface), ca hai chay local (ONNX).
// Ap dung cho CLIP VIDEO dang chon; ket qua thay clip trong timeline (undo duoc).
export default function EffectTab({
  hasClips, selectedClip, selIsImage,
  aiBusy, aiStatus, aiModelStatus, ensureAiModel, cancelAiOperation, applyReplaceBg, previewReplaceBg, pickBgImage,
  aiPreviewPath, aiPreviewStart, setAiPreviewStart, aiPreviewDuration, setAiPreviewDuration, aiProcWidth, setAiProcWidth,
  faceBusy, faceStatus, cancelFaceOperation, applyFaceSwap, previewFaceSwap, facePreviewPath, pickFaceImage
}) {
  const { t } = useI18n()
  const [acc, setAcc] = useState({ bg: true, face: false })
  // --- doi nen ---
  const [mode, setMode] = useState('blur')
  const [color, setColor] = useState('#00c853')
  const [img, setImg] = useState(null)
  // --- doi mat ---
  const [faceImg, setFaceImg] = useState(null)
  const [consent, setConsent] = useState(false)
  const [faceModelTermsAccepted, setFaceModelTermsAccepted] = useState(false)

  const ready = !!selectedClip && !selIsImage
  const busy = aiBusy || faceBusy
  const canBg = ready && !busy && (mode !== 'image' || !!img)
  const bg = mode === 'color' ? { type: 'color', color } : mode === 'image' ? { type: 'image', path: img } : { type: 'blur' }
  const canFace = ready && !busy && !!faceImg && consent && faceModelTermsAccepted

  return (
    <div className="cc-cap">
      {!ready && <small className="cap-hint">⚠ {hasClips ? (selIsImage ? t('ai_bg_video_only') : t('select_clip')) : t('drop_title')}</small>}

      <Sec id="bg" title={t('ai_bg_title')} acc={acc} setAcc={setAcc}>
        <small className="cap-hint">{t('ai_bg_hint')}</small>
        <small className="cap-hint">{t('ai_rvm_label')}: {aiModelStatus?.state === 'cached' ? t('ai_state_cached') : aiModelStatus?.state === 'bundled' ? t('ai_state_bundled') : aiModelStatus?.state === 'not-cached' ? t('ai_state_missing') : t('ai_state_checking')}{aiModelStatus?.bytes ? ` · ${(aiModelStatus.bytes / 1e6).toFixed(1)} MB` : ''}</small>
        <button className="cc-mini" onClick={ensureAiModel} disabled={busy || aiModelStatus?.available}>{aiModelStatus?.available ? t('ai_model_ready') : t('ai_model_download')}</button>
        {aiBusy && <button className="cc-mini" onClick={cancelAiOperation}>{t('ai_cancel_bg')}</button>}
        <label className="vlbl">{t('ai_proc_quality')}</label>
        <select className="cc-select" value={aiProcWidth} onChange={(event) => setAiProcWidth(Number(event.target.value))} disabled={busy}>
          <option value={384}>{t('ai_q_fast')} · 384 px</option><option value={640}>{t('ai_q_balanced')} · 640 px</option><option value={960}>{t('ai_q_detail')} · 960 px</option>
        </select>
        {ready && <>
          <div className="key-row">
            <label>{t('ai_preview_from')} <input type="number" min={selectedClip.in} max={Math.max(selectedClip.in, selectedClip.out - 1)} step="0.1" value={aiPreviewStart} disabled={busy}
              onChange={(event) => setAiPreviewStart(Math.max(selectedClip.in, Math.min(selectedClip.out - 1, Number(event.target.value) || selectedClip.in)))} /></label>
            <label>{t('ai_preview_len')} <select value={aiPreviewDuration} disabled={busy} onChange={(event) => setAiPreviewDuration(Number(event.target.value))}><option value={1}>1s</option><option value={2}>2s</option><option value={3}>3s</option></select></label>
          </div>
          <button className="cc-mini" onClick={() => previewReplaceBg(bg)} disabled={busy || selectedClip.out - selectedClip.in < 1}>{t('ai_build_preview')}</button>
          {aiPreviewPath && <video className="face-preview" src={fileUrl(aiPreviewPath)} controls preload="metadata" />}
        </>}
        <label className="vlbl">{t('ai_bg_mode')}</label>
        <div className="seg">
          <button className={mode === 'blur' ? 'on' : ''} onClick={() => setMode('blur')} disabled={busy}>{t('ai_bg_blur')}</button>
          <button className={mode === 'color' ? 'on' : ''} onClick={() => setMode('color')} disabled={busy}>{t('ai_bg_color')}</button>
          <button className={mode === 'image' ? 'on' : ''} onClick={() => setMode('image')} disabled={busy}>{t('ai_bg_image')}</button>
        </div>
        {mode === 'color' && (
          <div className="key-row" style={{ alignItems: 'center' }}>
            {BG_COLORS.map((c) => (
              <button key={c} className="swatch" style={{ background: c, outline: color === c ? '2px solid #3a7afe' : 'none' }}
                onClick={() => setColor(c)} disabled={busy} title={c} />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={busy} />
          </div>
        )}
        {mode === 'image' && (
          <button className="cc-import" onClick={async () => { const p = await pickBgImage(); if (p) setImg(p) }} disabled={busy}>
            <ImageIcon size={14} /> {img ? img.split(/[\\/]/).pop() : t('ai_bg_pick')}
          </button>
        )}
        <button className="cc-auto" disabled={!canBg} onClick={() => applyReplaceBg(bg)}>
          {aiBusy ? (aiStatus || '...') : t('ai_bg_apply')}
        </button>
        {!aiBusy && aiStatus && <small className="cap-hint">{aiStatus}</small>}
        <small className="cap-hint">{t('ai_local_hint')}</small>
      </Sec>

      <Sec id="face" title={t('face_title')} acc={acc} setAcc={setAcc}>
        <small className="cap-hint">{t('face_hint')}</small>
        <label className="vlbl">{t('face_source')}</label>
        <button className="cc-import" onClick={async () => { const p = await pickFaceImage(); if (p) setFaceImg(p) }} disabled={busy}>
          <ImageIcon size={14} /> {faceImg ? faceImg.split(/[\\/]/).pop() : t('face_pick')}
        </button>
        {faceImg && <img className="face-preview" src={fileUrl(faceImg)} alt="" />}
        <label className="chk consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} /> {t('face_consent')}</label>
        <small className="cap-hint">{t('face_model_license_hint')}</small>
        <label className="chk consent"><input type="checkbox" checked={faceModelTermsAccepted} onChange={(e) => setFaceModelTermsAccepted(e.target.checked)} disabled={busy} /> {t('face_model_license_accept')}</label>
        {ready && <>
          <div className="key-row">
            <label>{t('ai_preview_from')} <input type="number" min={selectedClip.in} max={Math.max(selectedClip.in, selectedClip.out - 1)} step="0.1" value={aiPreviewStart} disabled={busy}
              onChange={(event) => setAiPreviewStart(Math.max(selectedClip.in, Math.min(selectedClip.out - 1, Number(event.target.value) || selectedClip.in)))} /></label>
            <label>{t('ai_preview_len')} <select value={aiPreviewDuration} disabled={busy} onChange={(event) => setAiPreviewDuration(Number(event.target.value))}><option value={1}>1s</option><option value={2}>2s</option><option value={3}>3s</option></select></label>
          </div>
          <button className="cc-mini" onClick={() => previewFaceSwap(faceImg)} disabled={busy || !faceImg || !consent || !faceModelTermsAccepted || selectedClip.out - selectedClip.in < 1}>{t('face_build_preview')}</button>
          {facePreviewPath && <video className="face-preview" src={fileUrl(facePreviewPath)} controls preload="metadata" />}
        </>}
        <button className="cc-auto" disabled={!canFace} onClick={() => applyFaceSwap(faceImg)}>
          {faceBusy ? (faceStatus || '...') : t('face_apply')}
        </button>
        {faceBusy && <button className="cc-mini" onClick={cancelFaceOperation}>{t('face_cancel')}</button>}
        {!faceBusy && faceStatus && <small className="cap-hint">{faceStatus}</small>}
        <small className="cap-hint">{t('face_dl_hint')}</small>
        <small className="cap-hint">⚠ {t('face_ai_label')}</small>
      </Sec>
    </div>
  )
}
