import React from 'react'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { useI18n } from './i18n.jsx'
import { fmt, isImg, clipOut, SPEEDS, SLIDE_DURS } from './utils.js'

// Vi tri nhanh cua hinh trong khung kieu Fill: [cropX, cropY, mui ten chi phan hinh dang hien]
const CROP_ANCHORS = [[0, 0, '↖'], [0.5, 0, '↑'], [1, 0, '↗'], [0, 0.5, '←'], [0.5, 0.5, '•'], [1, 0.5, '→'], [0, 1, '↙'], [0.5, 1, '↓'], [1, 1, '↘']]

// Bang thuoc tinh ben phai: ti le khung, clip dang chon, che do xuat,
// chuyen canh, GPU, auto-cut, xuat them ti le
export default function Inspector({
  width, hasClips, single, ratio, setRatio, safeZone, setSafeZone,
  selectedClip, moveClip, deleteClip, updateClip, pushHistory, beginEdit, endEdit, setAllSlideDur,
  onDetectSilence, busy, canDetectSilence, autoInfo, autoCut, setAutoCut, status,
  silenceParams, updateSilenceAnalysis, applySilenceAnalysis, onPreviewSilence, silenceStale
}) {
  const { t } = useI18n()
  const style = width ? { width } : undefined
  if (!hasClips) return <aside className="cc-insp" style={style}><div className="cc-soon"><div className="big">⚙️</div>{t('select_clip')}<small>{t('props_here')}</small></div></aside>
  return (
    <aside className="cc-insp" style={style}>
      <div className="sec-title">{t('clip_props')}</div>
      <div className="grp">
        <label>{t('aspect')}</label>
        <div className="seg wrap">
          {['9:16', '1:1', '4:5', '16:9', 'original'].map((r) => (<button key={r} className={ratio === r ? 'on' : ''} onClick={() => setRatio(r)}>{r === 'original' ? t('ratio_original') : r}</button>))}
        </div>
        <label className="chk"><input type="checkbox" checked={safeZone} onChange={(e) => setSafeZone(e.target.checked)} /> {t('safezone')}</label>
          <small className="cap-hint">{t('safezone_hint')}</small>
      </div>

      {selectedClip && (
        <div className="grp">
          <label>{t('clip_selected')}: <b>{selectedClip.name}</b></label>
          <div className="seg"><button onClick={() => moveClip(selectedClip.id, -1)} title={t('move_left')}><ChevronLeft size={15} /></button><button onClick={() => moveClip(selectedClip.id, 1)} title={t('move_right')}><ChevronRight size={15} /></button><button onClick={() => deleteClip(selectedClip.id)} title={t('del_clip')}><Trash2 size={15} /></button></div>
          {isImg(selectedClip) ? (
            <>
              <label style={{ marginTop: 8 }}>{t('slide_dur')} <b>{clipOut(selectedClip).toFixed(1)}s</b></label>
              <div className="seg wrap">{SLIDE_DURS.map((s) => <button key={s} className={Math.abs(clipOut(selectedClip) - s) < 0.05 ? 'on' : ''} disabled={Math.abs(clipOut(selectedClip) - s) < 0.05} onClick={() => { pushHistory(); updateClip(selectedClip.id, { in: 0, out: s }) }}>{s}s</button>)}</div>
              <input type="range" min={0.5} max={15} step={0.5} value={clipOut(selectedClip)} onChange={(e) => updateClip(selectedClip.id, { in: 0, out: Number(e.target.value) })} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} />
              <button className="cc-auto" onClick={() => setAllSlideDur(clipOut(selectedClip))}>{t('apply_all')}</button>
              <label className="chk"><input type="checkbox" checked={selectedClip.kenBurns !== false} onChange={(e) => { pushHistory(); updateClip(selectedClip.id, { kenBurns: e.target.checked }) }} /> {t('kenburns')}</label>
            </>
          ) : (
            <>
              <label style={{ marginTop: 8 }}>{t('speed')} <b>{(selectedClip.speed || 1).toFixed(2)}×</b></label>
              <div className="seg wrap">{SPEEDS.map((s) => <button key={s} className={selectedClip.speed === s ? 'on' : ''} disabled={selectedClip.speed === s} onClick={() => { pushHistory(); updateClip(selectedClip.id, { speed: s }) }}>{s}×</button>)}</div>
              <label className="num-field"><span>{t('speed')} (×)</span><input type="number" min="0.05" max="16" step="0.05" value={selectedClip.speed || 1} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => {
                if (e.target.value === '') return
                const value = Number(e.target.value)
                if (Number.isFinite(value) && value >= 0.05 && value <= 16) updateClip(selectedClip.id, { speed: value })
              }} /></label>
              <label className="num-field"><span>{t('trim_in')} (s)</span><input type="number" min="0" max={Math.max(0, selectedClip.out - 0.1)} step="0.01" value={selectedClip.in} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => {
                if (e.target.value === '') return
                const value = Number(e.target.value)
                if (Number.isFinite(value) && value >= 0 && value <= selectedClip.out - 0.1) updateClip(selectedClip.id, { in: value })
              }} /></label>
              <label className="num-field"><span>{t('trim_out')} (s)</span><input type="number" min={selectedClip.in + 0.1} max={selectedClip.src?.duration || selectedClip.out} step="0.01" value={selectedClip.out} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => {
                if (e.target.value === '') return
                const value = Number(e.target.value)
                const max = selectedClip.src?.duration || selectedClip.out
                if (Number.isFinite(value) && value >= selectedClip.in + 0.1 && value <= max) updateClip(selectedClip.id, { out: value })
              }} /></label>
              <div className="kv"><span>{t('trim_len')}</span><b>{fmt(clipOut(selectedClip))}</b></div>
            </>
          )}
          <label style={{ marginTop: 10 }}>{t('crop_mode_title')}</label>
          <div className="seg"><button className={(selectedClip.cropMode || 'fit') === 'fit' ? 'on' : ''} disabled={(selectedClip.cropMode || 'fit') === 'fit'} onClick={() => { pushHistory(); updateClip(selectedClip.id, { cropMode: 'fit' }) }}>{t('crop_fit')}</button>
            <button className={selectedClip.cropMode === 'fill' ? 'on' : ''} disabled={selectedClip.cropMode === 'fill'} onClick={() => { pushHistory(); updateClip(selectedClip.id, { cropMode: 'fill' }) }}>{t('crop_fill')}</button></div>
          {selectedClip.cropMode === 'fill' ? <>
            <label style={{ marginTop: 10 }}>{t('crop_anchor')}</label>
            <div className="crop-anchors">
              {CROP_ANCHORS.map(([ax, ay, arrow]) => {
                const cx = selectedClip.cropX ?? 0.5, cy = selectedClip.cropY ?? 0.5
                const on = Math.abs(cx - ax) < 0.005 && Math.abs(cy - ay) < 0.005
                return <button key={`${ax}-${ay}`} className={on ? 'on' : ''} title={t('crop_anchor')} aria-pressed={on}
                  onClick={() => { pushHistory(); updateClip(selectedClip.id, { cropX: ax, cropY: ay }) }}>{arrow}</button>
              })}
            </div>
            <label style={{ marginTop: 10 }}>{t('crop_cx')} <b>{Math.round((selectedClip.cropX ?? 0.5) * 100)}%</b></label>
            <input type="range" min="0" max="1" step="0.01" value={selectedClip.cropX ?? 0.5} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateClip(selectedClip.id, { cropX: Number(e.target.value) })} />
            <label style={{ marginTop: 6 }}>{t('crop_cy')} <b>{Math.round((selectedClip.cropY ?? 0.5) * 100)}%</b></label>
            <input type="range" min="0" max="1" step="0.01" value={selectedClip.cropY ?? 0.5} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(e) => updateClip(selectedClip.id, { cropY: Number(e.target.value) })} />
          </> : <small className="cap-hint">{t('crop_pos_fit_hint')}</small>}
        </div>
      )}

      {single && (
        <div className="grp">
          <label>{t('auto')}</label>
          <label className="num-field"><span>{t('sil_threshold')}</span><input type="number" min="-60" max="-10" step="1" value={silenceParams.threshold} disabled={busy} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => updateSilenceAnalysis({ threshold: Math.min(-10, Math.max(-60, Number(event.target.value) || -30)) })} /> dB</label>
          <label className="num-field"><span>{t('sil_min')}</span><input type="number" min="0.1" max="5" step="0.1" value={silenceParams.minSilence} disabled={busy} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => updateSilenceAnalysis({ minSilence: Math.min(5, Math.max(0.1, Number(event.target.value) || 0.1)) })} /> s</label>
          <label className="num-field"><span>{t('sil_pad')}</span><input type="number" min="0" max="1" step="0.01" value={silenceParams.pad} disabled={busy} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => updateSilenceAnalysis({ pad: Math.min(1, Math.max(0, Number(event.target.value) || 0)) })} /> s</label>
          <button className="cc-auto" onClick={onDetectSilence} disabled={busy || !canDetectSilence}>{busy ? t('analyzing') : t('remove_silence')}</button>
          {autoInfo && <>
            <p className="cap-hint">{t('sil_summary', { kept: autoInfo.kept?.toFixed(2) ?? '0.00', cut: autoInfo.saved.toFixed(2), src: autoInfo.duration.toFixed(2) })}</p>
            {autoInfo.options && (autoInfo.options.noise !== `${silenceParams.threshold}dB` || autoInfo.options.minSilence !== silenceParams.minSilence) &&
              <small className="cap-hint">{t('sil_params_changed')}</small>}
            <small className="cap-hint">{t('sil_keeping')}: {autoInfo.keep?.length ? autoInfo.keep.map((range) => `${range.start.toFixed(2)}–${range.end.toFixed(2)}s`).join(' · ') : t('none_value')}</small>
            {autoInfo.keep?.map((range, index) => <button key={`keep-${index}`} className="cc-mini" onClick={() => onPreviewSilence?.(range.start)}>{t('sil_goto_keep', { n: index + 1 })} ({range.start.toFixed(2)}–{range.end.toFixed(2)}s)</button>)}
            {autoInfo.silences?.map((silence, index) => <div className="bg-box" key={`${silence.start}-${index}`}>
              <label className="chk"><input type="checkbox" checked={silence.remove !== false} onChange={(event) => { pushHistory(); updateSilenceAnalysis({ remove: event.target.checked }, index) }} /> {t('sil_remove_n', { n: index + 1 })}</label>
              <div className="key-row">
                <label>{t('sil_from')} <input type="number" min="0" max={autoInfo.duration} step="0.01" value={silence.start} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => updateSilenceAnalysis({ start: Math.max(0, Number(event.target.value) || 0) }, index)} /></label>
                <label>{t('sil_to')} <input type="number" min="0" max={autoInfo.duration} step="0.01" value={silence.end} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => updateSilenceAnalysis({ end: Math.max(silence.start, Number(event.target.value) || 0) }, index)} /></label>
                <button className="cc-mini" onClick={() => onPreviewSilence?.(silence.start)}>{t('sil_goto')}</button>
              </div>
            </div>)}
            {silenceStale && <small className="cap-hint">{t('sil_stale')}</small>}
            {!autoInfo.keep?.length && <small className="cap-hint">{t('sil_none_left')}</small>}
            <button className="cc-auto" disabled={!autoInfo.keep?.length || silenceStale || autoInfo.options?.noise !== `${silenceParams.threshold}dB` || autoInfo.options?.minSilence !== silenceParams.minSilence} onClick={applySilenceAnalysis}>{t('sil_apply')}</button>
            {autoCut && <label className="chk"><input type="checkbox" checked onChange={() => setAutoCut(false)} /> {t('sil_cutting')}</label>}
          </>}
        </div>
      )}

      {status && <p className="status">{status}</p>}
    </aside>
  )
}
