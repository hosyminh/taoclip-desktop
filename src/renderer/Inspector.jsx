import React, { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useI18n } from './i18n.jsx'
import { ItemProps, ClipProps, MultiProps, TextProps } from './ItemInspector.jsx'
import { Section, Field } from './InspectorKit.jsx'

// Bang thuoc tinh ben phai: thuoc tinh cua muc dang chon (clip V1, lop hinh, tieng, chu) va auto-cut.
// Moi loai muc co tieu de co dinh + cac tab (ItemInspector.jsx, InspectorKit.jsx); tab dang chon duoc nho theo loai.
// Ti le khung / vung an toan la cai dat chung cua ca video nen o thanh duoi khung xem truoc (PreviewFormat.jsx).
export default function Inspector({
  width, hasClips, single,
  selectedClip, moveClip, deleteClip, updateClip, pushHistory, beginEdit, endEdit, setAllSlideDur,
  onDetectSilence, busy, canDetectSilence, autoInfo, autoCut, setAutoCut, status,
  silenceParams, updateSilenceAnalysis, applySilenceAnalysis, onPreviewSilence, silenceStale,
  selectedItem, selectedText, multiCount = 0, onUpdateItem, onRemoveItem, onDuplicateItem, onMultiDuplicate, onMultiMute, onMultiDelete, onOpenText
}) {
  const { t } = useI18n()
  const [tabs, setTabs] = useState({})
  const tabOf = (panel) => ({ tab: tabs[panel], setTab: (id) => setTabs((current) => ({ ...current, [panel]: id })) })
  const style = width ? { width } : undefined
  if (!hasClips) return <aside className="cc-insp" style={style}><div className="cc-soon"><div className="big">⚙️</div>{t('select_clip')}<small>{t('props_here')}</small></div></aside>
  const nothing = !(multiCount > 1 || selectedItem || selectedText || selectedClip)
  return (
    <aside className="cc-insp" style={style}>
      {multiCount > 1
        ? <MultiProps count={multiCount} onDuplicate={onMultiDuplicate} onMute={onMultiMute} onDelete={onMultiDelete} />
        : selectedItem
          ? <ItemProps key={`${selectedItem.kind}:${selectedItem.item.id}`} kind={selectedItem.kind} item={selectedItem.item} trackName={selectedItem.trackName}
            update={onUpdateItem} onRemove={onRemoveItem} onDuplicate={onDuplicateItem} beginEdit={beginEdit} endEdit={endEdit} pushHistory={pushHistory}
            {...tabOf(selectedItem.kind === 'audio' ? 'audio' : 'overlay')} />
          : selectedText
            ? <TextProps overlay={selectedText} onOpen={onOpenText} />
            : selectedClip
              ? <ClipProps clip={selectedClip} moveClip={moveClip} deleteClip={deleteClip} updateClip={updateClip} pushHistory={pushHistory}
                beginEdit={beginEdit} endEdit={endEdit} setAllSlideDur={setAllSlideDur} {...tabOf('clip')} />
              : null}

      {nothing && (
        <div className="ip-empty" data-inspector="none">
          <SlidersHorizontal size={26} aria-hidden="true" />
          <div className="sec-title">{t('clip_props')}</div>
          <small className="cap-hint">{t('ip_nothing')}</small>
        </div>
      )}

      {single && (
        <div className="ip-body ip-auto">
          <Section title={t('auto')}>
            <div className="ip-col">
              <Field prefix={t('sil_threshold')} unit="dB" value={silenceParams.threshold} min={-60} max={-10} step={1} disabled={busy} beginEdit={beginEdit} endEdit={endEdit}
                onChange={(value) => updateSilenceAnalysis({ threshold: Math.min(-10, Math.max(-60, value)) })} />
              <Field prefix={t('sil_min')} unit="s" value={silenceParams.minSilence} min={0.1} max={5} step={0.1} disabled={busy} beginEdit={beginEdit} endEdit={endEdit}
                onChange={(value) => updateSilenceAnalysis({ minSilence: Math.min(5, Math.max(0.1, value)) })} />
              <Field prefix={t('sil_pad')} unit="s" value={silenceParams.pad} min={0} max={1} step={0.01} disabled={busy} beginEdit={beginEdit} endEdit={endEdit}
                onChange={(value) => updateSilenceAnalysis({ pad: Math.min(1, Math.max(0, value)) })} />
            </div>
          </Section>
          <div className="grp">
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
        </div>
      )}

      {status && <p className="status ip-body">{status}</p>}
    </aside>
  )
}
