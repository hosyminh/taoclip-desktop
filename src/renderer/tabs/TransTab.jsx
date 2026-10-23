import React from 'react'
import { useI18n } from '../i18n.jsx'
import { DEFAULT_TRANSITION_STYLE, TRANSITION_STYLES } from '../transition-styles.js'

// Tab Chuyen canh: chon hieu ung noi giua cac clip (ap dung khi xuat >1 clip)
export default function TransTab({ clipCount, transition, setTransition, style = DEFAULT_TRANSITION_STYLE, setStyle, duration = 0.5, setDuration, beginEdit, endEdit, clampedCount = 0, effectiveMin = 0 }) {
  const { t } = useI18n()
  return (
    <div className="cc-cap">
      <label className="grp-lbl">{t('transition_label')}</label>
      <div className="seg vert">
        <button className={transition === 'none' ? 'on' : ''} onClick={() => setTransition('none')}>{t('trans_none')}</button>
        <button className={transition === 'fade' ? 'on' : ''} onClick={() => setTransition('fade')}>{t('trans_fade')}</button>
        <button className={transition === 'cross' ? 'on' : ''} onClick={() => setTransition('cross')}>{t('trans_cross')}</button>
      </div>
      {transition === 'cross' && <div className="grp">
        <label className="num-field"><span>{t('trans_style')}</span></label>
        <select className="cc-select" value={style} onChange={(event) => setStyle(event.target.value)}>
          {TRANSITION_STYLES.map((item) => <option key={item.id} value={item.id}>{t(item.key)}</option>)}
        </select>
      </div>}
      {transition !== 'none' && <div className="grp">
        <label className="num-field"><span>{t('trans_duration', { s: duration.toFixed(1) })}</span></label>
        <input type="range" min="0.1" max="2" step="0.1" value={duration} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit}
          onChange={(event) => setDuration(Number(event.target.value))} />
        <small className="cap-hint">{transition === 'cross' ? t('trans_cross_hint') : t('trans_fade_hint')}</small>
        {transition === 'cross' && clampedCount > 0 && <small className="cap-hint warn">{t('trans_clamped', { n: clampedCount, s: effectiveMin.toFixed(2) })}</small>}
      </div>}
      {clipCount < 2 && <small className="cap-hint">{t('trans_need_multi')}</small>}
    </div>
  )
}
