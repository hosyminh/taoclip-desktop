import React, { useEffect, useRef, useState } from 'react'
import { fileUrl } from './utils.js'
import { stickerUrl } from './sticker-catalog.js'
import { attachDocumentMouseDrag } from './drag-utils.js'

export default function VideoOverlayPreview({ item, current, playing, onEditStart, onEditEnd, onPositionChange, safeZone = false }) {
  const videoRef = useRef(null)
  const [failed, setFailed] = useState(false)
  const active = current >= item.start && current < item.start + (item.out - item.in) / item.speed

  useEffect(() => {
    const video = videoRef.current
    if (!video || item.kind !== 'video' || !active) return
    video.playbackRate = item.speed
    const target = Math.max(0, item.in + (current - item.start) * item.speed)
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - target) > 0.12) {
      try { video.currentTime = Math.min(target, Math.max(0, video.duration - 0.02)) } catch {}
    }
    if (playing && video.paused) video.play().catch(() => setFailed(true))
    else video.pause()
  }, [active, current, item.in, item.kind, item.speed, item.start, playing])

  if (!active || item.missing || failed) return null
  const style = {
    left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%`,
    opacity: item.opacity, zIndex: 10 + item.zIndex, objectFit: 'contain'
  }
  const outsideSafe = safeZone && (item.x - item.width / 2 < 0.03 || item.x + item.width / 2 > 0.86 || item.y - item.height / 2 < 0.12 || item.y + item.height / 2 > 0.82)
  const beginPositionDrag = (event) => {
    if (!onPositionChange || event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds?.width || !bounds?.height) return
    onEditStart?.()
    const startX = event.clientX, startY = event.clientY, x = item.x, y = item.y
    const move = (next) => onPositionChange(item.id, {
      x: Math.min(1, Math.max(0, x + (next.clientX - startX) / bounds.width)),
      y: Math.min(1, Math.max(0, y + (next.clientY - startY) / bounds.height))
    })
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); onEditEnd?.() }
    attachDocumentMouseDrag(move, up)
  }
  if (item.kind === 'image') return <img className={`cc-v2-preview ${outsideSafe ? 'unsafe' : ''}`} src={item.sticker ? stickerUrl(item.sticker) : fileUrl(item.path)} alt="" draggable={false} style={style} onMouseDown={beginPositionDrag} onError={() => setFailed(true)} />
  return <video ref={videoRef} className={`cc-v2-preview ${outsideSafe ? 'unsafe' : ''}`} src={fileUrl(item.path)} muted playsInline preload="auto" style={style}
    onMouseDown={beginPositionDrag}
    onLoadedMetadata={(event) => {
      const video = event.currentTarget
      const target = Math.max(0, item.in + (current - item.start) * item.speed)
      try { video.currentTime = Math.min(target, Math.max(0, video.duration - 0.02)) } catch {}
      if (playing && active) video.play().catch(() => setFailed(true))
    }} onError={() => setFailed(true)} />
}
