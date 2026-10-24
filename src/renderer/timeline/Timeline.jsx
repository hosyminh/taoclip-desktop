import React, { useEffect, useRef, useState } from 'react'
import { Scissors, Undo2, Redo2, Keyboard, Minus, Plus, Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, X } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { fmt, fileUrl, FRAME } from '../utils.js'
import { audioTracksOf, videoTracksOf, clipAudioSpans, insertIndexForTime, isCoreTrack, MAIN_VIDEO_TRACK, MAIN_AUDIO_TRACK } from '../track-model.js'
import { HEAD_W, ROW_HEIGHT, TAIL_PX, audioItemLength, tickLabel, clientXToTime, thumbTiles } from './geometry.js'
import { stickerUrl } from '../sticker-catalog.js'

// Timeline hai vung: hinh o tren (V_n ... V2, V1), am thanh o duoi (A1, A2 ...). Chi hien thi; moi thao tac di qua callback cua App.
export default function Timeline({
  tlH, onResizePanel, tabs, overlayThumbs, laneDrag, onStartClipAudioDrag,
  tracks, onTrackPatch, onAddTrack, onRemoveTrack,
  layout, selId, onSelectClip, videoOverlays, audioItems, overlays, selOv, selItem, onSelectItem,
  pps, scrollRef, totalDuration, current, ticks, dragInsert, hasClips,
  snapEnabled, onToggleSnap, canUndo, canRedo, onUndo, onRedo, onSplit, onShowKeys, onZoomOut, onZoomIn, onFit,
  onSeekClick, onStartScrub, onStartTrim, onStartReorder, onRetryWave,
  onSeek, onStartV2Move, onStartV2Resize, onRemoveV2, onStartAudioDrag, onRemoveAudio, onStartOverlayMove, onStartOverlayResize,
  onItemContextMenu, dragActive = false, onLaneDrop, canDetach = false, isDetached = false, onDetachAudio
}) {
  const { t } = useI18n()
  const [hoverLane, setHoverLane] = useState(null)
  const [dropAt, setDropAt] = useState(null) // { key, time }: vach bao thoi diem se tha vao tren duong dang ruoc toi
  const autoScroll = useRef({ vx: 0, vy: 0, timer: null })
  const stopAutoScroll = () => {
    const a = autoScroll.current
    a.vx = 0; a.vy = 0
    if (a.timer) { clearInterval(a.timer); a.timer = null }
  }
  useEffect(() => { if (!dragActive) { stopAutoScroll(); setDropAt(null); setHoverLane(null) } }, [dragActive])
  useEffect(() => stopAutoScroll, [])
  // Keo file sat mep khung timeline thi tu cuon (8 duong khong vua mot man hinh nen can cuon luc dang keo)
  const scrollWhileDragging = (event) => {
    const el = scrollRef.current
    if (!el) return
    const r = el.getBoundingClientRect(), edge = 40
    const speed = (distance) => Math.round(Math.max(0, Math.min(1, (edge - distance) / edge)) * 18) + 2
    const a = autoScroll.current
    a.vy = event.clientY > r.bottom - edge ? speed(r.bottom - event.clientY) : event.clientY < r.top + 26 + edge ? -speed(event.clientY - r.top - 26) : 0
    a.vx = event.clientX > r.right - edge ? speed(r.right - event.clientX) : event.clientX < r.left + HEAD_W + edge ? -speed(event.clientX - r.left - HEAD_W) : 0
    if (!a.vx && !a.vy) { stopAutoScroll(); return }
    if (!a.timer) a.timer = setInterval(() => { el.scrollTop += a.vy; el.scrollLeft += a.vx }, 16)
  }
  const laneDragOver = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
  const laneDrop = (event, lane) => { event.preventDefault(); event.stopPropagation(); stopAutoScroll(); setHoverLane(null); setDropAt(null); onLaneDrop?.(event, lane) }
  const dropProps = (lane, key) => ({
    onDragOver: (event) => {
      laneDragOver(event)
      setHoverLane((cur) => (cur === key ? cur : key))
      if (lane.forceNew || !scrollRef.current) return
      const time = Math.max(0, clientXToTime(event.clientX, scrollRef.current, pps))
      setDropAt((cur) => (cur && cur.key === key && Math.abs(cur.time - time) * pps < 2 ? cur : { key, time }))
    },
    onDragEnter: () => setHoverLane(key),
    onDragLeave: (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return
      setHoverLane((cur) => (cur === key ? null : cur))
      setDropAt((cur) => (cur && cur.key === key ? null : cur))
    },
    onDrop: (event) => laneDrop(event, lane)
  })
  // Duong keo day het khung nhin (o ke / vung tha khong dut o cuoi video) va co them doan dem sau cuoi de tha qua diem ket thuc
  const [viewW, setViewW] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const measure = () => setViewW(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRef])
  const tlWidth = Math.max(totalDuration * pps + TAIL_PX, viewW - HEAD_W, 400)
  // V1 chen giua cac clip nen vach nhay toi mep clip gan nhat; cac duong khac dat dung thoi diem tha
  const dropIndicator = (trackId) => {
    // laneDrag: keo clip / item co san sang duong khac (App giu); dropAt: keo file tu ngoai vao
    const at = laneDrag?.trackId === trackId ? laneDrag.time : (dragActive && dropAt?.key === trackId ? dropAt.time : null)
    if (at == null) return null
    const index = insertIndexForTime(layout, at)
    const time = trackId === MAIN_VIDEO_TRACK ? (index < layout.length ? layout[index].start : totalDuration) : at
    return <div className="cc-lane-ind" style={{ left: time * pps }} />
  }
  const videoRows = videoTracksOf(tracks).slice().reverse()
  const audioRows = audioTracksOf(tracks)
  const a1Spans = clipAudioSpans(layout)
  const stop = (event) => event.stopPropagation()
  const isSel = (kind, id) => selItem?.kind === kind && selItem.id === id
  const itemsOn = (list, trackId) => list.filter((item) => item.trackId === trackId)
  const usedIds = new Set([...videoOverlays, ...audioItems].map((item) => item.trackId))

  function renderHeader(track) {
    const removable = !isCoreTrack(track.id) && !usedIds.has(track.id)
    return (
      <div className="cc-thead" onClick={stop} onMouseDown={stop} onDoubleClick={stop}>
        <span className="name" title={track.name}>{track.name}</span>
        <span className="tools">
          {track.kind === 'video'
            ? <button className={track.hidden ? 'on' : ''} title={t('track_hide')} onClick={() => onTrackPatch(track.id, { hidden: !track.hidden })}>{track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
            : <>
              <button className={track.muted ? 'on' : ''} title={t('track_mute')} onClick={() => onTrackPatch(track.id, { muted: !track.muted })}>{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
              <button className={track.solo ? 'on solo' : ''} title={t('track_solo')} onClick={() => onTrackPatch(track.id, { solo: !track.solo })}>S</button>
            </>}
          <button className={track.locked ? 'on' : ''} title={t('track_lock')} onClick={() => onTrackPatch(track.id, { locked: !track.locked })}>{track.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
          {removable && <button title={t('track_remove')} onClick={() => onRemoveTrack(track.id)}><X size={12} /></button>}
        </span>
      </div>
    )
  }

  const rowClass = (track) => `cc-trow ${track.kind} ${track.locked ? 'locked' : ''} ${track.hidden ? 'hidden' : ''} ${track.muted ? 'muted' : ''} ${hoverLane === track.id || laneDrag?.trackId === track.id ? 'drop-hover' : ''}`
  const laneProps = (track) => dropProps({ kind: track.kind, trackId: track.id }, track.id)

  function renderMainLane(track) {
    return (
      <div key={track.id} className={rowClass(track)} data-track-id={track.id} style={{ height: ROW_HEIGHT.main }} {...laneProps(track)}>
        {renderHeader(track)}
        <div className="cc-tlane" style={{ width: tlWidth }}>{dropIndicator(track.id)}
          {layout.map((seg) => (
            <div key={seg.key} className={`cc-clip ${selId === seg.id ? 'sel' : ''} ${seg.clip?.audioDetached ? 'detached' : ''} ${seg.clip?.enhance ? 'enhanced' : ''}`} data-clip-id={seg.id}
              style={{ left: seg.start * pps, width: (seg.end - seg.start) * pps }}
              onClick={(e) => { e.stopPropagation(); onSelectClip(seg.id); onSeek(seg.start) }}
              onContextMenu={(e) => onItemContextMenu?.(e, { kind: 'clip', id: seg.id })}>
              <div className="h l" onMouseDown={(e) => onStartTrim(seg.clip, 'l', e)} />
              <div className="strip" onMouseDown={(e) => onStartReorder(seg, e)} title={seg.clip.name}>
                {seg.clip.thumbs?.length ? seg.clip.thumbs.map((th, i) => <img key={i} src={fileUrl(th)} alt="" draggable={false} />) : <span className="cn">🎬 {seg.clip.name}</span>}
              </div>
              <div className="h r" onMouseDown={(e) => onStartTrim(seg.clip, 'r', e)} />
            </div>
          ))}
          {dragInsert != null && <div className="cc-drop-ind" style={{ left: (dragInsert < layout.length ? layout[dragInsert].start : totalDuration) * pps }} />}
        </div>
      </div>
    )
  }

  // Hinh nen item V2+: sticker / anh = chinh anh do; video = vai khung hinh cua doan in..out (nap rieng, cache theo duong dan)
  function renderItemThumbs(item, width) {
    if (item.sticker) return <div className="cc-v2-thumbs flat sticker" style={{ backgroundImage: `url(${stickerUrl(item.sticker)})` }} />
    if (item.kind === 'image') return item.path ? <div className="cc-v2-thumbs flat" style={{ backgroundImage: `url(${fileUrl(item.path)})` }} /> : null
    const frames = overlayThumbs?.[item.path]
    if (!Array.isArray(frames) || !frames.length) return null
    return <div className="cc-v2-thumbs">{thumbTiles(item, width, frames.length).map((index, i) => <img key={i} src={fileUrl(frames[index])} alt="" draggable={false} />)}</div>
  }

  function renderOverlayLane(track) {
    return (
      <div key={track.id} className={rowClass(track)} data-track-id={track.id} style={{ height: ROW_HEIGHT.overlay }} {...laneProps(track)}>
        {renderHeader(track)}
        <div className="cc-tlane" style={{ width: tlWidth }}>{dropIndicator(track.id)}
          {itemsOn(videoOverlays, track.id).map((item) => {
            const itemDuration = (item.out - item.in) / item.speed
            const outside = item.start + itemDuration > totalDuration + FRAME
            return (
              <div key={item.id} className={`cc-v2-clip ${outside ? 'outside' : ''} ${isSel('v2', item.id) ? 'sel' : ''}`} data-item-id={item.id}
                title={`${item.name || item.path} · ${fmt(item.start)}${outside ? ` · ${t('v2_outside_v1')}` : ''}`}
                style={{ left: item.start * pps, width: Math.max(24, itemDuration * pps) }}
                onMouseDown={(event) => onStartV2Move(item, event)}
                onClick={(event) => { event.stopPropagation(); onSelectItem({ kind: 'v2', id: item.id }); onSeek(item.start) }}
                onContextMenu={(e) => onItemContextMenu?.(e, { kind: 'v2', id: item.id })}>
                {renderItemThumbs(item, Math.max(24, itemDuration * pps))}
                <span>{item.name || item.path.split(/[\\/]/).pop()}</span>
                <button className="cc-v2-resize" onMouseDown={(event) => onStartV2Resize(item, event)} title={t('v2_resize_tip')} />
                <button onClick={(event) => { event.stopPropagation(); onRemoveV2(item.id) }} title={t('v2_remove_tip')}><X size={11} /></button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderAudioLane(track) {
    const main = track.id === MAIN_AUDIO_TRACK
    return (
      <div key={track.id} className={rowClass(track)} data-track-id={track.id} style={{ height: ROW_HEIGHT.audio }} {...laneProps(track)}>
        {renderHeader(track)}
        <div className="cc-tlane" style={{ width: tlWidth }}>{dropIndicator(track.id)}
          {main && layout.map((seg) => seg.clip?.src?.hasAudio && !seg.clip.audioDetached && (
            <div key={seg.key} className={`cc-aclip ${seg.clip.audioMuted ? 'muted' : ''}`} data-clip-id={seg.id} style={{ left: seg.start * pps, width: (seg.end - seg.start) * pps }}
              onMouseDown={(e) => onStartClipAudioDrag?.(seg, e)}
              onContextMenu={(e) => onItemContextMenu?.(e, { kind: 'clip', id: seg.id })}>
              {seg.clip.wave
                ? <div className="wimg" style={{ backgroundImage: `url(${fileUrl(seg.clip.wave)})`, backgroundSize: `${seg.clip.src.duration * pps / (seg.clip.speed || 1)}px 100%`, backgroundPosition: `${-(seg.clip.in * pps / (seg.clip.speed || 1))}px 0` }} />
                : <div className="wave" />}
              {seg.clip.waveError && <button className="cc-wave-retry" title={t('media_retry')} onClick={(event) => { event.stopPropagation(); onRetryWave(seg.clip.id, seg.clip.path) }}>↻</button>}
              <span>{seg.clip.name}</span>
            </div>
          ))}
          {itemsOn(audioItems, track.id).map((item) => {
            const length = audioItemLength(item, totalDuration)
            const outside = !item.loop && item.start + length > totalDuration + FRAME
            return (
              <div key={item.id} className={`cc-audio-item-clip ${item.track} ${item.muted ? 'muted' : ''} ${outside ? 'outside' : ''} ${isSel('audio', item.id) ? 'sel' : ''}`} data-item-id={item.id}
                style={{ left: item.start * pps, width: Math.max(28, length * pps) }}
                onMouseDown={(event) => onStartAudioDrag(item, event)}
                onClick={(event) => { event.stopPropagation(); onSelectItem({ kind: 'audio', id: item.id }); onSeek(item.start) }}
                onContextMenu={(e) => onItemContextMenu?.(e, { kind: 'audio', id: item.id })}
                title={`${item.name} · ${fmt(item.start)}${outside ? ` · ${t('v2_outside_v1_short')}` : ''}`}>
                <span>{item.name}</span>
                <button onClick={(event) => { event.stopPropagation(); onRemoveAudio(item.id) }} title={t('audio_item_remove_tip')}><X size={11} /></button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={`cc-tl ${dragActive ? 'dragging' : ''}`} style={{ height: tlH, '--head-w': `${HEAD_W}px` }}>
      <div className="rsz h" onMouseDown={onResizePanel} />
      {tabs}
      <div className="cc-tlbar">
        <button className="tb-ic" onClick={onSplit} disabled={!hasClips} title={t('tb_split_tip')}><Scissors size={14} /> {t('tb_split')}</button>
        <button className="tb-ic" onClick={onDetachAudio} disabled={!canDetach && !isDetached} title={t('tb_detach_tip')}>{isDetached ? t('tb_reattach') : t('tb_detach')}</button>
        <button className="tb-ic" onClick={onToggleSnap} title={t('snap_tip')}
          style={snapEnabled ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>{t(snapEnabled ? 'snap_on' : 'snap_off')}</button>
        <button onClick={onUndo} disabled={!canUndo} title={t('undo')}><Undo2 size={14} /></button>
        <button onClick={onRedo} disabled={!canRedo} title={t('redo')}><Redo2 size={14} /></button>
        <button onClick={onShowKeys} title={t('keys_btn')}><Keyboard size={14} /></button>
        <button className="tb-ic" onClick={() => onAddTrack('video')} title={t('track_add_video')}>{t('track_add_video')}</button>
        <button className="tb-ic" onClick={() => onAddTrack('audio')} title={t('track_add_audio')}>{t('track_add_audio')}</button>
        <div className="sp" />
        <span className="cur">{fmt(current)} / {fmt(totalDuration)}</span>
        <div className="zoom">
          <button onClick={onZoomOut} title={t('zoom_out')}><Minus size={14} /></button>
          <button onClick={onFit} title={t('fit')}>{t('fit')}</button>
          <button onClick={onZoomIn} title={t('zoom_in')}><Plus size={14} /></button>
        </div>
      </div>

      <div className="cc-tlscroll" ref={scrollRef} onClick={onSeekClick} onDragOver={scrollWhileDragging} onDragLeave={stopAutoScroll}>
        <div className="cc-tlinner" style={{ width: HEAD_W + tlWidth }}>
          <div className="cc-ruler-row">
            <div className="cc-tl-corner" />
            <div className="cc-ruler" style={{ width: tlWidth }} onMouseDown={onStartScrub}>
              {ticks.map((s) => <span key={s} className="tick" style={{ left: s * pps }}>{tickLabel(s)}</span>)}
            </div>
          </div>

          <div className="cc-zone video">
            {overlays.length > 0 && (
              <div className="cc-trow video text" data-track-id="TEXT" style={{ height: ROW_HEIGHT.text }}>
                <div className="cc-thead" onClick={stop} onMouseDown={stop}><span className="name">{t('track_text')}</span></div>
                <div className="cc-tlane" style={{ width: tlWidth }}>
                  {overlays.map((o) => (
                    <div key={o.id} className={`cc-oclip ${selOv === o.id ? 'sel' : ''}`}
                      style={{ left: o.start * pps, width: Math.max((o.end - o.start) * pps, 18) }}
                      onMouseDown={(e) => onStartOverlayMove(o, e)} onClick={(e) => e.stopPropagation()} title={o.text}>
                      <div className="oh l" onMouseDown={(e) => onStartOverlayResize(o, 'l', e)} />
                      <span>{o.text}</span>
                      <div className="oh r" onMouseDown={(e) => onStartOverlayResize(o, 'r', e)} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {<div className={`cc-newtrack video ${dragActive ? 'on' : ''} ${hoverLane === 'NEW-V' ? 'drop-hover' : ''}`} data-newtrack="video" {...dropProps({ kind: 'video', forceNew: true }, 'NEW-V')}><span>{t('track_drop_new_video')}</span></div>}
            {videoRows.map((track) => (track.id === MAIN_VIDEO_TRACK ? renderMainLane(track) : renderOverlayLane(track)))}
          </div>
          <div className="cc-zone-divider" />
          <div className="cc-zone audio">
            {audioRows.map((track) => renderAudioLane(track))}
            {<div className={`cc-newtrack audio ${dragActive ? 'on' : ''} ${hoverLane === 'NEW-A' ? 'drop-hover' : ''}`} data-newtrack="audio" {...dropProps({ kind: 'audio', forceNew: true }, 'NEW-A')}><span>{t('track_drop_new_audio')}</span></div>}
          </div>
          {hasClips && <div className="cc-playhead" style={{ left: HEAD_W + current * pps }}><div className="head" onMouseDown={onStartScrub} /></div>}
        </div>
      </div>
    </div>
  )
}
