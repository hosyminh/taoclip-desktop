import React from 'react'
import { Upload, X } from 'lucide-react'
import { useI18n } from './i18n.jsx'
import { fmt } from './utils.js'

// Hop thoai xuat video: gom cai dat xuat (ti le phu, che do, GPU, phu de)
// + man hinh tien do theo giai doan + nut huy
export default function ExportDialog({
  ratio, extraRatios, toggleExtra, mode, setMode, gpuEnc, useGpu, setUseGpu,
  quality = 'standard', setQuality = () => {}, resolution = '1080', setResolution = () => {},
  captionsCount, burnCaptions, setBurnCaptions, clipCount, totalDuration,
  hasBurnStage, hasAudioStage,
  exporting, progress, stage, status,
  onStart, onCancel, onClose
}) {
  const { t } = useI18n()
  const steps = [
    ['core', t('stage_core')],
    ...(hasBurnStage ? [['captions', t('stage_captions')]] : []),
    ...(hasAudioStage ? [['audio', t('stage_audio')]] : [])
  ]
  const stageIdx = Math.max(0, steps.findIndex(([k]) => k === stage))
  return (
    <div className="cc-modal" onClick={exporting ? undefined : onClose}>
      <div className="cc-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-head">
          <b>{t('export_title')}</b>
          {!exporting && <button className="cap-del" onClick={onClose}><X size={15} /></button>}
        </div>

        {!exporting ? (
          <>
            <div className="grp">
              <label>{t('export_ratio_main', { r: ratio === 'original' ? t('ratio_original') : ratio })}</label>
              <small className="cap-hint">{t('export_ratio_hint')}</small>
              <label className="vlbl">{t('extra_ratios')}</label>
              <div className="seg wrap">
                {['9:16', '1:1', '4:5', '16:9'].filter((r) => r !== ratio).map((r) => (
                  <button key={r} className={extraRatios.includes(r) ? 'on' : ''} onClick={() => toggleExtra(r)}>{r}</button>
                ))}
              </div>
              {extraRatios.length > 0 && <small>{t('will_export_n', { n: 1 + extraRatios.length })}</small>}
            </div>

            <div className="grp">
              <label>{t('export_mode')}</label>
              <div className="seg">
                <button className={mode === 'smart' ? 'on' : ''} onClick={() => setMode('smart')}>{t('mode_smart')}</button>
                <button className={mode === 'fast' ? 'on' : ''} onClick={() => setMode('fast')}>{t('mode_fast')}</button>
                <button className={mode === 'accurate' ? 'on' : ''} onClick={() => setMode('accurate')}>{t('mode_accurate')}</button>
              </div>
              {clipCount > 1 && <small>{t('multi_mode_note')}</small>}
            </div>

            <div className="grp">
              <label>{t('export_quality')}</label>
              <div className="seg">
                {['high', 'standard', 'small'].map((q) => (
                  <button key={q} className={quality === q ? 'on' : ''} onClick={() => setQuality(q)}>{t('quality_' + q)}</button>
                ))}
              </div>
              <label className="vlbl">{t('export_resolution')}</label>
              <div className="seg">
                {['720', '1080', '1440'].map((r) => (
                  <button key={r} className={resolution === r ? 'on' : ''} onClick={() => setResolution(r)} disabled={ratio === 'original' && extraRatios.length === 0}>{r}p</button>
                ))}
              </div>
              <small>{ratio === 'original' ? t('res_original_note') + ' ' : ''}{t('export_quality_note')}</small>
            </div>

            {gpuEnc !== 'cpu' && (
              <label className="chk"><input type="checkbox" checked={useGpu} onChange={(e) => setUseGpu(e.target.checked)} /> {t('gpu_using', { enc: gpuEnc.toUpperCase() })}</label>
            )}
            {captionsCount > 0 && (
              <label className="chk"><input type="checkbox" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} /> {t('export_burn_n', { n: captionsCount })}</label>
            )}

            <div className="exp-sum">{t('export_info', { n: clipCount, d: fmt(totalDuration) })}</div>
            <button className="cc-export exp-start" onClick={onStart}><Upload size={15} /> {t('export_start')}</button>
          </>
        ) : (
          <>
            <div className="exp-stages">
              {steps.map(([k, lb], i) => (
                <span key={k} className={i < stageIdx ? 'done' : i === stageIdx ? 'on' : ''}>{i < stageIdx ? '✓ ' : ''}{lb}</span>
              ))}
            </div>
            <div className="exp-bar"><div style={{ width: progress + '%' }} /></div>
            <div className="exp-pct">{progress}%</div>
            {status && <small className="cap-hint">{status}</small>}
            <button className="exp-cancel" onClick={onCancel}>{t('export_cancel')}</button>
          </>
        )}
      </div>
    </div>
  )
}
