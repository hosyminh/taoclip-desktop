import { useEffect, useRef } from 'react'
import { fileUrl } from './utils.js'
import { audioItemLength } from './timeline/geometry.js'

// Nghe thu mot audio item trong preview: phat khi playhead nam trong item (co loop, toc do, fade, gain); im lang khi track bi tat / khong solo.
export default function AudioItemPreview({ item, current, playing, totalDuration, audible = true }) {
  const ref = useRef(null)
  useEffect(() => {
    const audio = ref.current
    if (!audio) return
    if (item.muted || !audible) { if (!audio.paused) audio.pause(); return }
    const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
    const sourceSpan = Math.max(0.001, item.out - item.in)
    const timelineSpan = sourceSpan / speed
    const elapsed = current - item.start
    const activeSpan = audioItemLength(item, totalDuration)
    const active = elapsed >= 0 && elapsed < activeSpan
    if (!active) { if (!audio.paused) audio.pause(); return }
    const local = item.loop ? elapsed % timelineSpan : elapsed
    const target = Math.min(item.out - 0.02, item.in + local * speed)
    audio.playbackRate = speed
    try { if (Math.abs(audio.currentTime - target) > 0.2) audio.currentTime = Math.max(0, target) } catch {}
    const fadeInGain = item.fadeIn > 0 ? Math.min(1, elapsed / item.fadeIn) : 1
    const untilEnd = activeSpan - elapsed
    const fadeOutGain = item.fadeOut > 0 ? Math.min(1, untilEnd / item.fadeOut) : 1
    audio.volume = Math.max(0, Math.min(1, item.gain * fadeInGain * fadeOutGain))
    if (playing && audio.paused) audio.play().catch(() => {})
    else if (!playing && !audio.paused) audio.pause()
  }, [current, item, playing, totalDuration, audible])
  return <audio ref={ref} src={fileUrl(item.path)} preload="auto" />
}
