import React from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { fmt } from '../utils.js'

// Tab Van ban: phu de tu dong (Whisper) + chu/tieu de overlay
export default function TextTab({
  hasClips, anyAudio, captions, setCaptions, capBusy, capStatus, capLang, setCapLang,
  burnCaptions, setBurnCaptions, activeCaption, genCaptions, editCaption, delCaption,
  updateCaption, splitCaption, mergeCaption, canMergeCaption = () => true, importSrt, exportSrt, captionAudioSource, setCaptionAudioSource, hasVoiceTracks,
  overlays, selOv, setSelOv, addText, updateOverlay, delOverlay, seekGlobal, current,
  moveOverlayLayer = () => {}, setOverlayBoundaryAtPlayhead = () => {}, canvasDuration = 0,
  beginEdit = () => {}, endEdit = () => {}, pushHistory = () => {}
}) {
  const { t } = useI18n()
  return (
    <div className="cc-cap">
      <button className="cc-import" onClick={genCaptions} disabled={!hasClips || capBusy || (captionAudioSource === 'voice' ? !hasVoiceTracks : !anyAudio)}>
        {capBusy ? capStatus || '...' : (captions.length ? t('cap_regenerate') : t('cap_generate'))}
      </button>
      {hasClips && (captionAudioSource === 'voice' ? !hasVoiceTracks : !anyAudio) && <small className="cap-warn">{captionAudioSource === 'voice' ? t('cap_no_voice_track') : t('cap_no_audio')}</small>}
      <div className="cap-lang">
        <label>{t('cap_lang')}</label>
        <select value={capLang} onChange={(e) => setCapLang(e.target.value)} disabled={capBusy}>
          <option value="vietnamese">{t('cap_lang_vi')}</option>
          <option value="english">{t('cap_lang_en')}</option>
          <option value="">{t('cap_lang_auto')}</option>
        </select>
      </div>
      {hasVoiceTracks && <div className="cap-lang"><label>{t('cap_source')}</label><select value={captionAudioSource} disabled={capBusy} onChange={(e) => setCaptionAudioSource(e.target.value)}>
        <option value="video">{t('cap_source_video')}</option><option value="voice">{t('cap_source_voice')}</option>
      </select></div>}
      <small className="cap-hint">{t('cap_hint')}</small>
      <div className="cap-head"><button className="cc-auto" onClick={importSrt}>{t('srt_import')}</button><button className="cc-auto" onClick={exportSrt} disabled={!captions.length}>{t('srt_export')}</button></div>
      {captions.length > 0 && (
        <>
          <label className="chk"><input type="checkbox" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} /> {t('cap_burn')}</label>
          <div className="cap-head"><span>{t('cap_count', { n: captions.length })}</span><button className="cap-clear" onClick={() => { pushHistory(); setCaptions([]) }}>{t('cap_clear')}</button></div>
          <div className="cap-list">
            {captions.map((c, i) => (
              <div key={c.id || i} className={`cap-row ${activeCaption === c ? 'on' : ''}`}>
                <span className="cap-t" onClick={() => seekGlobal(c.start)}>{fmt(c.start).slice(0, 5)}</span>
                <input value={c.text} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => editCaption(i, e.target.value)} />
                <label>{t('t_in_short')} <input type="number" min="0" step="0.01" value={c.start.toFixed(2)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateCaption(i, { start: Number(e.target.value) })} /></label>
                <label>{t('t_out_short')} <input type="number" min="0" step="0.01" value={c.end.toFixed(2)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateCaption(i, { end: Number(e.target.value) })} /></label>
                <button onClick={() => splitCaption(i)} disabled={current <= c.start + 0.05 || current >= c.end - 0.05} title={t('cap_split_tip')}>{t('cap_split')}</button>
                {i < captions.length - 1 && <button onClick={() => mergeCaption(i)} disabled={!canMergeCaption(i)} title={t('cap_merge_tip')}>{t('cap_merge')}</button>}
                <button className="cap-del" onClick={() => delCaption(i)}><X size={13} /></button>
              </div>
            ))}
          </div>
          {captions.slice().sort((a, b) => a.start - b.start).some((c, i, sorted) => c.start < 0 || c.end <= c.start || c.end > canvasDuration + 0.01 || (i > 0 && c.start < sorted[i - 1].end)) &&
            <small className="cap-warn">{t('cap_timing_warn')}</small>}
        </>
      )}
      <label className="grp-lbl">{t('ov_text_title')}</label>
      <button className="cc-auto" onClick={addText} disabled={!hasClips}>{t('ov_add_text')}</button>
      <div className="cap-list">
        {overlays.filter((o) => o.type === 'text').map((o) => (
          <div key={o.id} className={`ov-row ${selOv === o.id ? 'on' : ''}`} onClick={() => { setSelOv(o.id); seekGlobal(o.start) }}>
            <input value={o.text} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { text: e.target.value })} />
            <input type="color" value={o.color || '#ffffff'} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { color: e.target.value })} title={t('ov_color')} />
            <select value={o.align || 'center'} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { align: e.target.value })} aria-label={t('align_label')}>
              <option value="left">{t('align_left')}</option><option value="center">{t('align_center')}</option><option value="right">{t('align_right')}</option>
            </select>
            <button className="cap-del" onClick={(e) => { e.stopPropagation(); delOverlay(o.id) }}><X size={13} /></button>
            <div className="ov-sub">
              <span>{t('ov_size')}</span><input type="range" min={0.03} max={0.2} step={0.005} value={o.size} onMouseDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { size: Number(e.target.value) })} />
              <label>X % <input type="number" min="0" max="100" step="0.1" value={(o.x * 100).toFixed(1)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { x: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} /></label>
              <label>Y % <input type="number" min="0" max="100" step="0.1" value={(o.y * 100).toFixed(1)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { y: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })} /></label>
              <label>{t('ov_in_s')} <input type="number" min="0" step="0.01" value={o.start.toFixed(2)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { start: Number(e.target.value) })} /></label>
              <label>{t('ov_out_s')} <input type="number" min="0" step="0.01" value={o.end.toFixed(2)} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateOverlay(o.id, { end: Number(e.target.value) })} /></label>
              <button onClick={(e) => { e.stopPropagation(); moveOverlayLayer(o.id, 1) }}>{t('layer_up')}</button>
              <button onClick={(e) => { e.stopPropagation(); moveOverlayLayer(o.id, -1) }}>{t('layer_down')}</button>
              <button onClick={(e) => { e.stopPropagation(); setOverlayBoundaryAtPlayhead(o.id, 'start') }} title={t('ov_set_in')}>⏱{t('trim_in')}</button>
              <button onClick={(e) => { e.stopPropagation(); setOverlayBoundaryAtPlayhead(o.id, 'end') }} title={t('ov_set_out')}>⏱{t('trim_out')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
