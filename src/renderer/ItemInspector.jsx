import React, { useState } from 'react'
import { Trash2, CopyPlus, VolumeX } from 'lucide-react'
import { useI18n } from './i18n.jsx'
import { fmt } from './utils.js'

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits
const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value))
// Dua goc ve khoang (-360, 360] sau khi cong tru 90 do
const normalizeAngle = (degrees) => (Math.abs(degrees) > 360 ? degrees % 360 : degrees)

// O so: chi nhan so hop le, go dang do (rong) khong doi gia tri; mot lan nhap = mot buoc hoan tac (begin / end)
function NumField({ label, value, min, max, step = 0.1, onChange, beginEdit, endEdit, disabled, testId }) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} data-prop={testId}
        onFocus={beginEdit} onBlur={endEdit}
        onChange={(event) => {
          if (event.target.value === '') return
          const parsed = Number(event.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }} />
    </label>
  )
}

// Bang thuoc tinh cua mot item tren V2+ (video, anh, sticker) hoac mot doan audio roi
export function ItemProps({ kind, item, trackName, update, onRemove, onDuplicate, beginEdit, endEdit, pushHistory }) {
  const { t } = useI18n()
  const [lockRatio, setLockRatio] = useState(true)
  const common = { beginEdit, endEdit }
  const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
  const sourceMax = Math.max(Number(item.sourceDuration) || 0, Number(item.out) || 0)

  if (kind === 'audio') {
    const length = item.loop ? null : (item.out - item.in) / speed
    return (
      <div className="grp" data-inspector="audio">
        <label>{t('ip_title_audio')}: <b title={item.path}>{item.name}</b></label>
        <div className="kv"><span>{t('ip_track')}</span><b>{trackName}</b></div>
        <div className="seg">
          <button onClick={onDuplicate} title={t('ctx_duplicate')}><CopyPlus size={15} /></button>
          <button onClick={onRemove} title={t('ip_delete')}><Trash2 size={15} /></button>
        </div>
        <div className="ip-sec">{t('ip_section_time')}</div>
        <NumField {...common} label={`${t('ip_start')}`} value={round(item.start)} min={0} step={0.1} testId="start"
          onChange={(value) => update({ start: Math.max(0, value) })} />
        <NumField {...common} label={`${t('ip_in')}`} value={round(item.in)} min={0} max={Math.max(0, item.out - 0.05)} step={0.1} testId="in"
          onChange={(value) => update({ in: clampNumber(value, 0, item.out - 0.05) })} />
        <NumField {...common} label={`${t('ip_out')}`} value={round(item.out)} min={item.in + 0.05} max={sourceMax || undefined} step={0.1} testId="out"
          onChange={(value) => update({ out: clampNumber(value, item.in + 0.05, sourceMax || Infinity) })} />
        <NumField {...common} label={t('ip_speed')} value={round(speed, 3)} min={0.05} max={16} step={0.05} testId="speed"
          onChange={(value) => update({ speed: clampNumber(value, 0.05, 16) })} />
        <div className="kv"><span>{t('ip_len_on_tl')}</span><b>{length == null ? t('audio_loop') : fmt(length)}</b></div>
        <div className="ip-sec">{t('ip_section_sound')}</div>
        <label>{t('ip_gain')} <b>{Math.round(item.gain * 100)}%</b></label>
        <input type="range" min="0" max="2" step="0.05" value={item.gain} data-prop="gain"
          onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => update({ gain: Number(event.target.value) })} />
        <label>{t('ip_pan')} <b>{item.pan ? `${t(item.pan < 0 ? 'ip_pan_left' : 'ip_pan_right')} ${Math.round(Math.abs(item.pan) * 100)}%` : t('ip_pan_center')}</b></label>
        <input type="range" min="-1" max="1" step="0.05" value={item.pan || 0} data-prop="pan"
          onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => update({ pan: Number(event.target.value) })} />
        {!!item.pan && <small className="cap-hint">{t('ip_pan_hint')}</small>}
        <NumField {...common} label={t('ip_fade_in')} value={round(item.fadeIn || 0)} min={0} max={10} step={0.1} testId="fadeIn"
          onChange={(value) => update({ fadeIn: clampNumber(value, 0, 10) })} />
        <NumField {...common} label={t('ip_fade_out')} value={round(item.fadeOut || 0)} min={0} max={10} step={0.1} testId="fadeOut"
          onChange={(value) => update({ fadeOut: clampNumber(value, 0, 10) })} />
        <label className="chk"><input type="checkbox" checked={!!item.loop} onChange={(event) => { pushHistory(); update({ loop: event.target.checked }) }} /> {t('audio_loop')}</label>
        <label className="chk"><input type="checkbox" checked={!!item.muted} onChange={(event) => { pushHistory(); update({ muted: event.target.checked }) }} /> {t('audio_item_mute')}</label>
      </div>
    )
  }

  const still = item.kind === 'image' || !!item.sticker // khong co doan nguon: do dai chinh la "out"
  const length = (item.out - (still ? 0 : item.in)) / speed
  const title = item.sticker ? t('ip_title_sticker') : item.kind === 'image' ? t('ip_title_image') : t('ip_title_video')
  const setWidth = (value) => {
    const width = clampNumber(value / 100, 0.01, 4)
    update(lockRatio && item.width > 0 ? { width, height: clampNumber(width * (item.height / item.width), 0.01, 4) } : { width })
  }
  const setHeight = (value) => {
    const height = clampNumber(value / 100, 0.01, 4)
    update(lockRatio && item.height > 0 ? { height, width: clampNumber(height * (item.width / item.height), 0.01, 4) } : { height })
  }
  return (
    <div className="grp" data-inspector="overlay">
      <label>{title}: <b title={item.path || item.sticker}>{item.name}</b></label>
      <div className="kv"><span>{t('ip_track')}</span><b>{trackName}</b></div>
      <div className="seg">
        <button onClick={onDuplicate} title={t('ctx_duplicate')}><CopyPlus size={15} /></button>
        <button onClick={onRemove} title={t('ip_delete')}><Trash2 size={15} /></button>
      </div>
      <div className="ip-sec">{t('ip_section_transform')}</div>
      <NumField {...common} label={t('ip_x')} value={round(item.x * 100, 1)} min={0} max={100} step={0.5} testId="x"
        onChange={(value) => update({ x: clampNumber(value / 100, 0, 1) })} />
      <NumField {...common} label={t('ip_y')} value={round(item.y * 100, 1)} min={0} max={100} step={0.5} testId="y"
        onChange={(value) => update({ y: clampNumber(value / 100, 0, 1) })} />
      <NumField {...common} label={t('ip_w')} value={round(item.width * 100, 1)} min={1} max={400} step={1} testId="width" onChange={setWidth} />
      <NumField {...common} label={t('ip_h')} value={round(item.height * 100, 1)} min={1} max={400} step={1} testId="height" onChange={setHeight} />
      <label className="chk"><input type="checkbox" checked={lockRatio} data-prop="lock" onChange={(event) => setLockRatio(event.target.checked)} /> {t('ip_lock_ratio')}</label>
      <label>{t('ip_opacity')} <b>{Math.round(item.opacity * 100)}%</b></label>
      <input type="range" min="0" max="1" step="0.05" value={item.opacity} data-prop="opacity"
        onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => update({ opacity: Number(event.target.value) })} />
      <div className="ip-sec">{t('ip_section_effects')}</div>
      <NumField {...common} label={t('ip_rotation')} value={round(item.rotation || 0, 1)} min={-360} max={360} step={1} testId="rotation"
        onChange={(value) => update({ rotation: clampNumber(value, -360, 360) })} />
      <div className="seg wrap">
        <button data-act="rot-left" onClick={() => { pushHistory(); update({ rotation: normalizeAngle((item.rotation || 0) - 90) }) }} title={t('ip_rotate_left')}>↺ 90°</button>
        <button data-act="rot-right" onClick={() => { pushHistory(); update({ rotation: normalizeAngle((item.rotation || 0) + 90) }) }} title={t('ip_rotate_right')}>↻ 90°</button>
        <button data-act="flip-h" className={item.flipH ? 'on' : ''} aria-pressed={!!item.flipH} onClick={() => { pushHistory(); update({ flipH: !item.flipH }) }}>{t('ip_flip_h')}</button>
        <button data-act="flip-v" className={item.flipV ? 'on' : ''} aria-pressed={!!item.flipV} onClick={() => { pushHistory(); update({ flipV: !item.flipV }) }}>{t('ip_flip_v')}</button>
      </div>
      <NumField {...common} label={t('ip_fade_in')} value={round(item.fadeIn || 0)} min={0} max={60} step={0.1} testId="fadeIn"
        onChange={(value) => update({ fadeIn: clampNumber(value, 0, 60) })} />
      <NumField {...common} label={t('ip_fade_out')} value={round(item.fadeOut || 0)} min={0} max={60} step={0.1} testId="fadeOut"
        onChange={(value) => update({ fadeOut: clampNumber(value, 0, 60) })} />
      <div className="ip-sec">{t('ip_section_time')}</div>
      <NumField {...common} label={t('ip_start')} value={round(item.start)} min={0} step={0.1} testId="start"
        onChange={(value) => update({ start: Math.max(0, value) })} />
      {still
        ? <NumField {...common} label={t('ip_duration')} value={round(item.out)} min={0.1} step={0.1} testId="out"
          onChange={(value) => update({ in: 0, out: Math.max(0.1, value) })} />
        : <>
          <NumField {...common} label={t('ip_in')} value={round(item.in)} min={0} max={Math.max(0, item.out - 0.1)} step={0.1} testId="in"
            onChange={(value) => update({ in: clampNumber(value, 0, item.out - 0.1) })} />
          <NumField {...common} label={t('ip_out')} value={round(item.out)} min={item.in + 0.1} max={sourceMax || undefined} step={0.1} testId="out"
            onChange={(value) => update({ out: clampNumber(value, item.in + 0.1, sourceMax || Infinity) })} />
          <NumField {...common} label={t('ip_speed')} value={round(speed, 3)} min={0.05} max={16} step={0.05} testId="speed"
            onChange={(value) => update({ speed: clampNumber(value, 0.05, 16) })} />
        </>}
      <div className="kv"><span>{t('ip_len_on_tl')}</span><b>{fmt(length)}</b></div>
    </div>
  )
}

// Tom tat khi chon nhieu muc
export function MultiProps({ count, onDuplicate, onMute, onDelete }) {
  const { t } = useI18n()
  return (
    <div className="grp" data-inspector="multi">
      <label>{t('ip_multi', { n: count })}</label>
      <small className="cap-hint">{t('ip_multi_hint')}</small>
      <div className="seg">
        <button onClick={onDuplicate} title={t('ctx_duplicate')}><CopyPlus size={15} /></button>
        <button onClick={onMute} title={t('ctx_mute')}><VolumeX size={15} /></button>
        <button onClick={onDelete} title={t('ip_delete')}><Trash2 size={15} /></button>
      </div>
    </div>
  )
}

// Chu / sticker chu dang chon: thuoc tinh day du nam o tab Van ban
export function TextProps({ overlay, onOpen }) {
  const { t } = useI18n()
  return (
    <div className="grp" data-inspector="text">
      <label>{t('ip_text_title')}: <b>{overlay.text}</b></label>
      <div className="kv"><span>{t('ip_start')}</span><b>{fmt(overlay.start)}</b></div>
      <div className="kv"><span>{t('ip_len_on_tl')}</span><b>{fmt(overlay.end - overlay.start)}</b></div>
      <small className="cap-hint">{t('ip_text_hint')}</small>
      <button className="cc-auto" onClick={onOpen}>{t('ip_open_text')}</button>
    </div>
  )
}
