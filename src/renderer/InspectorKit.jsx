import React, { useRef } from 'react'
import { RotateCcw } from 'lucide-react'
import { useI18n } from './i18n.jsx'

const clampTo = (value, min, max) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value))

// Bo thanh phan dung chung cho bang thuoc tinh (Inspector.jsx, ItemInspector.jsx): tieu de, tab, nhom, o so, thanh truot, cong tac.
// Moi chinh sua van di qua beginEdit / endEdit de mot lan keo hoac nhap = mot buoc hoan tac.

// Tieu de co dinh: icon loai, ten, loai + duong, nut thao tac nhanh
export function PropHeader({ icon: Icon, name, nameTitle, kind, track, children }) {
  return (
    <div className="ip-head">
      <div className="ip-thumb" aria-hidden="true"><Icon size={20} /></div>
      <div className="ip-id">
        <div className="ip-name" title={nameTitle || name}>{name}</div>
        <div className="ip-sub"><span>{kind}</span>{track ? <span className="ip-track">{track}</span> : null}</div>
      </div>
      <div className="ip-acts">{children}</div>
    </div>
  )
}

export function IconBtn({ icon: Icon, title, onClick, pressed, act, disabled }) {
  return (
    <button type="button" className={`ip-ib ${pressed ? 'on' : ''}`} title={title} aria-label={title} data-act={act} disabled={disabled}
      aria-pressed={pressed === undefined ? undefined : !!pressed} onClick={onClick}>
      <Icon size={15} />
    </button>
  )
}

// Tab co icon; chi tab dang chon duoc dung (noi dung tab khac khong render)
export function PropTabs({ tabs, active, onChange }) {
  return (
    <div className="ip-tabs" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="tab" data-tab={id} aria-selected={active === id} className={active === id ? 'on' : ''} onClick={() => onChange(id)}>
          <Icon size={15} /><span>{label}</span>
        </button>
      ))}
    </div>
  )
}

// Nhom co tieu de nho + nut dat lai (neu co)
export function Section({ title, onReset, resetTitle, children }) {
  const { t } = useI18n()
  return (
    <section className="ip-sect">
      <h4><span>{title}</span>{onReset ? <button type="button" className="ip-reset" title={resetTitle || t('ip_reset')} aria-label={resetTitle || t('ip_reset')} onClick={onReset}><RotateCcw size={12} /></button> : null}</h4>
      {children}
    </section>
  )
}

export const Grid = ({ children }) => <div className="ip-grid">{children}</div>

// O so gon: nhan ngan + don vi nam trong o. Keo nhan sang trai / phai de chinh nhanh (moi pixel = mot buoc `step`).
// Chi nhan so hop le; go dang do (rong) khong doi gia tri.
export function Field({ prefix, unit, title, value, min, max, step = 0.1, scrub = true, onChange, beginEdit, endEdit, disabled, readOnly, text, testId }) {
  const { t } = useI18n()
  const drag = useRef(null)
  const latest = useRef(null)
  latest.current = { onChange, min, max, step, endEdit, decimals: step < 0.1 ? 3 : step < 1 ? 2 : 1 }
  // Theo doi keo bang listener tren window (khong dung pointer capture) nen con tro ra khoi nhan van chinh tiep
  const onDown = (event) => {
    if (disabled || readOnly || !scrub || event.button !== 0) return
    event.preventDefault()
    const start = Number(value)
    const state = { x: event.clientX, start: Number.isFinite(start) ? start : 0, moved: false }
    drag.current = state
    beginEdit?.()
    const move = (e) => {
      const dx = e.clientX - state.x
      if (!state.moved && Math.abs(dx) < 3) return
      state.moved = true
      const { onChange: change, min: lo, max: hi, step: unit, decimals } = latest.current
      change(Number(clampTo(state.start + Math.round(dx) * unit, lo, hi).toFixed(decimals)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      latest.current.endEdit?.()
      // 'click' den ngay sau pointerup: neu vua keo thi khong de nhan chuyen focus vao o
      setTimeout(() => { drag.current = null }, 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  if (text !== undefined) { // o chi doc hien chu (vd. do dai co the la "Lap")
    return (
      <label className="ip-f ro" title={title}>
        <b>{prefix}</b>
        <input type="text" readOnly value={text} aria-label={title || prefix} data-prop={testId} tabIndex={-1} />
        {unit ? <em>{unit}</em> : null}
      </label>
    )
  }
  return (
    <label className={`ip-f ${readOnly ? 'ro' : ''}`} title={title} onClick={(event) => { if (drag.current?.moved) event.preventDefault() }}>
      <b className={scrub && !readOnly ? 'scrub' : ''} onPointerDown={onDown}>{prefix}</b>
      <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} readOnly={readOnly} data-prop={testId}
        aria-label={title || prefix} title={scrub && !readOnly ? t('ip_scrub_hint') : undefined}
        onFocus={beginEdit} onBlur={endEdit}
        onChange={(event) => {
          if (event.target.value === '') return
          const parsed = Number(event.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }} />
      {unit ? <em>{unit}</em> : null}
    </label>
  )
}

// Thanh truot: nhan o tren, gia tri hien o goc phai cung dong
export function SliderRow({ label, display, value, min, max, step, onChange, beginEdit, endEdit, testId }) {
  return (
    <div className="ip-sl">
      <span>{label}</span><em>{display}</em>
      <input type="range" min={min} max={max} step={step} value={value} data-prop={testId} aria-label={label}
        onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}

// Cong tac bat / tat: van la o kiem that (checked / click nhu cu) nhung ve dang cong tac
export function Toggle({ label, checked, onChange, testId, icon: Icon }) {
  return (
    <label className="ip-sw">
      <span>{Icon ? <Icon size={14} /> : null}{label}</span>
      <span className="ip-tg"><input type="checkbox" role="switch" checked={checked} data-prop={testId} onChange={(event) => onChange(event.target.checked)} /><i /></span>
    </label>
  )
}

// Hang chip chon nhanh (toc do...): chip dang chon sang xanh, bam lai khong lam gi
export function Chips({ options, unit = '×', isOn, onPick }) {
  return (
    <div className="ip-chips">
      {options.map((option) => (
        <button key={option} type="button" className={isOn(option) ? 'on' : ''} aria-pressed={isOn(option)} onClick={() => onPick(option)}>{option}{unit}</button>
      ))}
    </div>
  )
}

export const Hint = ({ children }) => <small className="cap-hint ip-hint">{children}</small>

export const KV = ({ label, value }) => <div className="ip-kv"><span>{label}</span><b>{value}</b></div>
