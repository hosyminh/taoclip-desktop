import React, { useState } from 'react'
import {
  Trash2, CopyPlus, VolumeX, Film, Image as ImageIcon, Smile, Music, Layers, Type, Move, Sparkles, Clock, Volume2, Scissors, Crop,
  RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2, Link2, ChevronLeft, ChevronRight
} from 'lucide-react'
import { useI18n } from './i18n.jsx'
import { fmt, isImg, clipOut, SPEEDS, SLIDE_DURS } from './utils.js'
import { PropHeader, IconBtn, PropTabs, Section, Grid, Field, SliderRow, Toggle, Chips, Hint, KV } from './InspectorKit.jsx'

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits
const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value))
// Dua goc ve khoang (-360, 360] sau khi cong tru 90 do
const normalizeAngle = (degrees) => (Math.abs(degrees) > 360 ? degrees % 360 : degrees)
const sameSpeed = (a, b) => Math.abs((Number(a) || 1) - b) < 0.001

// Vi tri nhanh cua hinh trong khung kieu Fill: [cropX, cropY, mui ten chi phan hinh dang hien]
const CROP_ANCHORS = [[0, 0, '↖'], [0.5, 0, '↑'], [1, 0, '↗'], [0, 0.5, '←'], [0.5, 0.5, '•'], [1, 0.5, '→'], [0, 1, '↙'], [0.5, 1, '↓'], [1, 1, '↘']]

// Tab dang chon neu con hop le, khong thi tab dau tien
const pickTab = (tabs, wanted) => (tabs.some((tab) => tab.id === wanted) ? wanted : tabs[0].id)

// Bang thuoc tinh cua mot item tren V2+ (video, anh, sticker) hoac mot doan audio roi
export function ItemProps({ kind, item, trackName, update, onRemove, onDuplicate, beginEdit, endEdit, pushHistory, tab, setTab }) {
  const { t } = useI18n()
  const [lockRatio, setLockRatio] = useState(true)
  const common = { beginEdit, endEdit }
  const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
  const sourceMax = Math.max(Number(item.sourceDuration) || 0, Number(item.out) || 0)
  const reset = (patch) => () => { pushHistory(); update(patch) }
  const duplicateBtn = <IconBtn icon={CopyPlus} title={t('ctx_duplicate')} onClick={onDuplicate} act="duplicate" />
  const removeBtn = <IconBtn icon={Trash2} title={t('ip_delete')} onClick={onRemove} act="delete" />

  if (kind === 'audio') {
    const length = item.loop ? null : (item.out - item.in) / speed
    const tabs = [{ id: 'sound', label: t('ip_section_sound'), icon: Volume2 }, { id: 'time', label: t('ip_section_time'), icon: Clock }]
    const active = pickTab(tabs, tab)
    return (
      <div className="ip" data-inspector="audio">
        <PropHeader icon={Music} name={item.name} nameTitle={item.path} kind={t('ip_kind_audio')} track={trackName}>
          <IconBtn icon={VolumeX} act="mute" title={t('audio_item_mute')} pressed={!!item.muted} onClick={() => { pushHistory(); update({ muted: !item.muted }) }} />
          {duplicateBtn}{removeBtn}
        </PropHeader>
        <PropTabs tabs={tabs} active={active} onChange={setTab} />
        <div className="ip-body">
          {active === 'sound' && <>
            <Section title={t('ip_sec_level')} onReset={reset({ gain: 1, pan: 0 })}>
              <SliderRow {...common} label={t('ip_gain')} display={`${Math.round(item.gain * 100)}%`} min="0" max="2" step="0.05" value={item.gain} testId="gain"
                onChange={(value) => update({ gain: value })} />
              <SliderRow {...common} label={t('ip_pan')} min="-1" max="1" step="0.05" value={item.pan || 0} testId="pan"
                display={item.pan ? `${t(item.pan < 0 ? 'ip_pan_left' : 'ip_pan_right')} ${Math.round(Math.abs(item.pan) * 100)}%` : t('ip_pan_center')}
                onChange={(value) => update({ pan: value })} />
              {!!item.pan && <Hint>{t('ip_pan_hint')}</Hint>}
            </Section>
            <Section title={t('ip_sec_fade')} onReset={reset({ fadeIn: 0, fadeOut: 0 })}>
              <Grid>
                <Field {...common} prefix={t('ip_s_in')} unit="s" title={t('ip_fade_in')} value={round(item.fadeIn || 0)} min={0} max={10} step={0.1} testId="fadeIn"
                  onChange={(value) => update({ fadeIn: clampNumber(value, 0, 10) })} />
                <Field {...common} prefix={t('ip_s_out')} unit="s" title={t('ip_fade_out')} value={round(item.fadeOut || 0)} min={0} max={10} step={0.1} testId="fadeOut"
                  onChange={(value) => update({ fadeOut: clampNumber(value, 0, 10) })} />
              </Grid>
            </Section>
            <Toggle label={t('audio_loop')} checked={!!item.loop} testId="loop" onChange={(on) => { pushHistory(); update({ loop: on }) }} />
          </>}
          {active === 'time' && <>
            <Section title={t('ip_sec_timeline')}>
              <Grid>
                <Field {...common} prefix={t('ip_s_start')} unit="s" title={t('ip_start')} value={round(item.start)} min={0} step={0.1} testId="start"
                  onChange={(value) => update({ start: Math.max(0, value) })} />
                <Field prefix={t('ip_s_len')} unit={length == null ? '' : 's'} title={t('ip_len_on_tl')} text={length == null ? t('audio_loop') : String(round(length))} />
              </Grid>
            </Section>
            <Section title={t('ip_sec_source')}>
              <Grid>
                <Field {...common} prefix={t('ip_s_in')} unit="s" title={t('ip_in')} value={round(item.in)} min={0} max={Math.max(0, item.out - 0.05)} step={0.1} testId="in"
                  onChange={(value) => update({ in: clampNumber(value, 0, item.out - 0.05) })} />
                <Field {...common} prefix={t('ip_s_out')} unit="s" title={t('ip_out')} value={round(item.out)} min={item.in + 0.05} max={sourceMax || undefined} step={0.1} testId="out"
                  onChange={(value) => update({ out: clampNumber(value, item.in + 0.05, sourceMax || Infinity) })} />
              </Grid>
            </Section>
            <Section title={t('speed')} onReset={reset({ speed: 1 })}>
              <Chips options={SPEEDS.slice(0, 4)} isOn={(value) => sameSpeed(speed, value)} onPick={(value) => { pushHistory(); update({ speed: value }) }} />
              <Grid>
                <Field {...common} prefix={t('ip_s_custom')} unit="×" title={t('ip_speed')} value={round(speed, 3)} min={0.05} max={16} step={0.05} testId="speed"
                  onChange={(value) => update({ speed: clampNumber(value, 0.05, 16) })} />
              </Grid>
            </Section>
          </>}
        </div>
      </div>
    )
  }

  const still = item.kind === 'image' || !!item.sticker // khong co doan nguon: do dai chinh la "out"
  const length = (item.out - (still ? 0 : item.in)) / speed
  const kindLabel = item.sticker ? t('ip_kind_sticker') : item.kind === 'image' ? t('ip_kind_image') : t('ip_kind_video')
  const KindIcon = item.sticker ? Smile : item.kind === 'image' ? ImageIcon : Film
  const setWidth = (value) => {
    const width = clampNumber(value / 100, 0.01, 4)
    update(lockRatio && item.width > 0 ? { width, height: clampNumber(width * (item.height / item.width), 0.01, 4) } : { width })
  }
  const setHeight = (value) => {
    const height = clampNumber(value / 100, 0.01, 4)
    update(lockRatio && item.height > 0 ? { height, width: clampNumber(height * (item.width / item.height), 0.01, 4) } : { height })
  }
  const tabs = [
    { id: 'shape', label: t('ip_tab_shape'), icon: Move },
    { id: 'fx', label: t('ip_tab_fx'), icon: Sparkles },
    { id: 'time', label: t('ip_section_time'), icon: Clock },
    ...(still ? [] : [{ id: 'sound', label: t('ip_section_sound'), icon: Volume2 }])
  ]
  const active = pickTab(tabs, tab)
  return (
    <div className="ip" data-inspector="overlay">
      <PropHeader icon={KindIcon} name={item.name} nameTitle={item.path || item.sticker} kind={kindLabel} track={trackName}>{duplicateBtn}{removeBtn}</PropHeader>
      <PropTabs tabs={tabs} active={active} onChange={setTab} />
      <div className="ip-body">
        {active === 'shape' && <>
          <Section title={t('ip_sec_position')} onReset={reset({ x: 0.5, y: 0.5 })} resetTitle={t('ip_center')}>
            <Grid>
              <Field {...common} prefix="X" unit="%" title={t('ip_x')} value={round(item.x * 100, 1)} min={0} max={100} step={0.5} testId="x"
                onChange={(value) => update({ x: clampNumber(value / 100, 0, 1) })} />
              <Field {...common} prefix="Y" unit="%" title={t('ip_y')} value={round(item.y * 100, 1)} min={0} max={100} step={0.5} testId="y"
                onChange={(value) => update({ y: clampNumber(value / 100, 0, 1) })} />
              <Field {...common} prefix="W" unit="%" title={t('ip_w')} value={round(item.width * 100, 1)} min={1} max={400} step={1} testId="width" onChange={setWidth} />
              <Field {...common} prefix="H" unit="%" title={t('ip_h')} value={round(item.height * 100, 1)} min={1} max={400} step={1} testId="height" onChange={setHeight} />
            </Grid>
            <Toggle label={t('ip_lock_ratio')} icon={Link2} checked={lockRatio} testId="lock" onChange={setLockRatio} />
          </Section>
          <Section title={t('ip_sec_display')} onReset={reset({ opacity: 1 })}>
            <SliderRow {...common} label={t('ip_opacity')} display={`${Math.round(item.opacity * 100)}%`} min="0" max="1" step="0.05" value={item.opacity} testId="opacity"
              onChange={(value) => update({ opacity: value })} />
          </Section>
        </>}
        {active === 'fx' && <>
          <Section title={t('ip_sec_rotate')} onReset={reset({ rotation: 0, flipH: false, flipV: false })}>
            <Grid>
              <Field {...common} prefix={t('ip_s_angle')} unit="°" title={t('ip_rotation')} value={round(item.rotation || 0, 1)} min={-360} max={360} step={1} testId="rotation"
                onChange={(value) => update({ rotation: clampNumber(value, -360, 360) })} />
            </Grid>
            <div className="ip-ic4">
              <IconBtn icon={RotateCcw} act="rot-left" title={t('ip_rotate_left')} onClick={() => { pushHistory(); update({ rotation: normalizeAngle((item.rotation || 0) - 90) }) }} />
              <IconBtn icon={RotateCw} act="rot-right" title={t('ip_rotate_right')} onClick={() => { pushHistory(); update({ rotation: normalizeAngle((item.rotation || 0) + 90) }) }} />
              <IconBtn icon={FlipHorizontal2} act="flip-h" title={t('ip_flip_h')} pressed={!!item.flipH} onClick={() => { pushHistory(); update({ flipH: !item.flipH }) }} />
              <IconBtn icon={FlipVertical2} act="flip-v" title={t('ip_flip_v')} pressed={!!item.flipV} onClick={() => { pushHistory(); update({ flipV: !item.flipV }) }} />
            </div>
          </Section>
          <Section title={t('ip_sec_fade')} onReset={reset({ fadeIn: 0, fadeOut: 0 })}>
            <Grid>
              <Field {...common} prefix={t('ip_s_in')} unit="s" title={t('ip_fade_in')} value={round(item.fadeIn || 0)} min={0} max={60} step={0.1} testId="fadeIn"
                onChange={(value) => update({ fadeIn: clampNumber(value, 0, 60) })} />
              <Field {...common} prefix={t('ip_s_out')} unit="s" title={t('ip_fade_out')} value={round(item.fadeOut || 0)} min={0} max={60} step={0.1} testId="fadeOut"
                onChange={(value) => update({ fadeOut: clampNumber(value, 0, 60) })} />
            </Grid>
          </Section>
        </>}
        {active === 'time' && <>
          <Section title={t('ip_sec_timeline')}>
            <Grid>
              <Field {...common} prefix={t('ip_s_start')} unit="s" title={t('ip_start')} value={round(item.start)} min={0} step={0.1} testId="start"
                onChange={(value) => update({ start: Math.max(0, value) })} />
              {still
                ? <Field {...common} prefix={t('ip_s_len')} unit="s" title={t('ip_duration')} value={round(item.out)} min={0.1} step={0.1} testId="out"
                  onChange={(value) => update({ in: 0, out: Math.max(0.1, value) })} />
                : <Field prefix={t('ip_s_len')} unit="s" title={t('ip_len_on_tl')} text={String(round(length))} />}
            </Grid>
          </Section>
          {!still && <>
            <Section title={t('ip_sec_source')}>
              <Grid>
                <Field {...common} prefix={t('ip_s_in')} unit="s" title={t('ip_in')} value={round(item.in)} min={0} max={Math.max(0, item.out - 0.1)} step={0.1} testId="in"
                  onChange={(value) => update({ in: clampNumber(value, 0, item.out - 0.1) })} />
                <Field {...common} prefix={t('ip_s_out')} unit="s" title={t('ip_out')} value={round(item.out)} min={item.in + 0.1} max={sourceMax || undefined} step={0.1} testId="out"
                  onChange={(value) => update({ out: clampNumber(value, item.in + 0.1, sourceMax || Infinity) })} />
              </Grid>
            </Section>
            <Section title={t('speed')} onReset={reset({ speed: 1 })}>
              <Chips options={SPEEDS.slice(0, 4)} isOn={(value) => sameSpeed(speed, value)} onPick={(value) => { pushHistory(); update({ speed: value }) }} />
              <Grid>
                <Field {...common} prefix={t('ip_s_custom')} unit="×" title={t('ip_speed')} value={round(speed, 3)} min={0.05} max={16} step={0.05} testId="speed"
                  onChange={(value) => update({ speed: clampNumber(value, 0.05, 16) })} />
              </Grid>
            </Section>
          </>}
        </>}
        {active === 'sound' && !still && (
          <Section title={t('ip_sec_level')} onReset={item.audioMuted === false ? reset({ volume: 1 }) : undefined}>
            <Toggle label={t('ip_use_sound')} checked={item.audioMuted === false} testId="useSound" onChange={(on) => { pushHistory(); update({ audioMuted: !on }) }} />
            {item.audioMuted === false && <>
              <SliderRow {...common} label={t('ip_gain')} display={`${Math.round((item.volume ?? 1) * 100)}%`} min="0" max="2" step="0.05" value={item.volume ?? 1} testId="overlayVolume"
                onChange={(value) => update({ volume: value })} />
              <Hint>{t('ip_use_sound_hint')}</Hint>
            </>}
          </Section>
        )}
      </div>
    </div>
  )
}

// Bang thuoc tinh cua clip tren V1 (doan video / anh noi tiep nhau)
export function ClipProps({ clip, moveClip, deleteClip, updateClip, pushHistory, beginEdit, endEdit, setAllSlideDur, tab, setTab }) {
  const { t } = useI18n()
  const common = { beginEdit, endEdit }
  const image = isImg(clip)
  const speed = clip.speed || 1
  const hasSound = !image && clip.src?.hasAudio && !clip.audioDetached
  const tabs = [
    { id: 'trim', label: image ? t('ip_section_time') : t('ip_tab_trim'), icon: image ? Clock : Scissors },
    { id: 'frame', label: t('ip_tab_frame'), icon: Crop },
    ...(hasSound ? [{ id: 'sound', label: t('ip_section_sound'), icon: Volume2 }] : [])
  ]
  const active = pickTab(tabs, tab)
  const fill = clip.cropMode === 'fill'
  const patchClip = (patch) => { pushHistory(); updateClip(clip.id, patch) }
  const resetWith = (patch) => () => patchClip(patch)
  const cx = clip.cropX ?? 0.5
  const cy = clip.cropY ?? 0.5
  const maxOut = clip.src?.duration || clip.out
  return (
    <div className="ip" data-inspector="clip">
      <PropHeader icon={image ? ImageIcon : Film} name={clip.name} kind={t('ip_kind_clip')} track="V1">
        <IconBtn icon={ChevronLeft} title={t('move_left')} onClick={() => moveClip(clip.id, -1)} act="move-left" />
        <IconBtn icon={ChevronRight} title={t('move_right')} onClick={() => moveClip(clip.id, 1)} act="move-right" />
        <IconBtn icon={Trash2} title={t('del_clip')} onClick={() => deleteClip(clip.id)} act="delete" />
      </PropHeader>
      <PropTabs tabs={tabs} active={active} onChange={setTab} />
      <div className="ip-body">
        {active === 'trim' && (image ? <>
          <Section title={t('slide_dur')}>
            <Chips options={SLIDE_DURS} unit="s" isOn={(value) => Math.abs(clipOut(clip) - value) < 0.05} onPick={(value) => { pushHistory(); updateClip(clip.id, { in: 0, out: value }) }} />
            <SliderRow {...common} label={t('ip_s_len')} display={`${clipOut(clip).toFixed(1)}s`} min={0.5} max={15} step={0.5} value={clipOut(clip)} testId="slideDur"
              onChange={(value) => updateClip(clip.id, { in: 0, out: value })} />
            <button type="button" className="cc-auto ip-wide" onClick={() => setAllSlideDur(clipOut(clip))}>{t('apply_all')}</button>
          </Section>
          <Section title={t('ip_sec_motion')}>
            <Toggle label={t('kenburns')} checked={clip.kenBurns !== false} testId="kenBurns" onChange={(on) => { pushHistory(); updateClip(clip.id, { kenBurns: on }) }} />
          </Section>
        </> : <>
          <Section title={t('ip_sec_source')}>
            <Grid>
              <Field {...common} prefix={t('ip_s_in')} unit="s" title={t('trim_in')} value={clip.in} min={0} max={Math.max(0, clip.out - 0.1)} step={0.01} testId="clipIn"
                onChange={(value) => { if (value >= 0 && value <= clip.out - 0.1) updateClip(clip.id, { in: value }) }} />
              <Field {...common} prefix={t('ip_s_out')} unit="s" title={t('trim_out')} value={clip.out} min={clip.in + 0.1} max={maxOut} step={0.01} testId="clipOut"
                onChange={(value) => { if (value >= clip.in + 0.1 && value <= maxOut) updateClip(clip.id, { out: value }) }} />
            </Grid>
          </Section>
          <Section title={t('speed')} onReset={resetWith({ speed: 1 })}>
            <Chips options={SPEEDS} isOn={(value) => clip.speed === value} onPick={(value) => { pushHistory(); updateClip(clip.id, { speed: value }) }} />
            <Grid>
              <Field {...common} prefix={t('ip_s_custom')} unit="×" title={t('speed')} value={speed} min={0.05} max={16} step={0.05} testId="clipSpeed"
                onChange={(value) => { if (value >= 0.05 && value <= 16) updateClip(clip.id, { speed: value }) }} />
              <Field prefix={t('trim_len')} title={t('trim_len')} text={fmt(clipOut(clip))} />
            </Grid>
          </Section>
        </>)}
        {active === 'frame' && <>
          <Section title={t('ip_sec_fit')} onReset={resetWith({ cropMode: 'fit', cropX: 0.5, cropY: 0.5 })}>
            <div className="ip-seg">
              <button type="button" className={!fill ? 'on' : ''} aria-pressed={!fill} title={t('crop_fit')} onClick={() => { if (fill) patchClip({ cropMode: 'fit' }) }}>{t('ip_fit_short')}</button>
              <button type="button" className={fill ? 'on' : ''} aria-pressed={fill} title={t('crop_fill')} onClick={() => { if (!fill) patchClip({ cropMode: 'fill' }) }}>{t('ip_fill_short')}</button>
            </div>
          </Section>
          {fill ? (
            <Section title={t('crop_anchor')}>
              <div className="ip-frame">
                <div className="crop-anchors">
                  {CROP_ANCHORS.map(([ax, ay, arrow]) => {
                    const on = Math.abs(cx - ax) < 0.005 && Math.abs(cy - ay) < 0.005
                    return <button key={`${ax}-${ay}`} className={on ? 'on' : ''} title={t('crop_anchor')} aria-pressed={on} onClick={() => patchClip({ cropX: ax, cropY: ay })}>{arrow}</button>
                  })}
                </div>
                <div className="ip-frame-sl">
                  <SliderRow {...common} label={t('crop_cx')} display={`${Math.round(cx * 100)}%`} min="0" max="1" step="0.01" value={cx} testId="cropX"
                    onChange={(value) => updateClip(clip.id, { cropX: value })} />
                  <SliderRow {...common} label={t('crop_cy')} display={`${Math.round(cy * 100)}%`} min="0" max="1" step="0.01" value={cy} testId="cropY"
                    onChange={(value) => updateClip(clip.id, { cropY: value })} />
                </div>
              </div>
            </Section>
          ) : <Hint>{t('crop_pos_fit_hint')}</Hint>}
        </>}
        {active === 'sound' && hasSound && (
          <Section title={t('ip_sec_level')} onReset={resetWith({ volume: 1 })}>
            <SliderRow {...common} label={t('clip_volume')} display={`${Math.round((clip.volume ?? 1) * 100)}%`} min="0" max="2" step="0.05" value={clip.volume ?? 1} testId="clipVolume"
              onChange={(value) => updateClip(clip.id, { volume: value })} />
            {(clip.volume ?? 1) > 1 && <Hint>{t('clip_volume_hint')}</Hint>}
          </Section>
        )}
      </div>
    </div>
  )
}

// Tom tat khi chon nhieu muc
export function MultiProps({ count, onDuplicate, onMute, onDelete }) {
  const { t } = useI18n()
  return (
    <div className="ip" data-inspector="multi">
      <PropHeader icon={Layers} name={t('ip_multi', { n: count })} kind={t('ip_kind_group')}>
        <IconBtn icon={CopyPlus} title={t('ctx_duplicate')} onClick={onDuplicate} act="duplicate" />
        <IconBtn icon={VolumeX} title={t('ctx_mute')} onClick={onMute} act="mute" />
        <IconBtn icon={Trash2} title={t('ip_delete')} onClick={onDelete} act="delete" />
      </PropHeader>
      <div className="ip-body"><Hint>{t('ip_multi_hint')}</Hint></div>
    </div>
  )
}

// Chu / sticker chu dang chon: thuoc tinh day du nam o tab Van ban
export function TextProps({ overlay, onOpen }) {
  const { t } = useI18n()
  return (
    <div className="ip" data-inspector="text">
      <PropHeader icon={Type} name={overlay.text} kind={t('ip_kind_text')} />
      <div className="ip-body">
        <KV label={t('ip_start')} value={fmt(overlay.start)} />
        <KV label={t('ip_len_on_tl')} value={fmt(overlay.end - overlay.start)} />
        <Hint>{t('ip_text_hint')}</Hint>
        <button type="button" className="cc-auto ip-wide" onClick={onOpen}>{t('ip_open_text')}</button>
      </div>
    </div>
  )
}
