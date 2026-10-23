import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getEntitlements } from './entitlements.js'
import { useI18n } from './i18n.jsx'
import {
  Film, Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Repeat, Volume2, VolumeX,
  Undo2, Redo2, Upload, Scissors, Minus, Plus, Music, X, Keyboard, Image, FolderUp, Mic
} from 'lucide-react'
import {
  fmt, fileUrl, clamp, FRAME, isImg, clipOut, FILTERS, filterPreviewCss, TABS
} from './utils.js'
import MediaTab from './tabs/MediaTab.jsx'
import EffectTab from './tabs/EffectTab.jsx'
import TextTab from './tabs/TextTab.jsx'
import AudioTab from './tabs/AudioTab.jsx'
import FilterTab from './tabs/FilterTab.jsx'
import StickerTab from './tabs/StickerTab.jsx'
import TransTab from './tabs/TransTab.jsx'
import Inspector from './Inspector.jsx'
import ExportDialog from './ExportDialog.jsx'
import TopBar from './TopBar.jsx'
import ToastStack from './ToastStack.jsx'
import ShortcutsModal from './ShortcutsModal.jsx'
import RecoveryBanner from './RecoveryBanner.jsx'
import VideoOverlayPreview from './VideoOverlayPreview.jsx'
import AudioItemPreview from './AudioItemPreview.jsx'
import { normalizeProject } from './project-model.js'
import { buildTimelinePlan, fitImageDurationToTarget, mapSourceRange, mapTimelineTime, mapTimelineRangeToSources, resolvePreviewSource, toExportSegments, snapToFrameTime } from './timeline-plan.js'
import { snapshotHistoryClips, restoreHistoryClips, historySnapshotsEqual, restoreHistorySelection } from './history-model.js'
import { createAsyncResourceGuard } from './async-resource-guard.js'
import { attachDocumentMouseDrag } from './drag-utils.js'
import { aggregateBatchProgress } from './export-progress.js'

function makeEntityId(kind) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `${kind}_${value}`
}

export default function App() {
  const { t } = useI18n()
  useMemo(() => getEntitlements(), [])
  const videoRef = useRef(null)
  const overlapVideoRef = useRef(null)
  const scrollRef = useRef(null)
  const dragRef = useRef(null)
  const idRef = useRef(1)
  const activeExportJobRef = useRef(null)
  const activeExportBatchRef = useRef(null)
  const importBusyRef = useRef(false)
  const cancelImportRef = useRef(false)
  const projectIdRef = useRef(null)
  if (!projectIdRef.current) projectIdRef.current = makeEntityId('project')
  const resourceScopeRef = useRef(0)
  const asyncResourceGuardRef = useRef(createAsyncResourceGuard())
  const pendingSeekRef = useRef(null)
  const wasPlayingRef = useRef(false)
  const resumePlayRequestedRef = useRef(false)
  const frameRef = useRef(null)
  const curRef = useRef(0) // guong cua `current` cho vong phat anh (RAF)
  const musicRef = useRef(null) // <audio> nghe thu nhac trong preview
  const voiceRef = useRef(null) // <audio> nghe thu long tieng trong preview
  const [frameH, setFrameH] = useState(0)

  const [tab, setTab] = useState('media')
  const [clips, setClips] = useState([]) // {id,path,name,src,in,out,speed,thumbs}
  const [libraryAssets, setLibraryAssets] = useState([])
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  const libraryAssetsRef = useRef(libraryAssets)
  libraryAssetsRef.current = libraryAssets
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [importReport, setImportReport] = useState([])
  const [selId, setSelId] = useState(null)
  const selIdRef = useRef(selId)
  selIdRef.current = selId
  const [activeIdx, setActiveIdx] = useState(0) // clip dang nap trong <video>
  const [current, setCurrent] = useState(0) // thoi gian global timeline
  const [trimTooltip, setTrimTooltip] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewProxyBusy, setPreviewProxyBusy] = useState(false)
  const [previewSources, setPreviewSources] = useState({})
  const [ratio, setRatio] = useState('9:16')
  const [extraRatios, setExtraRatios] = useState([])
  const [safeZone, setSafeZone] = useState(false)
  const [filterKey, setFilterKey] = useState('none')
  const [filterIntensity, setFilterIntensity] = useState(100)
  const [exactFilterPreview, setExactFilterPreview] = useState('')
  const [exactFilterBusy, setExactFilterBusy] = useState(false)
  const [mode, setMode] = useState('smart')
  const [pps, setPps] = useState(80)
  const [snapEnabled, setSnapEnabled] = useState(() => localStorage.getItem('taoclip_snap') !== '0')
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [loop, setLoop] = useState(false)
  // phu de + auto-cut (chi khi 1 clip)
  const [captions, setCaptions] = useState([])
  const [captionTimebase, setCaptionTimebase] = useState('timeline')
  const [capLang, setCapLang] = useState('vietnamese')
  const [captionAudioSource, setCaptionAudioSource] = useState('video')
  const [capBusy, setCapBusy] = useState(false)
  const [capStatus, setCapStatus] = useState('')
  const [burnCaptions, setBurnCaptions] = useState(true)
  const [keepSegments, setKeepSegments] = useState(null)
  const [autoCut, setAutoCut] = useState(false)
  const [autoInfo, setAutoInfo] = useState(null)
  const [silenceParams, setSilenceParams] = useState({ threshold: -30, minSilence: 0.4, pad: 0.06 })
  const [busy, setBusy] = useState(false)
  // am thanh them: 2 track DOC LAP (nhac nen + long tieng), tron cung luc khi xuat
  const [music, setMusic] = useState(null) // {path,name}
  const [voice, setVoice] = useState(null) // {path,name}
  const musicWavePathRef = useRef(null)
  const voiceWavePathRef = useRef(null)
  musicWavePathRef.current = music?.path || null
  voiceWavePathRef.current = voice?.path || null
  const [videoOverlays, setVideoOverlays] = useState([])
  const [audioItems, setAudioItems] = useState([])
  const [musicWave, setMusicWave] = useState(null) // anh waveform cua nhac
  const [voiceWave, setVoiceWave] = useState(null) // anh waveform cua giong
  const [musicVol, setMusicVol] = useState(0.4)
  const [voiceVol, setVoiceVol] = useState(1)
  const [ducking, setDucking] = useState(true) // tu ha nhac khi co giong
  const [bgDur, setBgDur] = useState(0) // thoi luong nhac (de chia deu slideshow)
  const [voiceDur, setVoiceDur] = useState(0)
  const [voiceOffset, setVoiceOffset] = useState(0) // giay bat dau long tieng tren timeline
  const [syncMode, setSyncMode] = useState('fit') // fit = chia deu theo nhac | fixed = co dinh moi anh
  const [slideDur, setSlideDur] = useState(3) // thoi luong mac dinh moi anh (che do fixed)
  const [origVolume, setOrigVolume] = useState(1)
  const [bgLoop, setBgLoop] = useState(true)
  const [ttsText, setTtsText] = useState('')
  const ttsTextRef = useRef(ttsText)
  ttsTextRef.current = ttsText
  const [ttsBusy, setTtsBusy] = useState(false)
  const [ttsStatus, setTtsStatus] = useState('')
  // TTS engine (local mms-tts | google cloud)
  const [ttsEngine, setTtsEngine] = useState('local')
  const [ttsVoice, setTtsVoice] = useState('')
  const [ttsVoices, setTtsVoices] = useState([])
  const [ttsRate, setTtsRate] = useState(1)
  const [ttsPitch, setTtsPitch] = useState(0)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState({ configured: false, persistent: false, encrypted: false })
  const [localTtsModel, setLocalTtsModel] = useState(null)
  const [voicesLoading, setVoicesLoading] = useState(false)
  const ttsVoiceRequestRef = useRef(0)
  const ttsPreviewRef = useRef(null)
  // doi giong video (re-dub): Whisper -> TTS tung cau -> track long tieng
  const [redubBusy, setRedubBusy] = useState(false)
  const [redubStatus, setRedubStatus] = useState('')
  const [redubSegments, setRedubSegments] = useState([])
  const redubSegmentsRef = useRef(redubSegments)
  redubSegmentsRef.current = redubSegments
  const [redubKeepOriginal, setRedubKeepOriginal] = useState(false)
  // doi nen AI (RVM local)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiStatus, setAiStatus] = useState('')
  const [aiModelStatus, setAiModelStatus] = useState(null)
  const [aiPreviewPath, setAiPreviewPath] = useState('')
  const [aiPreviewStart, setAiPreviewStart] = useState(0)
  const [aiPreviewDuration, setAiPreviewDuration] = useState(2)
  const [aiProcWidth, setAiProcWidth] = useState(640)
  // doi khuon mat AI (insightface local)
  const [faceBusy, setFaceBusy] = useState(false)
  const [faceStatus, setFaceStatus] = useState('')
  const [facePreviewPath, setFacePreviewPath] = useState('')
  const [aiEdited, setAiEdited] = useState(false) // co noi dung do AI tao/chinh -> danh dau khi xuat
  // tai video tu link (yt-dlp)
  const [dlBusy, setDlBusy] = useState(false)
  const [dlStatus, setDlStatus] = useState('')
  // chu / sticker overlay
  const [overlays, setOverlays] = useState([]) // {id,type,text,start,end,x,y,size,color}
  const [selOv, setSelOv] = useState(null)
  // tang toc + chuyen canh + keo-tha sap xep
  const [gpuEnc, setGpuEnc] = useState('cpu')
  const [useGpu, setUseGpu] = useState(true)
  const [quality, setQuality] = useState(() => { try { const v = localStorage.getItem('taoclip_quality'); return ['high', 'standard', 'small'].includes(v) ? v : 'standard' } catch { return 'standard' } })
  const [resolution, setResolution] = useState(() => { try { const v = localStorage.getItem('taoclip_resolution'); return ['720', '1080', '1440'].includes(v) ? v : '1080' } catch { return '1080' } })
  useEffect(() => { try { localStorage.setItem('taoclip_quality', quality); localStorage.setItem('taoclip_resolution', resolution) } catch {} }, [quality, resolution])
  const [transition, setTransition] = useState('none') // none | fade | cross
  const [transitionDuration, setTransitionDuration] = useState(0.5)
  const [dragInsert, setDragInsert] = useState(null)
  // xuat
  const [exporting, setExporting] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [expStage, setExpStage] = useState('core')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [dragOver, setDragOver] = useState(false)
  // lich su (snapshot clips)
  const [hist, setHist] = useState([])
  const [future, setFuture] = useState([])
  const [projectPath, setProjectPath] = useState('')
  const [collectingProject, setCollectingProject] = useState(false)
  const collectingProjectRef = useRef(false)
  const [savedProjectSerialized, setSavedProjectSerialized] = useState(null)
  const pendingProjectCleanRef = useRef(false)
  const editRevisionRef = useRef(0)
  const pendingHistoryEditRef = useRef(null)
  const undoRef = useRef(null)
  const redoRef = useRef(null)
  // tu luu / khoi phuc
  const [recover, setRecover] = useState(null)
  const autosaveRef = useRef(null)
  // toast thong bao + bang phim tat
  const [toasts, setToasts] = useState([]) // {id,type:'ok'|'err',msg,action?:{label,run}}
  const [showKeys, setShowKeys] = useState(false)
  // keo gian panel (nho kich thuoc)
  const [libW, setLibW] = useState(() => clamp(Number(localStorage.getItem('taoclip_libw')) || 290, 200, 480))
  const [inspW, setInspW] = useState(() => clamp(Number(localStorage.getItem('taoclip_inspw')) || 280, 220, 460))
  const [tlH, setTlH] = useState(() => clamp(Number(localStorage.getItem('taoclip_tlh')) || 280, 160, 480))

  function notify(msg, type = 'ok', action) {
    const id = 'n' + (idRef.current++)
    setToasts((ts) => [...ts, { id, msg, type, action }])
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), type === 'err' ? 8000 : 5000)
  }
  const closeToast = (id) => setToasts((ts) => ts.filter((x) => x.id !== id))

  // Keo gian panel trai / phai / timeline
  function startPanelResize(kind, e) {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY, l0 = libW, i0 = inspW, t0 = tlH
    const move = (ev) => {
      if (kind === 'lib') setLibW(clamp(l0 + (ev.clientX - sx), 200, 480))
      else if (kind === 'insp') setInspW(clamp(i0 - (ev.clientX - sx), 220, 460))
      else setTlH(clamp(t0 - (ev.clientY - sy), 160, 480))
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    attachDocumentMouseDrag(move, up)
  }

  const single = clips.length === 1
  const filter = { ...(FILTERS.find((f) => f.k === filterKey) || FILTERS[0]), css: filterPreviewCss(filterKey, filterIntensity) }
  const selectedClip = clips.find((c) => c.id === selId) || null

  // Bo cuc timeline: moi clip 1 doan [start,end] theo thoi gian output
  const timelinePlan = useMemo(() => buildTimelinePlan(clips.map((clip) => ({
    id: clip.id, path: clip.path, kind: isImg(clip) ? 'image' : 'video', in: clip.in,
    out: clip.out, speed: clip.speed
  })), { transition, transitionDuration,
    keepByClip: autoCut && clips.length === 1 && keepSegments ? { [clips[0].id]: keepSegments } : {} }), [clips, transition, transitionDuration, autoCut, keepSegments])
  const layout = useMemo(() => timelinePlan.entries.map((entry, entryIndex) => ({
    ...entry, id: entry.clipId, key: `${entry.clipId}:${entryIndex}`, entryIndex,
    clip: clips.find((clip) => clip.id === entry.clipId)
  })), [timelinePlan, clips])
  const totalDuration = timelinePlan.duration
  const activeClip = clips[activeIdx] || null
  const activeIsImage = isImg(activeClip)
  const previewCropStyle = activeClip?.cropMode === 'fill' || (activeIsImage && activeClip?.kenBurns !== false)
    ? { objectFit: 'cover', objectPosition: `${(activeClip.cropX ?? 0.5) * 100}% ${(activeClip.cropY ?? 0.5) * 100}%` }
    : { objectFit: 'contain', objectPosition: '50% 50%' }
  const originalSource = clips[0]?.src
  const originalWidth = Math.abs(Number(originalSource?.rotation) || 0) % 180 === 90 ? originalSource?.height : originalSource?.width
  const originalHeight = Math.abs(Number(originalSource?.rotation) || 0) % 180 === 90 ? originalSource?.width : originalSource?.height
  const frameStyle = ratio === 'original'
    ? { aspectRatio: `${originalWidth || 9} / ${originalHeight || 16}`, height: '100%', width: 'auto', maxWidth: '100%' }
    : { aspectRatio: ratio.replace(':', '/') }
  const activePreviewOverride = activeClip && previewSources[activeClip.id]?.sourcePath === activeClip.path ? previewSources[activeClip.id] : null
  const videoSrc = activeClip && !activeIsImage && !activeClip.missing ? fileUrl(activePreviewOverride?.proxyPath || activeClip.path) : null
  const imageSrc = activeClip && activeIsImage && !activeClip.missing ? fileUrl(activeClip.path) : null

  useEffect(() => {
    if (!activeClip || activeClip.missing) { setPreviewLoading(false); setPreviewError(''); return }
    setPreviewLoading(true); setPreviewError('')
  }, [activeClip?.id, activeClip?.path, activeClip?.missing])
  const overlapPreview = useMemo(() => {
    const sources = mapTimelineTime(timelinePlan, current)
    if (sources.length < 2) return null
    const incoming = sources.find((source) => timelinePlan.entries[source.entryIndex]?.overlapIn > 0)
    const outgoing = sources.find((source) => source !== incoming)
    if (!incoming || !outgoing) return null
    const entry = timelinePlan.entries[incoming.entryIndex]
    const progress = clamp((current - entry.start) / entry.overlapIn, 0, 1)
    return { incoming, outgoing, progress,
      incomingClip: clips.find((clip) => clip.id === incoming.clipId),
      outgoingClip: clips.find((clip) => clip.id === outgoing.clipId) }
  }, [timelinePlan, current, clips])
  const mainPreviewWeight = overlapPreview
    ? (activeClip?.id === overlapPreview.incoming.clipId ? overlapPreview.progress : 1 - overlapPreview.progress)
    : 1
  let fadePreviewOpacity = 1
  if (transition === 'fade') {
    const index = layout.findIndex((entry) => current >= entry.start && current < entry.end)
    const entry = layout[index], next = layout[index + 1]
    if (entry) {
      const fadeLength = Math.min(transitionDuration, entry.duration / 2)
      if (entry.transitionIn === 'fade' && fadeLength > 0) fadePreviewOpacity = Math.min(fadePreviewOpacity, clamp((current - entry.start) / fadeLength, 0, 1))
      if (next?.transitionIn === 'fade' && fadeLength > 0 && current >= entry.end - fadeLength) {
        fadePreviewOpacity = Math.min(fadePreviewOpacity, clamp((entry.end - current) / fadeLength, 0, 1))
      }
    }
  }
  const mainPreviewOpacity = mainPreviewWeight * fadePreviewOpacity
  const imageCount = useMemo(() => clips.filter(isImg).length, [clips])
  const fitSlideDuration = useMemo(() => clips.find(isImg)?.out ?? slideDur, [clips, slideDur])
  const fitMusicDuration = useMemo(() => Math.max(bgDur, ...audioItems.filter((item) => item.track === 'music' && !item.muted)
    .map((item) => Math.max(0, Number(item.start) || 0) + Math.max(0, (Number(item.out) || 0) - (Number(item.in) || 0)))), [bgDur, audioItems])
  const hasFitMusic = !!music || audioItems.some((item) => item.track === 'music' && !item.muted)

  useEffect(() => window.taoclip.onExportProgress((payload) => {
    const batch = activeExportBatchRef.current
    if (!payload || payload.jobId !== activeExportJobRef.current || !batch) return
    setProgress(aggregateBatchProgress(batch.index, batch.count, payload.progress))
  }), [])
  useEffect(() => window.taoclip.onExportStage?.((payload) => {
    if (payload?.jobId === activeExportJobRef.current) {
      setExpStage(payload.stage)
      if (payload.stage === 'gpu-fallback-cpu') setStatus(t('export_gpu_fallback'))
    }
  }) || undefined, [])
  useEffect(() => { window.taoclip.getEncoder().then(setGpuEnc).catch(() => {}) }, [])
  useEffect(() => {
    window.taoclip.getApiKeyStatus?.().then((status) => { setApiKeyStatus(status); setHasKey(!!status.configured) }).catch(() => {})
    window.taoclip.getLocalTtsModelStatus?.().then(setLocalTtsModel).catch(() => {})
    window.taoclip.getAiModelStatus?.().then(setAiModelStatus).catch(() => {})
  }, [])
  useEffect(() => { setAiPreviewStart(selectedClip?.in ?? 0); setAiPreviewPath(''); setFacePreviewPath('') }, [selectedClip?.id])
  // Khi chuyen sang Google va da co key -> tu nap danh sach giong
  useEffect(() => { if (ttsEngine === 'google' && hasKey && !ttsVoices.length && !voicesLoading) loadVoices() }, [ttsEngine, hasKey])
  // Do chieu cao khung preview -> tinh co chu/sticker overlay theo px (dung moi ti le)
  useEffect(() => {
    const el = frameRef.current; if (!el) { setFrameH(0); return }
    const ro = new ResizeObserver((es) => { for (const e of es) setFrameH(e.contentRect.height) })
    ro.observe(el); return () => ro.disconnect()
  }, [activeIdx, ratio, clips.length])
  // Kiem tra phien tu luu truoc do (chi 1 lan luc mo)
  useEffect(() => {
    window.taoclip.latestRecovery?.().then((record) => {
      if (record?.project) setRecover(record)
      if (record?.corruptPrevious) notify(t('msg_recovery_corrupt'), 'err')
    }).catch(() => {})
  }, [])
  // Nho kich thuoc panel
  useEffect(() => {
    try { localStorage.setItem('taoclip_libw', libW); localStorage.setItem('taoclip_inspw', inspW); localStorage.setItem('taoclip_tlh', tlH) } catch {}
  }, [libW, inspW, tlH])
  useEffect(() => { try { localStorage.setItem('taoclip_snap', snapEnabled ? '1' : '0') } catch {} }, [snapEnabled])
  // Meo lan dau mo app: chi hien 1 lan
  useEffect(() => {
    try {
      if (!localStorage.getItem('taoclip_tip_keys')) {
        localStorage.setItem('taoclip_tip_keys', '1')
        setTimeout(() => notify(t('tip_first')), 1500)
      }
    } catch {}
  }, [])
  // Tu luu (debounce 1.2s) khi du an thay doi
  useEffect(() => {
    clearTimeout(autosaveRef.current)
    autosaveRef.current = setTimeout(() => { window.taoclip.writeRecovery?.(buildProject()).catch(() => {}) }, 1200)
    return () => clearTimeout(autosaveRef.current)
  }, [clips, ratio, filterKey, filterIntensity, mode, captions, overlays, videoOverlays, audioItems, music, voice, musicVol, voiceVol, ducking, origVolume, bgLoop, transition, transitionDuration, burnCaptions, syncMode, slideDur, bgDur, voiceDur, voiceOffset, keepSegments, autoCut, autoInfo, aiEdited, ttsEngine, ttsVoice, ttsRate, ttsPitch, silenceParams])
  useEffect(() => {
    const ids = new Set(clips.map((clip) => clip.id))
    asyncResourceGuardRef.current.prune((key) => {
      const match = /^clip:(.+):(thumbnail|waveform)$/.exec(key)
      return !match || ids.has(match[1])
    })
  }, [clips])
  useEffect(() => {
    const selected = clips.find((clip) => clip.id === selId)
    if (selected?.path && !selected.missing) window.taoclip.prioritizeMediaCache?.(selected.path).catch(() => {})
  }, [selId, clips])
  useEffect(() => {
    const video = videoRef.current
    if (video) { video.volume = volume * origVolume * mainPreviewOpacity; video.muted = muted }
  }, [volume, muted, origVolume, activeIdx, mainPreviewOpacity])
  useEffect(() => {
    const video = overlapVideoRef.current
    if (!video || !overlapPreview) return
    const other = activeClip?.id === overlapPreview.incoming.clipId ? overlapPreview.outgoing : overlapPreview.incoming
    const otherClip = activeClip?.id === overlapPreview.incoming.clipId ? overlapPreview.outgoingClip : overlapPreview.incomingClip
    if (!otherClip || otherClip.missing || isImg(otherClip)) { video.pause(); return }
    video.playbackRate = otherClip.speed || 1
    video.volume = volume * origVolume * (1 - mainPreviewWeight)
    video.muted = muted || !otherClip.src?.hasAudio
    if (Number.isFinite(video.duration) && video.duration > 0 && Math.abs(video.currentTime - other.sourceTime) > 0.12) {
      try { video.currentTime = clamp(other.sourceTime, 0, Math.max(0, video.duration - 0.02)) } catch {}
    }
    if (playing) video.play().catch(() => {})
    else video.pause()
  }, [overlapPreview, activeClip, mainPreviewWeight, volume, muted, origVolume, playing])
  // Giu activeIdx & current trong pham vi hop le khi xoa/doi thu tu/cat clip
  useEffect(() => { if (activeIdx > clips.length - 1) setActiveIdx(Math.max(0, clips.length - 1)) }, [clips.length, activeIdx])
  useEffect(() => { if (current > totalDuration) setCurrent(totalDuration) }, [totalDuration, current])
  useEffect(() => { curRef.current = current }, [current])
  useEffect(() => { if (!playing) wasPlayingRef.current = false }, [playing])

  // ---- Fit slideshow around existing V1 video lengths and transition overlaps ----
  useEffect(() => {
    if (syncMode !== 'fit' || !fitMusicDuration || !hasFitMusic || !imageCount) return
    const fitted = fitImageDurationToTarget(clips.map((clip) => ({ id: clip.id, path: clip.path,
      kind: isImg(clip) ? 'image' : 'video', in: clip.in, out: clip.out, speed: clip.speed || 1 })), fitMusicDuration,
    { transition, transitionDuration, keepByClip: autoCut && clips.length === 1 && keepSegments ? { [clips[0].id]: keepSegments } : {} })
    if (!fitted) return
    const per = fitted.imageDuration
    setClips((items) => {
      if (items.filter(isImg).every((clip) => clip.in === 0 && Math.abs(clip.out - per) < 0.005)) return items
      return items.map((clip) => isImg(clip) ? { ...clip, in: 0, out: per } : clip)
    })
  }, [syncMode, fitMusicDuration, hasFitMusic, imageCount, clips, transition, transitionDuration, autoCut, keepSegments])

  // Phai khai bao truoc moi hook co seekGlobal trong mang phu thuoc (const khong duoc hoist: dung som se loi TDZ luc render)
  const seekGlobal = useCallback((gt) => {
    gt = clamp(gt, 0, totalDuration || 0)
    const source = resolvePreviewSource(timelinePlan, gt)
    const idx = source ? clips.findIndex((c) => c.id === source.clipId) : -1
    const srcTime = source?.sourceTime
    if (idx < 0) { setCurrent(gt); return }
    if (idx !== activeIdx) { pendingSeekRef.current = srcTime; setActiveIdx(idx) }
    else if (videoRef.current) {
      if (videoRef.current.readyState >= 1) { try { videoRef.current.currentTime = srcTime } catch { pendingSeekRef.current = srcTime } }
      else pendingSeekRef.current = srcTime
    }
    curRef.current = gt; setCurrent(gt)
    const a = musicRef.current
    if (a && bgDur) { try { a.currentTime = bgLoop ? gt % bgDur : Math.min(gt, bgDur) } catch (e) {} }
    const vv = voiceRef.current
    if (vv) { try { vv.currentTime = clamp(gt - voiceOffset, 0, vv.duration || voiceDur || 0) } catch (e) {} }
  }, [timelinePlan, totalDuration, clips, activeIdx, bgDur, bgLoop, voiceDur, voiceOffset])

  // ---- Vong phat cho ANH (khong co <video> lam dong ho) ----
  useEffect(() => {
    if (!playing || !activeIsImage) return
    let raf, last = performance.now()
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now
      if (previewLoading) { raf = requestAnimationFrame(tick); return }
      if (previewError) { setPlaying(false); return }
      const seg = layout[activeIdx]
      if (!seg) { raf = requestAnimationFrame(tick); return }
      const nc = curRef.current + dt
      if (nc >= totalDuration - 0.002) {
        if (loop) { curRef.current = 0; setCurrent(0); seekGlobal(0); last = now; raf = requestAnimationFrame(tick); return }
        setCurrent(totalDuration); setPlaying(false); return
      }
      curRef.current = nc; setCurrent(nc)
      const preview = resolvePreviewSource(timelinePlan, nc)
      const nextIdx = preview ? clips.findIndex((clip) => clip.id === preview.clipId) : -1
      if (nextIdx >= 0 && nextIdx !== activeIdx) {
        wasPlayingRef.current = true; pendingSeekRef.current = preview.sourceTime; setActiveIdx(nextIdx); return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, activeIsImage, activeIdx, layout, clips, loop, totalDuration, timelinePlan, seekGlobal, previewLoading, previewError])

  // ---- Nghe thu nhac nen trong preview (dong bo tho theo playhead) ----
  useEffect(() => {
    const a = musicRef.current
    if (a) { a.volume = musicVol; if (playing) a.play().catch(() => {}); else a.pause() }
  }, [playing, music, musicVol])
  // ---- Nghe thu long tieng: chi phat khi playhead vao vung [voiceOffset, voiceOffset+dur] ----
  useEffect(() => {
    const v = voiceRef.current; if (!v || !voice) return
    v.volume = voiceVol
    const local = current - voiceOffset
    const dur = v.duration || voiceDur || 0
    if (playing && local >= -0.05 && local < dur - 0.05) {
      if (v.paused) { try { if (Math.abs(v.currentTime - local) > 0.35) v.currentTime = Math.max(0, local) } catch (e) {}; v.play().catch(() => {}) }
    } else if (!v.paused) v.pause()
  }, [current, playing, voice, voiceVol, voiceOffset, voiceDur])

  // ---- Lich su (snapshot toan bo noi dung du an: clips + overlay + phu de + audio) ----
  function snapshot() {
    return {
      selectedClipId: selId, selectedOverlayId: selOv, activeClipId: clips[activeIdx]?.id || null, activeClipIndex: activeIdx,
      clips: snapshotHistoryClips(clips), libraryAssets, overlays, videoOverlays, audioItems, captions, captionTimebase, music, voice, bgDur, voiceDur, voiceOffset,
      ratio, filterKey, filterIntensity, mode, transition, transitionDuration, burnCaptions,
      musicVol, voiceVol, origVolume, ducking, bgLoop, syncMode, slideDur,
      ttsEngine, ttsVoice, ttsRate, ttsPitch, keepSegments, autoCut, autoInfo, aiEdited, silenceParams
    }
  }
  function snapshotsEqual(a, b) {
    return historySnapshotsEqual(a, b)
  }
  function beginHistoryEdit() {
    if (pendingHistoryEditRef.current) return
    const before = snapshot()
    const last = hist[hist.length - 1]
    const added = !(last && snapshotsEqual(last, before))
    const revisionBefore = editRevisionRef.current
    if (added) setHist((items) => [...items.slice(-49), before])
    setFuture([])
    editRevisionRef.current++
    pendingHistoryEditRef.current = { before, added, futureBefore: future, revisionBefore, revisionAtStart: editRevisionRef.current }
  }
  function endHistoryEdit() {
    const pending = pendingHistoryEditRef.current
    if (!pending) return
    pendingHistoryEditRef.current = null
    if (snapshotsEqual(snapshot(), pending.before)) {
      if (pending.added) setHist((items) => items[items.length - 1] === pending.before ? items.slice(0, -1) : items)
      setFuture(pending.futureBefore)
      if (editRevisionRef.current === pending.revisionAtStart) editRevisionRef.current = pending.revisionBefore
    }
  }
  function restore(s) {
    const restoredClips = restoreHistoryClips(s.clips, clips)
    const restoredSelection = restoreHistorySelection(s, restoredClips, s.overlays || [], activeIdx)
    setClips(restoredClips)
    setLibraryAssets(s.libraryAssets || [])
    setSelId(restoredSelection.selectedClipId); setSelOv(restoredSelection.selectedOverlayId); setActiveIdx(restoredSelection.activeClipIndex)
    restoredClips.forEach((clip) => {
      if (clip.kind !== 'image' && !clip.missing && !clip.thumbs?.length) loadThumbnails(clip.id, clip.path)
      if (clip.kind !== 'image' && !clip.missing && clip.src?.hasAudio && !clip.wave) loadWave(clip.id, clip.path, true)
    })
    setOverlays(s.overlays || []); setVideoOverlays(s.videoOverlays || []); setAudioItems(s.audioItems || []); setCaptions(s.captions || []); setCaptionTimebase(s.captionTimebase || 'timeline')
    commitMusic(s.music ?? null); commitVoice(s.voice ?? null)
    setMusicWave(null); setVoiceWave(null)
    if (s.music?.path) loadTrackWave('music', s.music.path)
    if (s.voice?.path) loadTrackWave('voice', s.voice.path)
    setBgDur(s.bgDur ?? 0); setVoiceDur(s.voiceDur ?? 0); setVoiceOffset(s.voiceOffset ?? 0)
    setRatio(s.ratio || '9:16'); setFilterKey(s.filterKey || 'none'); setFilterIntensity(s.filterIntensity ?? 100); setMode(s.mode || 'smart')
    setTransition(s.transition || 'none'); setTransitionDuration(s.transitionDuration ?? 0.5); setBurnCaptions(s.burnCaptions !== false)
    setMusicVol(s.musicVol ?? 0.4); setVoiceVol(s.voiceVol ?? 1); setOrigVolume(s.origVolume ?? 1)
    setDucking(s.ducking !== false); setBgLoop(s.bgLoop !== false); setSyncMode(s.syncMode || 'fit'); setSlideDur(s.slideDur ?? 3)
    setTtsEngine(s.ttsEngine || 'local'); setTtsVoice(s.ttsVoice || ''); setTtsRate(s.ttsRate ?? 1); setTtsPitch(s.ttsPitch ?? 0)
    setKeepSegments(s.keepSegments ?? null); setAutoCut(!!s.autoCut); setAutoInfo(s.autoInfo ?? null); setAiEdited(!!s.aiEdited)
    setSilenceParams(s.silenceParams || (s.autoInfo?.options ? {
      threshold: Number.parseFloat(s.autoInfo.options.noise) || -30,
      minSilence: s.autoInfo.options.minSilence ?? 0.4, pad: s.autoInfo.options.pad ?? 0.06
    } : { threshold: -30, minSilence: 0.4, pad: 0.06 }))
  }
  function pushHistory() {
    endHistoryEdit()
    editRevisionRef.current++
    const s = snapshot()
    setHist((h) => {
      const last = h[h.length - 1]
      if (last && snapshotsEqual(last, s)) return h
      return [...h.slice(-49), s]
    })
    setFuture([])
  }
  function changeRatio(value) { if (value !== ratio) { pushHistory(); setRatio(value) } }
  function changeFilter(value) { if (value !== filterKey) { pushHistory(); setFilterKey(value); setExactFilterPreview('') } }
  function changeFilterIntensity(value) { const next = clamp(Number(value), 0, 100); setFilterIntensity(next); setExactFilterPreview('') }
  async function renderExactFilterPreview() {
    const source = playheadInClip()
    if (!source) return
    const scope = resourceScopeRef.current
    const revision = editRevisionRef.current
    const request = { clipId: source.clip.id, path: source.clip.path, time: source.src, filterKey, intensity: filterIntensity }
    setExactFilterBusy(true)
    try {
      const preview = await window.taoclip.renderFilterPreview({ input: request.path, time: request.time, filterKey: request.filterKey, intensity: request.intensity })
      if (scope === resourceScopeRef.current && revision === editRevisionRef.current && clipsRef.current.some((clip) => clip.id === request.clipId && clip.path === request.path)) setExactFilterPreview(preview)
    }
    catch (error) {
      if (scope === resourceScopeRef.current && revision === editRevisionRef.current) notify(t('filter_render_error', { e: error.message || error }), 'err')
    }
    finally { setExactFilterBusy(false) }
  }
  function changeTransition(value) {
    if (value !== transition) {
      pushHistory(); setTransition(value)
      setCaptions((items) => remapAnchoredCaptions(clips, items, value, autoCut, keepSegments, transitionDuration))
    }
  }
  function changeTransitionDuration(value) {
    const duration = clamp(Number(value), 0.1, 2)
    if (duration === transitionDuration) return
    setTransitionDuration(duration); setCaptions((items) => remapAnchoredCaptions(clips, items, transition, autoCut, keepSegments, duration))
  }
  function changeMode(value) { if (value !== mode) { pushHistory(); setMode(value) } }
  function changeBurnCaptions(value) { if (value !== burnCaptions) { pushHistory(); setBurnCaptions(value) } }
  function changeSyncMode(value) { if (value !== syncMode) { pushHistory(); setSyncMode(value) } }
  function changeAutoCut(value) {
    if (value === autoCut) return
    pushHistory(); setAutoCut(value)
    setCaptions((items) => remapAnchoredCaptions(clips, items, transition, value, keepSegments))
  }
  function undo() {
    if (pendingHistoryEditRef.current) {
      endHistoryEdit()
      setTimeout(() => undoRef.current?.(), 0)
      return
    }
    if (!hist.length) return
    editRevisionRef.current++
    const previous = hist[hist.length - 1]
    const current = snapshot()
    setFuture((f) => [current, ...f].slice(0, 50))
    setHist((h) => h.slice(0, -1))
    restore(previous)
  }
  function redo() {
    if (pendingHistoryEditRef.current) {
      endHistoryEdit()
      setTimeout(() => redoRef.current?.(), 0)
      return
    }
    if (!future.length) return
    editRevisionRef.current++
    const next = future[0]
    const current = snapshot()
    setHist((h) => [...h, current].slice(-50))
    setFuture((f) => f.slice(1))
    restore(next)
  }
  undoRef.current = undo
  redoRef.current = redo

  // ---- Unified import pipeline: inspect content, report each file, then commit successful items once. ----
  async function importMedia(paths, allowedKinds = ['video', 'image', 'audio']) {
    if (importBusyRef.current) return { added: 0, busy: true }
    const importScope = resourceScopeRef.current
    importBusyRef.current = true; cancelImportRef.current = false
    setImporting(true); setImportReport([])
    const built = [], libraryAdditions = [], failures = [], seen = new Set(clips.map((clip) => normalizeMediaPath(clip.path)))
    let musicCandidate = null, duplicates = 0
    const inputs = [...new Set((paths || []).filter(Boolean))]
    try {
      for (let i = 0; i < inputs.length; i++) {
        if (resourceScopeRef.current !== importScope) {
          setStatus(t('msg_project_changed_import'))
          return { added: 0, stale: true }
        }
        if (cancelImportRef.current) break
        const p = inputs[i], key = normalizeMediaPath(p), name = p.split(/[\\/]/).pop()
        setImportProgress(`${i + 1}/${inputs.length} · ${name}`)
        if (seen.has(key) || (music?.path && normalizeMediaPath(music.path) === key)) {
          duplicates++; failures.push({ path: name, reason: t('msg_already_in_project') }); continue
        }
        seen.add(key)
        try {
          const media = await window.taoclip.inspectMedia(p)
          if (resourceScopeRef.current !== importScope) {
            setStatus(t('msg_project_changed_import'))
            return { added: 0, stale: true }
          }
          if (!allowedKinds.includes(media.kind)) throw new Error(media.kind === 'audio' ? t('msg_audio_unsupported_here') : t('msg_media_kind_mismatch'))
          if (media.kind === 'audio') {
            if (!musicCandidate) { musicCandidate = { path: p, name }; libraryAdditions.push(makeLibraryAsset(p, 'audio', media)) }
            else failures.push({ path: name, reason: t('msg_one_music_only') })
          } else if (media.kind === 'image') {
            libraryAdditions.push(makeLibraryAsset(p, 'image', media))
            built.push({ id: makeEntityId('clip'), kind: 'image', path: p, name,
              animated: media.formatName === 'gif',
              src: { duration: media.duration || slideDur, width: media.width, height: media.height,
                hasAudio: false, isImage: true, rotation: media.rotation || 0 },
              in: 0, out: slideDur, speed: 1, kenBurns: true, thumbs: [p] })
          } else {
            libraryAdditions.push(makeLibraryAsset(p, 'video', media))
            built.push({ id: makeEntityId('clip'), path: p, name, src: media, in: 0,
              out: media.duration, speed: 1, thumbs: [] })
          }
        } catch (error) { failures.push({ path: name, reason: String(error.message || error).slice(0, 240) }) }
      }
      if (resourceScopeRef.current !== importScope) {
        setStatus(t('msg_project_changed_import'))
        return { added: 0, stale: true }
      }
      if (built.length || musicCandidate) {
        pushHistory()
        addLibraryAssets(libraryAdditions)
        if (built.length) {
          setClips((cs) => [...cs, ...built])
          setSelId((prev) => prev || built[0].id)
          built.filter((clip) => !isImg(clip)).forEach((clip) => {
            loadThumbnails(clip.id, clip.path)
            loadWave(clip.id, clip.path, clip.src.hasAudio)
          })
        }
        if (musicCandidate) {
          const musicDurationTicket = asyncResourceGuardRef.current.begin('track:music:duration', musicCandidate.path, importScope)
          commitMusic(musicCandidate); setBgLoop(true); setMusicVol(0.4); setMusicWave(null)
          loadTrackWave('music', musicCandidate.path)
          try {
            const metadata = await window.taoclip.probe(musicCandidate.path)
            if (asyncResourceGuardRef.current.isCurrent(musicDurationTicket, musicWavePathRef.current, resourceScopeRef.current)) setBgDur(metadata.duration || 0)
          } catch {
            if (asyncResourceGuardRef.current.isCurrent(musicDurationTicket, musicWavePathRef.current, resourceScopeRef.current)) setBgDur(0)
          }
        }
      }
      const result = [...built.map((item) => ({ path: item.name, ok: true })),
        ...(musicCandidate ? [{ path: musicCandidate.name, ok: true }] : []), ...failures]
      setImportReport(result)
      const cancelled = cancelImportRef.current && built.length < inputs.length
      setStatus(t('msg_import_summary', { n: built.length + (musicCandidate ? 1 : 0), f: failures.length }) + (cancelled ? ` · ${t('msg_cancelled_suffix')}` : '') + (duplicates ? ` · ${t('msg_dup_suffix', { n: duplicates })}` : ''))
      return { added: built.length + (musicCandidate ? 1 : 0), failed: failures.length, cancelled }
    } finally {
      importBusyRef.current = false; cancelImportRef.current = false
      setImporting(false); setImportProgress('')
    }
  }
  function normalizeMediaPath(value) { return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  function makeLibraryAsset(mediaPath, kind, metadata = null, source = 'local') {
    return { id: makeEntityId('asset'), path: mediaPath, name: mediaPath.split(/[\\/]/).pop(), kind, source,
      missing: false, metadata: metadata && typeof metadata === 'object' ? metadata : null }
  }
  function addLibraryAssets(additions) {
    if (!additions?.length) return
    setLibraryAssets((items) => {
      const byPath = new Map(items.map((item) => [normalizeMediaPath(item.path), item]))
      for (const asset of additions) {
        const key = normalizeMediaPath(asset.path), existing = byPath.get(key)
        byPath.set(key, existing ? { ...existing, missing: false, metadata: asset.metadata || existing.metadata } : asset)
      }
      return [...byPath.values()]
    })
  }
  function cancelImport() { if (importBusyRef.current) cancelImportRef.current = true }
  async function addClips(paths) { return importMedia(paths, ['video']) }
  function loadThumbnails(id, mediaPath) {
    const key = `clip:${id}:thumbnail`
    const ticket = asyncResourceGuardRef.current.begin(key, mediaPath, resourceScopeRef.current)
    setClips((items) => items.map((item) => item.id === id && item.path === mediaPath && asyncResourceGuardRef.current.isCurrent(ticket, item.path, resourceScopeRef.current)
      ? { ...item, thumbLoading: true, thumbError: false } : item))
    return window.taoclip.thumbnails(mediaPath, 8).then((thumbs) => {
      if (!thumbs?.length) throw new Error(t('msg_thumb_fail'))
      setClips((items) => items.map((item) => item.id === id && item.path === mediaPath && asyncResourceGuardRef.current.isCurrent(ticket, item.path, resourceScopeRef.current)
        ? { ...item, thumbs, thumbLoading: false, thumbError: false } : item))
    }).catch(() => setClips((items) => items.map((item) => item.id === id && item.path === mediaPath && asyncResourceGuardRef.current.isCurrent(ticket, item.path, resourceScopeRef.current)
      ? { ...item, thumbLoading: false, thumbError: true } : item)))
  }
  // Nap anh waveform (dang song) cho 1 clip — bat dong bo, cache o main process
  function loadWave(id, p, hasAudio) {
    if (!hasAudio || !window.taoclip.waveform) return
    const key = `clip:${id}:waveform`
    const ticket = asyncResourceGuardRef.current.begin(key, p, resourceScopeRef.current)
    setClips((items) => items.map((item) => item.id === id && item.path === p && asyncResourceGuardRef.current.isCurrent(ticket, item.path, resourceScopeRef.current)
      ? { ...item, waveLoading: true, waveError: false } : item))
    window.taoclip.waveform(p).then((wave) => {
      if (!wave) throw new Error(t('msg_wave_fail'))
      setClips((items) => items.map((item) => item.id === id && item.path === p && asyncResourceGuardRef.current.isCurrent(ticket, item.path, resourceScopeRef.current)
        ? { ...item, wave, waveLoading: false, waveError: false } : item))
    }).catch(() => setClips((items) => items.map((item) => item.id === id && item.path === p && asyncResourceGuardRef.current.isCurrent(ticket, item.path, resourceScopeRef.current)
      ? { ...item, waveLoading: false, waveError: true } : item)))
  }
  function commitMusic(value) { musicWavePathRef.current = value?.path || null; setMusic(value) }
  function commitVoice(value) { voiceWavePathRef.current = value?.path || null; setVoice(value) }
  function loadTrackWave(track, mediaPath) {
    if (!mediaPath || !window.taoclip.waveform) return
    const key = `track:${track}:waveform`
    const ticket = asyncResourceGuardRef.current.begin(key, mediaPath, resourceScopeRef.current)
    window.taoclip.waveform(mediaPath).then((wave) => {
      if (!asyncResourceGuardRef.current.isCurrent(ticket, track === 'music' ? musicWavePathRef.current : voiceWavePathRef.current, resourceScopeRef.current)) return
      if (track === 'music') setMusicWave(wave || null)
      else setVoiceWave(wave || null)
    }).catch(() => {
      if (!asyncResourceGuardRef.current.isCurrent(ticket, track === 'music' ? musicWavePathRef.current : voiceWavePathRef.current, resourceScopeRef.current)) return
      if (track === 'music') setMusicWave(null)
      else setVoiceWave(null)
    })
  }
  async function addImages(paths) { return importMedia(paths, ['image']) }
  function updateClip(id, patch) {
    const next = clips.map((c) => c.id === id ? { ...c, ...patch } : c)
    setClips(next)
    const editPlanChanged = ['path', 'in', 'out', 'speed'].some((key) => Object.prototype.hasOwnProperty.call(patch, key))
    const invalidatesSilence = id === clips[0]?.id && editPlanChanged && !!autoInfo?.sourceKey
    if (invalidatesSilence) { setAutoCut(false); setKeepSegments(null) }
    if (editPlanChanged) {
      setCaptions((items) => remapAnchoredCaptions(next, items, transition, invalidatesSilence ? false : autoCut,
        invalidatesSilence ? null : keepSegments))
    }
  }
  function addClipToV2(clip) {
    if (!clip || clip.missing) return
    pushHistory()
    setVideoOverlays((items) => [...items, {
      id: makeEntityId('video-overlay'), path: clip.path, name: clip.name, kind: isImg(clip) ? 'image' : 'video',
      start: current, in: isImg(clip) ? 0 : clip.in, out: clip.out, speed: isImg(clip) ? 1 : (clip.speed || 1),
      x: 0.25, y: 0.25, width: 0.5, height: 0.5, opacity: 1, zIndex: videoOverlays.length,
      animated: !!clip.animated, sourceDuration: clip.src?.duration || clip.out, missing: false
    }])
    setStatus(t('msg_added_v2'))
  }
  async function addLibraryAssetToTimeline(asset) {
    if (!asset || asset.missing) { notify(t('media_asset_missing'), 'err'); return }
    const scope = resourceScopeRef.current
    try {
      const media = await window.taoclip.inspectMedia(asset.path)
      if (scope !== resourceScopeRef.current) return
      pushHistory()
      addLibraryAssets([{ ...asset, missing: false, metadata: media }])
      if (media.kind === 'audio') {
        const item = { id: makeEntityId('audio'), path: asset.path, name: asset.name, track: 'music', start: current, in: 0,
          out: media.duration, sourceDuration: media.duration, gain: 0.4, fadeIn: 0, fadeOut: 0, loop: true, muted: false, missing: false }
        setAudioItems((items) => [...items, item])
      } else if (media.kind === 'image') {
        const clip = { id: makeEntityId('clip'), kind: 'image', path: asset.path, name: asset.name, animated: media.formatName === 'gif',
          src: { duration: media.duration || slideDur, width: media.width, height: media.height, hasAudio: false, isImage: true, rotation: media.rotation || 0 },
          in: 0, out: slideDur, speed: 1, kenBurns: true, thumbs: [asset.path] }
        setClips((items) => [...items, clip]); setSelId(clip.id)
      } else {
        const clip = { id: makeEntityId('clip'), path: asset.path, name: asset.name, src: media, in: 0, out: media.duration, speed: 1, thumbs: [] }
        setClips((items) => [...items, clip]); setSelId(clip.id)
        loadThumbnails(clip.id, clip.path); loadWave(clip.id, clip.path, media.hasAudio)
      }
      setStatus(t('media_asset_added'))
    } catch (error) { notify(t('st_err', { e: error.message || error }), 'err') }
  }
  function removeLibraryAsset(asset) {
    if (!asset) return
    const key = normalizeMediaPath(asset.path)
    const uses = clips.filter((item) => normalizeMediaPath(item.path) === key).length +
      videoOverlays.filter((item) => normalizeMediaPath(item.path) === key).length +
      audioItems.filter((item) => normalizeMediaPath(item.path) === key).length +
      (music?.path && normalizeMediaPath(music.path) === key ? 1 : 0) + (voice?.path && normalizeMediaPath(voice.path) === key ? 1 : 0)
    if (uses && !window.confirm(t('media_remove_confirm', { name: asset.name, uses }))) return
    pushHistory()
    setLibraryAssets((items) => items.filter((item) => item.id !== asset.id))
    notify(t('media_asset_removed'))
  }
  function libraryAssetUsage(asset) {
    const key = normalizeMediaPath(asset.path)
    return clips.filter((item) => normalizeMediaPath(item.path) === key).length +
      videoOverlays.filter((item) => normalizeMediaPath(item.path) === key).length +
      audioItems.filter((item) => normalizeMediaPath(item.path) === key).length +
      (music?.path && normalizeMediaPath(music.path) === key ? 1 : 0) + (voice?.path && normalizeMediaPath(voice.path) === key ? 1 : 0)
  }
  function updateVideoOverlay(id, patch) {
    setVideoOverlays((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }
  // Dat thoi luong cho MOI anh (nut "Ap dung tat ca")
  function setAllSlideDur(d) {
    if (!clips.some((clip) => isImg(clip) && (clip.out !== d || clip.in !== 0))) return
    pushHistory(); setClips((cs) => cs.map((c) => isImg(c) ? { ...c, in: 0, out: d } : c))
  }
  function changeSlidePreset(d) {
    const updateSlides = clips.some((clip) => isImg(clip) && (clip.out !== d || clip.in !== 0))
    if (d === slideDur && !updateSlides) return
    pushHistory()
    if (d !== slideDur) setSlideDur(d)
    if (updateSlides) setClips((items) => items.map((clip) => isImg(clip) ? { ...clip, in: 0, out: d } : clip))
  }
  function deleteClip(id) {
    pushHistory()
    const next = clips.filter((c) => c.id !== id)
    setClips(next)
    setCaptions((items) => remapAnchoredCaptions(next, items, transition))
    if (clips.length === 1 && clips[0].id === id) { setKeepSegments(null); setAutoCut(false); setAutoInfo(null) }
    if (selId === id) setSelId(null)
  }
  function moveClip(id, dir) {
    const i = clips.findIndex((c) => c.id === id); const j = i + dir
    if (i < 0 || j < 0 || j >= clips.length) return
    pushHistory()
    const next = [...clips]; [next[i], next[j]] = [next[j], next[i]]
    setClips(next)
    setCaptions((items) => remapAnchoredCaptions(next, items, transition))
  }

  function startReorder(seg, e) {
    e.stopPropagation(); setSelId(seg.id); setSelOv(null)
    const fromIdx = clips.findIndex((c) => c.id === seg.id)
    const startX = e.clientX; let moved = false
    dragRef.current = 'reorder'
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 5) return
      moved = true
      const rect = scrollRef.current.getBoundingClientRect()
      const gt = (ev.clientX - rect.left + scrollRef.current.scrollLeft) / pps
      setDragInsert(layout.filter((s) => gt > (s.start + s.end) / 2).length)
    }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      setDragInsert((prev) => {
        if (moved && prev != null) {
          const next = [...clips]; const [x] = next.splice(fromIdx, 1); let idx = prev > fromIdx ? prev - 1 : prev; next.splice(idx, 0, x)
          if (next.some((clip, index) => clip.id !== clips[index]?.id)) {
            pushHistory()
            setClips(next); setCaptions((items) => remapAnchoredCaptions(next, items, transition))
          }
        }
        return null
      })
      setTimeout(() => { dragRef.current = null }, 0)
    }
    attachDocumentMouseDrag(move, up)
  }

  // ---- Tai video tu link (YouTube/TikTok) -> them vao timeline ----
  async function downloadFromUrl(url, options = {}) {
    if (!url || dlBusy) return false
    const scope = resourceScopeRef.current
    setDlBusy(true); setDlStatus(t('dl_start'))
    const off = window.taoclip.onDlProgress((s) => {
      if (s.phase === 'tool') setDlStatus(t('dl_tool', { p: s.progress ?? 0 }))
      else if (s.phase === 'start') setDlStatus(t('dl_start'))
      else if (s.phase === 'download') setDlStatus(t('dl_progress', { p: s.progress }))
    })
    try {
      const r = await window.taoclip.downloadVideo({ url, maxRes: options.maxRes, outDir: options.outDir || undefined })
      if (resourceScopeRef.current !== scope) { setDlStatus(t('msg_dl_project_changed')); return false }
      const imported = await addClips([r.path])
      if (imported?.stale) { setDlStatus(t('msg_dl_inspect_project_changed')); return false }
      setDlStatus(t('dl_done'))
      return true
    } catch (e) {
      setDlStatus(t('st_err', { e: String(e.message || e).replace(/^.*dl:video[^:]*:\s*/, '').slice(0, 200) }))
      return false
    } finally { off(); setDlBusy(false) }
  }
  function cancelDownload() { window.taoclip.cancelDownload?.().catch(() => {}) }
  async function chooseDownloadDirectory() { return window.taoclip.chooseDownloadDirectory?.() || null }

  async function handleImport() {
    const scope = resourceScopeRef.current
    const ps = await window.taoclip.openImportMedia()
    if (scope !== resourceScopeRef.current) { if (ps?.length) notify(t('msg_pick_media_project_changed'), 'err'); return }
    if (ps?.length) importMedia(ps, ['video', 'image'])
  }
  async function handleImportImages() {
    const scope = resourceScopeRef.current
    const ps = await window.taoclip.openImages()
    if (scope !== resourceScopeRef.current) { if (ps?.length) notify(t('msg_pick_images_project_changed'), 'err'); return }
    if (ps?.length) addImages(ps)
  }
  function onDragOver(e) { e.preventDefault(); setDragOver(true) }
  function onDragLeave(e) { e.preventDefault(); setDragOver(false) }
  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    const paths = [...e.dataTransfer.files].map((file) => window.taoclip.getDroppedPath(file)).filter(Boolean)
    if (paths.length) importMedia(paths, ['video', 'image', 'audio'])
    else setStatus(t('st_not_media', { f: '' }))
  }

  // ---- Phat lien tuc qua nhieu clip ----
  function handlePreviewPlayError(error) {
    resumePlayRequestedRef.current = false
    setPlaying(false)
    if (error?.name === 'AbortError') return
    setPreviewError(error?.message || t('msg_preview_play_fail'))
  }
  function playPreviewVideo(video) {
    if (!video) return
    video.play().then(() => {
      resumePlayRequestedRef.current = false
      setPreviewError(''); setPlaying(true)
    }).catch(handlePreviewPlayError)
  }
  function onPreviewCanPlay(event) {
    setPreviewLoading(false)
    if (resumePlayRequestedRef.current) playPreviewVideo(event.currentTarget)
  }
  function onPreviewVideoError(event) {
    const mediaError = event.currentTarget.error
    setPreviewLoading(false)
    setPlaying(false)
    setPreviewError(mediaError?.message || t('msg_preview_decode_fail'))
  }
  function onPreviewImageLoad() {
    setPreviewLoading(false); setPreviewError('')
    if (resumePlayRequestedRef.current) { resumePlayRequestedRef.current = false; setPlaying(true) }
  }
  function onPreviewImageError() {
    setPreviewLoading(false); setPlaying(false); setPreviewError(t('msg_preview_image_fail'))
  }
  async function tryPreviewProxy() {
    if (!activeClip || activeIsImage || activePreviewOverride?.proxyPath || previewProxyBusy) return
    const scope = resourceScopeRef.current, revision = editRevisionRef.current
    const sourceId = activeClip.id, sourcePath = activeClip.path
    setPreviewProxyBusy(true); setPreviewLoading(true); setPreviewError('')
    resumePlayRequestedRef.current = playing
    try {
      const proxyPath = await window.taoclip.createPreviewProxy(sourcePath)
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current || !clipsRef.current.some((clip) => clip.id === sourceId && clip.path === sourcePath)) return
      const source = resolvePreviewSource(timelinePlan, current)
      if (!source || clips[source.entryIndex]?.id !== sourceId) { setPreviewLoading(false); return }
      pendingSeekRef.current = source.sourceTime
      setPreviewSources((items) => ({ ...items, [sourceId]: { sourcePath, proxyPath } }))
      setStatus(t('msg_proxy_active'))
    } catch (error) {
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current) return
      resumePlayRequestedRef.current = false
      setPreviewLoading(false); setPreviewError(error?.message || t('msg_proxy_fail'))
    } finally { setPreviewProxyBusy(false) }
  }
  function useOriginalPreview() {
    if (!activeClip || !activePreviewOverride) return
    setPlaying(false); resumePlayRequestedRef.current = false
    const source = resolvePreviewSource(timelinePlan, current)
    pendingSeekRef.current = source?.sourceTime ?? activeClip.in
    setPreviewSources((items) => { const next = { ...items }; delete next[activeClip.id]; return next })
    setPreviewError(''); setPreviewLoading(true)
  }
  function onLoadedMeta() {
    const v = videoRef.current; if (!v || !activeClip) return
    setPreviewLoading(false); setPreviewError('')
    v.playbackRate = activeClip.speed || 1; v.volume = volume * origVolume * mainPreviewOpacity; v.muted = muted
    // Tu sua thoi luong neu probe thieu (out=0 hoac vuot qua video that)
    if (v.duration && isFinite(v.duration) && (!activeClip.out || activeClip.out < 0.05 || activeClip.out > v.duration + 0.5)) {
      updateClip(activeClip.id, { out: v.duration, src: { ...activeClip.src, duration: v.duration } })
    }
    if (pendingSeekRef.current != null) {
      try { v.currentTime = clamp(pendingSeekRef.current, 0, Math.max(0, v.duration - 0.02)) } catch {}
      pendingSeekRef.current = null
    }
    if (wasPlayingRef.current || resumePlayRequestedRef.current) { wasPlayingRef.current = false; playPreviewVideo(v) }
  }
  function onTimeUpdate() {
    const v = videoRef.current; if (!v || !activeClip) return
    const seg = layout.find((entry) => entry.clipId === activeClip.id && v.currentTime >= entry.sourceStart - 0.02 && v.currentTime < entry.sourceEnd - 0.02)
      || layout.find((entry) => entry.clipId === activeClip.id && Math.abs(v.currentTime - entry.sourceEnd) < 0.06)
    if (!seg) return
    const gt = seg.start + (v.currentTime - seg.sourceStart) / (seg.speed || 1)
    setCurrent(clamp(gt, 0, totalDuration))
    if (gt >= totalDuration - 0.04) {
      if (loop) { seekGlobal(0); if (!v.paused) playPreviewVideo(v) }
      else { v.pause(); setPlaying(false) }
      return
    }
    const preview = resolvePreviewSource(timelinePlan, gt)
    const nextIdx = preview ? clips.findIndex((clip) => clip.id === preview.clipId) : -1
    if (nextIdx >= 0 && nextIdx !== activeIdx) {
      wasPlayingRef.current = !v.paused; pendingSeekRef.current = preview.sourceTime; setActiveIdx(nextIdx)
    } else if (nextIdx === activeIdx && preview.entryIndex !== seg.entryIndex && Math.abs(v.currentTime - preview.sourceTime) > 0.06) {
      try { v.currentTime = preview.sourceTime } catch { pendingSeekRef.current = preview.sourceTime }
    }
  }
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) { // clip dang active la ANH: khong co <video>, dieu khien bang state (vong RAF lo phat)
      if (!playing && current >= totalDuration - 0.05) seekGlobal(0)
      if (playing) { setPlaying(false); resumePlayRequestedRef.current = false; return }
      if (previewLoading) { resumePlayRequestedRef.current = true; return }
      if (previewError) return
      setPlaying(true); return
    }
    if (!v.paused) { v.pause(); setPlaying(false); resumePlayRequestedRef.current = false; return }
    if (current >= totalDuration - 0.05) seekGlobal(0)
    if (previewLoading || v.readyState < 3) { resumePlayRequestedRef.current = true; setPreviewLoading(true); return }
    if (!previewError) playPreviewVideo(v)
  }, [current, totalDuration, seekGlobal, playing, previewLoading, previewError])

  // vi tri nguon trong clip dang o playhead (cho phim I/O)
  function playheadInClip() {
    const preview = resolvePreviewSource(timelinePlan, current)
    const seg = preview && layout[preview.entryIndex]
    if (!seg || !preview) return null
    return { clip: seg.clip, src: preview.sourceTime }
  }

  // ---- Tach clip tai playhead thanh 2 clip (giu nguyen file nguon) ----
  function splitAtPlayhead() {
    const preview = resolvePreviewSource(timelinePlan, current)
    const seg = preview && layout[preview.entryIndex]
    if (!seg) return
    const c = seg.clip
    let a, b
    if (isImg(c)) {
      const tl = current - seg.start // anh: chia thoi luong hien
      if (tl <= 0.05 || seg.duration - tl <= 0.05) return
      a = { ...c, in: 0, out: tl }
      b = { ...c, in: 0, out: (c.out - c.in) - tl }
    } else {
      const srcPos = seg.sourceStart + (current - seg.start) * seg.speed
      if (srcPos <= c.in + FRAME || srcPos >= c.out - FRAME) return
      a = { ...c, out: srcPos }
      b = { ...c, in: srcPos }
    }
    pushHistory()
    const nid = makeEntityId('clip')
    b = { ...b, id: nid }
    const nextClips = clips.flatMap((x) => x.id === c.id ? [a, b] : [x])
    setClips(nextClips)
    const splitSource = isImg(c) ? null : c.in + (current - seg.start) * (c.speed || 1)
    setCaptions((items) => remapAnchoredCaptions(nextClips, items.flatMap((item) => {
      if (item.clipId !== c.id || !Number.isFinite(item.sourceStart) || !Number.isFinite(item.sourceEnd) || splitSource == null) return [item]
      const pieces = []
      if (item.sourceStart < splitSource) pieces.push({ ...item, sourceEnd: Math.min(item.sourceEnd, splitSource) })
      if (item.sourceEnd > splitSource) pieces.push({ ...item, id: pieces.length ? `${item.id}:split` : item.id,
        clipId: b.id, sourceStart: Math.max(item.sourceStart, splitSource) })
      return pieces
    }), transition))
    setSelId(nid)
  }

  // ---- Timeline ----
  function clientXToTime(clientX) {
    const rect = scrollRef.current.getBoundingClientRect()
    return (clientX - rect.left + scrollRef.current.scrollLeft) / pps
  }
  function timelineClick(e) {
    if (dragRef.current) return
    seekGlobal(clientXToTime(e.clientX))
  }
  // Keo playhead/ruler -> tua truc tiep (preview cap nhat theo giay)
  function startScrub(e) {
    e.stopPropagation(); dragRef.current = 'scrub'
    seekGlobal(clientXToTime(e.clientX))
    const move = (ev) => seekGlobal(clientXToTime(ev.clientX))
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); setTimeout(() => { dragRef.current = null }, 0) }
    attachDocumentMouseDrag(move, up)
  }
  function startTrim(clip, which, e) {
    e.stopPropagation(); setSelId(clip.id); beginHistoryEdit(); dragRef.current = which
    const startX = e.clientX, origIn = clip.in, origOut = clip.out
    const move = (ev) => {
      const fps = Number.isFinite(clip.src?.fps) && clip.src.fps > 0 ? clip.src.fps : 30
      const minSpan = Math.min(clip.src?.duration || 0.1, 1 / fps)
      const dt = ((ev.clientX - startX) / pps) * (clip.speed || 1)
      const snapFrame = (value) => snapEnabled ? snapToFrameTime(value, fps) : value
      let nextIn = origIn, nextOut = origOut
      if (which === 'l') nextIn = clamp(snapFrame(origIn + dt), 0, origOut - minSpan)
      else nextOut = clamp(snapFrame(origOut + dt), origIn + minSpan, clip.src?.duration || origOut)
      updateClip(clip.id, which === 'l' ? { in: nextIn } : { out: nextOut })
      setTrimTooltip({ which, source: which === 'l' ? nextIn : nextOut, duration: (nextOut - nextIn) / (clip.speed || 1),
        x: Math.min(ev.clientX + 12, window.innerWidth - 190), y: Math.max(8, Math.min(ev.clientY - 34, window.innerHeight - 72)) })
    }
    const up = () => { dragRef.current = null; setTrimTooltip(null); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit() }
    attachDocumentMouseDrag(move, up)
  }
  function fitZoom() { if (totalDuration && scrollRef.current) setPps(clamp((scrollRef.current.clientWidth - 40) / totalDuration, 20, 300)) }

  // ---- Snap: bam vao mep clip / playhead / dau-cuoi khi keo tren timeline ----
  // dur > 0: snap ca mep phai (tt+dur) roi quy ve diem dau
  function snapTime(tt, dur = 0) {
    if (!snapEnabled) return Math.max(0, tt)
    const th = 8 / pps
    const targets = [0, totalDuration, current]
    for (const s of layout) targets.push(s.start, s.end)
    let best = tt, bd = th
    for (const g of targets) {
      let d = Math.abs(g - tt); if (d < bd) { bd = d; best = g }
      if (dur > 0) { d = Math.abs(g - (tt + dur)); if (d < bd) { bd = d; best = g - dur } }
    }
    return Math.max(0, best)
  }

  // ---- Keo khoi LONG TIENG tren timeline -> doi diem bat dau ----
  function startVoiceDrag(e) {
    e.stopPropagation(); beginHistoryEdit(); dragRef.current = 'voice'
    const startX = e.clientX, orig = voiceOffset
    const move = (ev) => {
      let nt = clamp(orig + (ev.clientX - startX) / pps, 0, Math.max(0, totalDuration - 0.1))
      setVoiceOffset(snapTime(nt, voiceDur))
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit(); setTimeout(() => { dragRef.current = null }, 0) }
    attachDocumentMouseDrag(move, up)
  }
  function startAudioItemDrag(item, e) {
    if (e.target.closest('button')) return
    e.stopPropagation(); beginHistoryEdit(); dragRef.current = `audio:${item.id}`
    const startX = e.clientX, original = item.start, span = item.loop ? 0 : item.out - item.in
    const move = (event) => {
      const nextStart = snapTime(Math.max(0, original + (event.clientX - startX) / pps), span)
      updateAudioItem(item.id, { start: nextStart })
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit(); setTimeout(() => { dragRef.current = null }, 0) }
    attachDocumentMouseDrag(move, up)
  }

  // ---- Keo khoi CHU/STICKER tren timeline: di chuyen / keo mep doi thoi luong ----
  function startOvMove(o, e) {
    e.stopPropagation(); setSelOv(o.id); beginHistoryEdit(); dragRef.current = 'ovmove'
    const startX = e.clientX, s0 = o.start, dur = o.end - o.start
    const move = (ev) => {
      let ns = clamp(s0 + (ev.clientX - startX) / pps, 0, Math.max(0, (totalDuration || s0 + dur) - dur))
      ns = snapTime(ns, dur)
      updateOverlay(o.id, { start: ns, end: ns + dur })
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit(); setTimeout(() => { dragRef.current = null }, 0) }
    attachDocumentMouseDrag(move, up)
  }
  function startV2Move(item, e) {
    e.stopPropagation(); beginHistoryEdit(); dragRef.current = 'v2move'
    const startX = e.clientX, start = item.start, dur = (item.out - item.in) / item.speed
    const move = (event) => {
      const next = snapTime(Math.max(0, start + (event.clientX - startX) / pps), dur)
      setVideoOverlays((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, start: next } : candidate))
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit(); setTimeout(() => { dragRef.current = null }, 0) }
    attachDocumentMouseDrag(move, up)
  }
  function startV2Resize(item, e) {
    e.stopPropagation(); beginHistoryEdit(); dragRef.current = 'v2resize'
    const startX = e.clientX, out = item.out
    const move = (event) => {
      const minOut = item.in + FRAME * item.speed
      const maxOut = Math.max(minOut, item.sourceDuration || Infinity)
      const nextOut = clamp(out + ((event.clientX - startX) / pps) * item.speed, minOut, maxOut)
      setVideoOverlays((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, out: nextOut } : candidate))
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit(); setTimeout(() => { dragRef.current = null }, 0) }
    attachDocumentMouseDrag(move, up)
  }
  function startOvResize(o, which, e) {
    e.stopPropagation(); setSelOv(o.id); beginHistoryEdit(); dragRef.current = 'ovres'
    const startX = e.clientX, s0 = o.start, e0 = o.end
    const move = (ev) => {
      const dt = (ev.clientX - startX) / pps
      if (which === 'l') updateOverlay(o.id, { start: clamp(snapTime(s0 + dt), 0, e0 - 0.2) })
      else updateOverlay(o.id, { end: clamp(snapTime(e0 + dt), s0 + 0.2, totalDuration || e0 + 60) })
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit(); setTimeout(() => { dragRef.current = null }, 0) }
    attachDocumentMouseDrag(move, up)
  }

  // Tinh truoc cac hook ben duoi: mang phu thuoc cua phim tat doc projectDirty luc render (const khong duoc hoist)
  const serializedProject = JSON.stringify(buildProject())
  const projectDirty = savedProjectSerialized != null && savedProjectSerialized !== serializedProject

  // ---- Phim tat ----
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveProjectAs(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveProject(); return }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seekGlobal(current - (e.shiftKey ? 1 : FRAME)) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seekGlobal(current + (e.shiftKey ? 1 : FRAME)) }
      else if (e.key === 'Home') seekGlobal(0)
      else if (e.key === 'End') seekGlobal(totalDuration)
      else if (!e.ctrlKey && !e.metaKey && (e.key === 'i' || e.key === 'I')) { const ph = playheadInClip(); if (ph) { const nextIn = clamp(ph.src, 0, ph.clip.out - 0.1); if (nextIn !== ph.clip.in) { pushHistory(); updateClip(ph.clip.id, { in: nextIn }) } } }
      else if (!e.ctrlKey && !e.metaKey && (e.key === 'o' || e.key === 'O')) { const ph = playheadInClip(); if (ph) { const nextOut = clamp(ph.src, ph.clip.in + 0.1, ph.clip.src.duration); if (nextOut !== ph.clip.out) { pushHistory(); updateClip(ph.clip.id, { out: nextOut }) } } }
      else if (!e.ctrlKey && !e.metaKey && (e.key === 's' || e.key === 'S')) splitAtPlayhead()
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (selOv) delOverlay(selOv); else if (selId) deleteClip(selId) }
      else if (e.key === '?') setShowKeys((s) => !s)
      else if (e.key === 'Escape') { setShowKeys(false); if (!exporting) setShowExport(false) }
      else if (e.key === '+' || e.key === '=') setPps((p) => Math.min(300, p + 20))
      else if (e.key === '-' || e.key === '_') setPps((p) => Math.max(20, p - 20))
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, totalDuration, clips, activeIdx, seekGlobal, togglePlay, selId, selOv, overlays, captions, music, voice, bgDur, voiceDur, voiceOffset, exporting, projectPath, projectDirty, saveProject, saveProjectAs])

  // ---- Ctrl + lan chuot tren timeline = thu phong ----
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setPps((p) => clamp(p + (e.deltaY < 0 ? 20 : -20), 20, 300))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- Phu de / auto-cut ----
  // Nhan dang loi noi (Whisper) - dung chung cho phu de tu dong + doi giong video
  function remapAnchoredCaptions(nextClips, items, transitionValue = transition, cutEnabled = autoCut, cutSegments = keepSegments, duration = transitionDuration) {
    const keepByClip = cutEnabled && nextClips.length === 1 && cutSegments ? { [nextClips[0].id]: cutSegments } : {}
    const plan = buildTimelinePlan(nextClips.map((clip) => ({ id: clip.id, path: clip.path,
      kind: isImg(clip) ? 'image' : 'video', in: clip.in, out: clip.out, speed: clip.speed })),
    { transition: transitionValue, transitionDuration: duration, keepByClip })
    return items.flatMap((item) => {
      if (!item.clipId || !Number.isFinite(item.sourceStart) || !Number.isFinite(item.sourceEnd)) return [item]
      const ranges = mapSourceRange(plan, item.clipId, item.sourceStart, item.sourceEnd)
      if (!ranges.length) return [{ ...item, unmapped: true }]
      return ranges.map((range, index) => ({ ...item, ...range,
        id: index === 0 ? item.id : `${item.id}:${index}`, unmapped: false }))
    })
  }
  async function transcribeClips(onStatus) {
    const scope = resourceScopeRef.current, revision = editRevisionRef.current
    const off = window.taoclip.onCaptionProgress((s) => {
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current) return
      if (s.phase === 'download') onStatus(t('cap_downloading', { p: s.progress }))
      else if (s.phase === 'transcribe') onStatus(t('cap_transcribing'))
      else if (s.phase === 'audio') onStatus(t('cap_extracting'))
      else if (s.phase !== 'done' && s.phase !== 'ready') onStatus(t('cap_loading'))
    })
    try {
      const opts = { language: capLang, audioSource: captionAudioSource, totalDuration: timelinePlan.duration,
        audioItems: getProjectAudioItems().filter((item) => item.track === 'voice').map(({ path, start, in: sourceIn, out, gain, fadeIn, fadeOut }) => ({ path, start, in: sourceIn, out, gain, fadeIn, fadeOut })) }
      opts.clips = clips.map((c) => ({ id: c.id, input: c.path, in: c.in, out: c.out, speed: c.speed }))
      opts.editPlan = toExportSegments(timelinePlan)
      const result = await window.taoclip.generateCaptions(clips.length > 1 ? null : clips[0].path, opts)
      return result.flatMap((caption) => mapTimelineRangeToSources(timelinePlan, caption.start, caption.end)
        .map((mapped, index) => ({ ...caption, ...mapped, id: index ? undefined : caption.id })))
    } finally { off() }
  }
  async function genCaptions() {
    if (!clips.length) return
    const expectedRevision = editRevisionRef.current
    const expectedAudioSource = captionAudioSource, expectedLanguage = capLang
    setCapBusy(true); setCapStatus(t('cap_extracting'))
    try {
      const segs = await transcribeClips(setCapStatus)
      if (editRevisionRef.current !== expectedRevision || captionAudioSource !== expectedAudioSource || capLang !== expectedLanguage) throw new Error('AI_RESULT_STALE')
      pushHistory()
      setCaptions(segs.map((caption) => ({ ...caption, id: caption.id || makeEntityId('caption') })))
      setCaptionTimebase('timeline'); setCapStatus(t('cap_count', { n: segs.length }))
    } catch (e) { setCapStatus(e.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e })) } finally { setCapBusy(false) }
  }
  function editCaption(i, text) { setCaptions((cs) => cs.map((c, idx) => idx === i ? { ...c, text } : c)) }
  function updateCaption(i, patch) {
    setCaptions((items) => items.map((item, index) => {
      if (index !== i) return item
      const next = { ...item, ...patch }
      if (Object.prototype.hasOwnProperty.call(patch, 'start')) {
        const rate = item.sourceStart != null && item.sourceEnd != null && item.end > item.start
          ? (item.sourceEnd - item.sourceStart) / (item.end - item.start) : 0
        next.start = clamp(Number(patch.start) || 0, 0, Math.max(0, totalDuration - 0.01))
        if (next.end < next.start + 0.01) next.end = Math.min(totalDuration, next.start + 0.01)
        if (rate) next.sourceStart = item.sourceStart + (next.start - item.start) * rate
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'end')) {
        const rate = item.sourceStart != null && item.sourceEnd != null && item.end > item.start
          ? (item.sourceEnd - item.sourceStart) / (item.end - item.start) : 0
        next.end = clamp(Number(patch.end) || 0, next.start + 0.01, totalDuration || next.start + 0.01)
        if (rate) next.sourceEnd = item.sourceEnd + (next.end - item.end) * rate
      }
      return next
    }))
  }
  function splitCaption(i) {
    const item = captions[i]
    if (!item || current <= item.start + 0.05 || current >= item.end - 0.05) return
    const words = String(item.text || '').trim().split(/\s+/)
    if (words.length < 2) return
    pushHistory()
    const ratio = (current - item.start) / (item.end - item.start)
    const split = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)))
    const before = words.slice(0, split).join(' '), after = words.slice(split).join(' ')
    const sourceSplit = item.sourceStart != null && item.sourceEnd != null
      ? item.sourceStart + (item.sourceEnd - item.sourceStart) * ratio : null
    setCaptions((items) => items.flatMap((entry, index) => index !== i ? [entry] : [
      { ...entry, text: before, end: current, ...(sourceSplit == null ? {} : { sourceEnd: sourceSplit }) },
      { ...entry, id: makeEntityId('caption'), text: after, start: current, ...(sourceSplit == null ? {} : { sourceStart: sourceSplit }) }
    ]))
  }
  function mergeCaption(i) {
    if (i < 0 || i + 1 >= captions.length) return
    const first = captions[i], second = captions[i + 1]
    if (first.clipId !== second.clipId || (first.clipId && (Math.abs(first.end - second.start) > 0.05 || Math.abs(first.sourceEnd - second.sourceStart) > 0.05))) return
    pushHistory()
    setCaptions((items) => items.flatMap((item, index) => index === i
      ? [{ ...item, text: `${item.text.trim()} ${items[i + 1].text.trim()}`.trim(), end: Math.max(item.end, items[i + 1].end),
        ...(item.clipId ? { sourceEnd: items[i + 1].sourceEnd } : {}) }]
      : index === i + 1 ? [] : [item]))
  }
  function canMergeCaptions(i) {
    const first = captions[i], second = captions[i + 1]
    return !!first && !!second && first.clipId === second.clipId &&
      (!first.clipId || (Math.abs(first.end - second.start) <= 0.05 && Math.abs(first.sourceEnd - second.sourceStart) <= 0.05))
  }
  function delCaption(i) { pushHistory(); setCaptions((cs) => cs.filter((_, idx) => idx !== i)) }
  async function exportSrt() {
    try {
      const outputCaptions = captionTimebase === 'source-legacy' && clips.length === 1
        ? captions.flatMap((caption) => mapSourceRange(timelinePlan, clips[0].id, caption.start, caption.end).map((range) => ({ ...caption, ...range })))
        : captions
      const savedPath = await window.taoclip.saveSrt(outputCaptions)
      if (savedPath) setCapStatus(t('msg_srt_saved', { p: savedPath }))
    } catch (e) { setCapStatus(t('st_err', { e })) }
  }
  async function importSrt() {
    const scope = resourceScopeRef.current
    try {
      const result = await window.taoclip.openSrt()
      if (!result?.captions) return
      if (resourceScopeRef.current !== scope) { notify(t('msg_srt_project_changed'), 'err'); return }
      pushHistory(); setCaptions(result.captions.map((caption) => ({ ...caption, id: makeEntityId('caption') })))
      setCaptionTimebase('timeline'); setCapStatus(t('cap_count', { n: result.captions.length }))
    } catch (e) { setCapStatus(t('st_err', { e })) }
  }
  async function detectSilence() {
    if (!single) return
    const expectedRevision = editRevisionRef.current
    setBusy(true); setStatus(t('st_analyzing_silence'))
    try {
      const options = { noise: `${silenceParams.threshold}dB`, minSilence: silenceParams.minSilence, pad: silenceParams.pad }
      const r = await window.taoclip.detectSilence(clips[0].path, options)
      if (editRevisionRef.current !== expectedRevision) throw new Error('PROJECT_CHANGED_DURING_JOB')
      r.silences = r.silences.map((silence) => ({ ...silence, remove: true }))
      r.sourceKey = JSON.stringify({ id: clips[0].id, path: clips[0].path, in: clips[0].in, out: clips[0].out, speed: clips[0].speed })
      pushHistory()
      setAutoInfo(r)
      setStatus(t('st_silence_result', { n: r.removed, s: r.saved.toFixed(1) }))
    } catch (e) { setStatus(e.message === 'PROJECT_CHANGED_DURING_JOB' ? t('project_changed_during_job') : t('st_err', { e })) } finally { setBusy(false) }
  }
  function updateSilenceAnalysis(patch, silenceIndex = null) {
    if (!autoInfo) { if (silenceIndex == null) setSilenceParams((value) => ({ ...value, ...patch })); return }
    const next = { ...autoInfo }
    if (silenceIndex == null) setSilenceParams((value) => ({ ...value, ...patch }))
    else next.silences = (next.silences || []).map((silence, i) => i === silenceIndex ? { ...silence, ...patch } : silence)
    if (silenceIndex == null && patch.pad != null) next.options = { ...next.options, pad: patch.pad }
    const sorted = (next.silences || []).filter((silence) => silence.remove).map((silence) => ({
      start: Math.max(0, Math.min(next.duration, Number(silence.start) || 0)),
      end: Math.max(0, Math.min(next.duration, Number(silence.end) || 0))
    })).filter((silence) => silence.end > silence.start).sort((a, b) => a.start - b.start)
    const merged = []
    for (const silence of sorted) {
      const last = merged[merged.length - 1]
      if (last && silence.start <= last.end) last.end = Math.max(last.end, silence.end)
      else merged.push({ ...silence })
    }
    const pad = next.options?.pad ?? silenceParams.pad
    const allSilent = merged.length === 1 && merged[0].start <= 0.03 && merged[0].end >= next.duration - 0.03
    const keep = []; let cursor = 0
    if (!allSilent) {
      for (const silence of merged) {
        const keepEnd = Math.min(next.duration, silence.start + pad)
        if (silence.start - cursor > 0.12 && keepEnd - cursor > 0.12) keep.push({ start: cursor, end: keepEnd })
        cursor = Math.max(cursor, silence.end - pad)
      }
      if ((!merged.length || merged[merged.length - 1].end < next.duration - 0.03) && next.duration - cursor > 0.12) keep.push({ start: cursor, end: next.duration })
    }
    const kept = keep.reduce((total, segment) => total + segment.end - segment.start, 0)
    next.keep = keep; next.kept = kept; next.saved = Math.max(0, next.duration - kept)
    setAutoInfo(next)
    if (autoCut) {
      const clip = clips[0]
      const appliedKeep = clip ? keep.map((range) => ({ start: Math.max(range.start, clip.in), end: Math.min(range.end, clip.out) })).filter((range) => range.end - range.start > 0.05) : []
      setKeepSegments(appliedKeep)
      setCaptions((items) => remapAnchoredCaptions(clips, items, transition, true, appliedKeep))
    }
  }
  function applySilenceAnalysis() {
    const sourceKey = clips[0] && JSON.stringify({ id: clips[0].id, path: clips[0].path, in: clips[0].in, out: clips[0].out, speed: clips[0].speed })
    if (autoInfo?.sourceKey && autoInfo.sourceKey !== sourceKey) { setStatus(t('msg_silence_source_changed')); return }
    if (autoInfo?.options?.noise !== `${silenceParams.threshold}dB` || autoInfo?.options?.minSilence !== silenceParams.minSilence) { setStatus(t('msg_silence_params_changed')); return }
    if (!autoInfo?.keep?.length) { setStatus(t('msg_silence_nothing_kept')); return }
    const clip = clips[0]
    const appliedKeep = autoInfo.keep.map((range) => ({ start: Math.max(range.start, clip.in), end: Math.min(range.end, clip.out) })).filter((range) => range.end - range.start > 0.05)
    if (!appliedKeep.length) { setStatus(t('msg_silence_outside_trim')); return }
    pushHistory(); setKeepSegments(appliedKeep); setAutoCut(true)
    setCaptions((items) => remapAnchoredCaptions(clips, items, transition, true, appliedKeep))
  }
  function previewSilenceAt(sourceTime) {
    const mapped = mapSourceRange(timelinePlan, clips[0]?.id, sourceTime, Math.min(autoInfo?.duration || sourceTime + 0.05, sourceTime + 0.05))
    if (!mapped.length) { setStatus(t('msg_silence_outside_clip')); return }
    setPlaying(false); seekGlobal(mapped[0].start)
  }

  // ---- Am thanh: 2 track (nhac + giong) ----
  async function setMusicFile(p) {
    pushHistory()
    addLibraryAssets([makeLibraryAsset(p, 'audio')])
    const scope = resourceScopeRef.current
    const ticket = asyncResourceGuardRef.current.begin('track:music:duration', p, scope)
    commitMusic({ path: p, name: p.split(/[\\/]/).pop() }); setBgLoop(true); setMusicVol(0.4); setMusicWave(null)
    loadTrackWave('music', p)
    try {
      const m = await window.taoclip.probe(p)
      if (asyncResourceGuardRef.current.isCurrent(ticket, musicWavePathRef.current, resourceScopeRef.current)) setBgDur(m.duration || 0)
    } catch (e) {
      if (asyncResourceGuardRef.current.isCurrent(ticket, musicWavePathRef.current, resourceScopeRef.current)) setBgDur(0)
    }
  }
  async function importMusic() {
    const scope = resourceScopeRef.current
    const p = await window.taoclip.openAudio()
    if (scope !== resourceScopeRef.current) { if (p) notify(t('msg_music_project_changed'), 'err'); return }
    if (p) setMusicFile(p)
  }
  async function addAudioItems(track) {
    const scope = resourceScopeRef.current
    const paths = await window.taoclip.openAudioFiles?.()
    if (!paths?.length) return
    if (resourceScopeRef.current !== scope) { notify(t('msg_audio_project_changed'), 'err'); return }
    const additions = [], errors = []
    for (const filePath of paths) {
      try {
        const media = await window.taoclip.inspectMedia(filePath)
        if (media.kind !== 'audio') throw new Error(t('msg_audio_invalid'))
        additions.push({ id: makeEntityId('audio'), path: filePath, name: filePath.split(/[\\/]/).pop(), track,
          start: current, in: 0, out: media.duration, sourceDuration: media.duration, gain: track === 'music' ? 0.4 : 1, fadeIn: 0, fadeOut: 0,
          loop: track === 'music', muted: false, missing: false })
      } catch (error) { errors.push(`${filePath.split(/[\\/]/).pop()}: ${error.message}`) }
    }
    if (resourceScopeRef.current !== scope) { notify(t('msg_audio_inspect_project_changed'), 'err'); return }
    if (additions.length) {
      pushHistory()
      addLibraryAssets(additions.map((item) => makeLibraryAsset(item.path, 'audio', { duration: item.sourceDuration })))
      setAudioItems((items) => [...items, ...additions])
    }
    setStatus(t('msg_audio_added', { n: additions.length }) + (errors.length ? ` · ${t('msg_errors_suffix', { n: errors.length })}` : ''))
    if (errors.length) notify(errors.slice(0, 3).join('\n'), 'err')
  }
  function updateAudioItem(id, patch) {
    setAudioItems((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }
  function removeAudioItem(id) { pushHistory(); setAudioItems((items) => items.filter((item) => item.id !== id)) }
  const ttsOpts = () => ttsEngine === 'google'
    ? { engine: 'google', voice: ttsVoice, rate: ttsRate, pitch: ttsPitch, langCode: 'vi-VN' }
    : { engine: 'local' }
  async function genTTS() {
    if (!ttsText.trim()) return
    if (ttsEngine === 'google' && !ttsVoice) { setTtsStatus(t('tts_no_voices')); return }
    const expectedRevision = editRevisionRef.current
    const expectedText = ttsText.trim()
    setTtsBusy(true); setTtsStatus(t('tts_generating'))
    const off = window.taoclip.onTtsProgress((s) => {
      if (editRevisionRef.current !== expectedRevision) return
      if (s.phase === 'download') setTtsStatus(t('cap_downloading', { p: s.progress }))
      else if (s.phase === 'chunk') setTtsStatus(t('msg_tts_chunk', { i: s.index, n: s.total }))
      else if (s.phase === 'synthesize') setTtsStatus(t('tts_generating'))
      else if (s.phase === 'cached') setTtsStatus(t('msg_tts_cached'))
    })
    try {
      const r = await window.taoclip.generateTTS(expectedText, ttsOpts())
      if (ttsEngine === 'local') await refreshLocalTtsModel()
      if (editRevisionRef.current !== expectedRevision || ttsTextRef.current.trim() !== expectedText) throw new Error('AI_RESULT_STALE')
      pushHistory()
      commitVoice({ path: r.path, name: t('tts_label') }); setVoiceVol(1); setVoiceDur(r.duration || 0); setVoiceOffset(0); setTtsStatus('')
      addLibraryAssets([makeLibraryAsset(r.path, 'audio', { duration: r.duration || 0 }, 'tts')])
      setVoiceWave(null); loadTrackWave('voice', r.path)
    } catch (e) { setTtsStatus(e.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e })) } finally { off(); setTtsBusy(false) }
  }
  // Re-dub is a reviewable sequence: prepare transcript, synthesize each line,
  // then apply the assembled timeline only after every line has an audio asset.
  async function redubVideo() {
    if (!clips.length || !anyAudio) return
    const expectedRevision = editRevisionRef.current
    const expectedAudioSource = captionAudioSource, expectedLanguage = capLang
    setRedubBusy(true); setRedubStatus(t('cap_extracting'))
    try {
      let segs = captions
      if (!segs.length) {
        segs = await transcribeClips(setRedubStatus)
        if (editRevisionRef.current !== expectedRevision || captionAudioSource !== expectedAudioSource || capLang !== expectedLanguage) throw new Error('AI_RESULT_STALE')
        pushHistory()
        segs = segs.map((caption) => ({ ...caption, id: caption.id || makeEntityId('caption') }))
        setCaptions(segs); setCaptionTimebase('timeline')
      }
      let mapped = segs
      if (captionTimebase === 'source-legacy' && clips.length === 1) {
        const c = clips[0], sp = c.speed || 1
        mapped = segs.map((s) => {
          const a = Math.max(s.start, c.in), b = Math.min(s.end, c.out)
          return b - a > 0.05 ? { ...s, start: (a - c.in) / sp, end: (b - c.in) / sp } : null
        }).filter(Boolean)
      }
      if (!mapped.length) { setRedubStatus(t('redub_no_speech')); return }
      setRedubSegments(mapped.map((s, i) => ({ ...s, id: s.id || `redub-${i}`, audioPath: '', audioDuration: 0, rate: 1 })))
      setRedubStatus(t('msg_redub_prepared', { n: mapped.length }))
    } catch (e) { setRedubStatus(e.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e })) } finally { setRedubBusy(false) }
  }
  async function generateRedubSegment(index) {
    const segment = redubSegments[index]
    if (!segment?.text?.trim()) return
    const expectedRevision = editRevisionRef.current
    const expectedScope = resourceScopeRef.current
    const expectedId = segment.id
    const expectedText = segment.text.trim()
    setRedubBusy(true); setRedubStatus(t('msg_redub_generating', { i: index + 1, n: redubSegments.length }))
    try {
      const result = await window.taoclip.generateTTS(expectedText, ttsOpts())
      const latest = redubSegmentsRef.current.find((item) => item.id === expectedId)
      if (resourceScopeRef.current !== expectedScope || editRevisionRef.current !== expectedRevision || latest?.text?.trim() !== expectedText) throw new Error('AI_RESULT_STALE')
      setRedubSegments((items) => items.map((item) => item.id === expectedId ? { ...item, audioPath: result.path, audioDuration: result.duration || 0 } : item))
      setRedubStatus(t('msg_redub_generated', { i: index + 1 }))
    } catch (e) { setRedubStatus(e.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e })) } finally { setRedubBusy(false) }
  }
  async function applyRedub() {
    if (!redubSegments.length || redubSegments.some((s) => !s.audioPath)) return
    const expectedRevision = editRevisionRef.current
    setRedubBusy(true); setRedubStatus(t('redub_mixing'))
    const off = window.taoclip.onRedubProgress((s) => { if (editRevisionRef.current === expectedRevision && s.phase === 'mix') setRedubStatus(t('redub_mixing')) })
    try {
      const r = await window.taoclip.redub({ segments: redubSegments, totalDur: totalDuration, tts: ttsOpts() })
      if (editRevisionRef.current !== expectedRevision) throw new Error('AI_RESULT_STALE')
      pushHistory()
      commitVoice({ path: r.path, name: t('redub_voice_name') }); setVoiceVol(1); setVoiceDur(r.duration || totalDuration); setVoiceOffset(0)
      addLibraryAssets([makeLibraryAsset(r.path, 'audio', { duration: r.duration || totalDuration }, 'tts')])
      setVoiceWave(null); loadTrackWave('voice', r.path)
      setOrigVolume(redubKeepOriginal ? 1 : 0); setMuted(!redubKeepOriginal)
      setRedubStatus(t('redub_done', { n: redubSegments.length }))
    } catch (e) { setRedubStatus(e.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e })) } finally { off(); setRedubBusy(false) }
  }
  function previewRedubSegment(filePath) {
    if (!filePath) return
    const audio = new Audio(fileUrl(filePath)); audio.play().catch((error) => setRedubStatus(t('st_err', { e: error.message })))
  }

  // ---- Google TTS: key + giong doc + nghe thu ----
  async function saveApiKey() {
    const wasHadKey = hasKey
    try {
      const status = await window.taoclip.setApiKey(apiKeyInput.trim())
      setApiKeyStatus(status); setHasKey(!!status.saved); setApiKeyInput('')
      // Lan dau (false->true) effect tu nap giong; doi key (true->true, effect khong chay) thi nap lai o day
      if (status.saved && wasHadKey) loadVoices()
    } catch (e) { setTtsStatus(t('st_err', { e })) }
  }
  async function loadVoices() {
    const requestId = ++ttsVoiceRequestRef.current
    const scope = resourceScopeRef.current
    const revision = editRevisionRef.current
    setVoicesLoading(true); setTtsStatus('')
    try {
      const vs = await window.taoclip.getVoices('vi-VN')
      if (requestId !== ttsVoiceRequestRef.current) return
      setTtsVoices(vs)
      if (scope === resourceScopeRef.current && revision === editRevisionRef.current && ttsEngine === 'google' && vs.length && !vs.find((v) => v.name === ttsVoice)) {
        pushHistory()
        setTtsVoice(vs[0].name)
      }
    } catch (e) {
      if (requestId === ttsVoiceRequestRef.current) setTtsStatus(t('st_err', { e }))
    } finally {
      if (requestId === ttsVoiceRequestRef.current) setVoicesLoading(false)
    }
  }
  async function removeApiKey() {
    try {
      const status = await window.taoclip.setApiKey('')
      ttsVoiceRequestRef.current++
      setApiKeyStatus({ ...status, configured: false }); setHasKey(false); setTtsVoices([])
      setVoicesLoading(false)
    } catch (e) { setTtsStatus(t('st_err', { e })) }
  }
  async function refreshLocalTtsModel() {
    try { setLocalTtsModel(await window.taoclip.getLocalTtsModelStatus()) }
    catch (error) { setLocalTtsModel({ cached: false, state: 'check-failed', error: String(error) }) }
  }
  async function previewVoice() {
    if (ttsEngine === 'google' && !ttsVoice) { setTtsStatus(t('tts_no_voices')); return }
    setTtsBusy(true); setTtsStatus(t('tts_previewing'))
    try {
      const sample = (ttsText.trim().slice(0, 200)) || t('tts_sample')
      const r = await window.taoclip.generateTTS(sample, ttsOpts())
      const a = ttsPreviewRef.current
      if (a) { a.src = fileUrl(r.path); a.play().catch(() => {}) }
      setTtsStatus('')
    } catch (e) { setTtsStatus(t('st_err', { e })) } finally { setTtsBusy(false) }
  }

  // ---- AI xu ly clip: file moi (chi gom doan [in,out]) thay the clip trong timeline ----
  // Dung chung cho doi nen + doi mat: re-probe, doi goc phu de (1 clip), regen thumbs, danh dau AI.
  // remapCaptions: chup luc BAT DAU op (tranh doc clips.length cu sau await dai)
  async function replaceClipFile(c, newPath, remapCaptions, expectedRevision = null) {
    const m = await window.taoclip.probe(newPath)
    if (expectedRevision !== null && editRevisionRef.current !== expectedRevision) throw new Error('AI_RESULT_STALE')
    pushHistory()
    addLibraryAssets([makeLibraryAsset(newPath, 'video', m, 'ai')])
    if (remapCaptions && captionTimebase === 'source-legacy') {
      setCaptions((cs) => cs
        .map((s) => ({ ...s, start: clamp(s.start - c.in, 0, m.duration), end: clamp(s.end - c.in, 0, m.duration) }))
        .filter((s) => s.end - s.start > 0.05))
    }
    updateClip(c.id, { path: newPath, src: m, in: 0, out: m.duration, thumbs: [], wave: null })
    setAiEdited(true)
    loadThumbnails(c.id, newPath)
    loadWave(c.id, newPath, m.hasAudio)
  }

  // ---- Doi nen AI (RVM local): xu ly doan [in,out] cua clip dang chon -> thay clip ----
  async function pickBgImage() { const ps = await window.taoclip.openImages(); return ps && ps.length ? ps[0] : null }
  async function previewReplaceBg(bg) {
    const c = selectedClip
    if (!c || isImg(c) || aiBusy || faceBusy) return
    const scope = resourceScopeRef.current, revision = editRevisionRef.current
    const dur = Math.min(3, Math.max(1, aiPreviewDuration), c.out - c.in)
    const start = clamp(aiPreviewStart, c.in, Math.max(c.in, c.out - dur))
    setAiBusy(true); setAiStatus(t('msg_ai_bg_preview_start'))
    const off = window.taoclip.onAiProgress((s) => {
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current) return
      if (s.phase === 'download') setAiStatus(t('msg_ai_bg_model_download', { p: s.progress ?? 0 }))
      else if (s.phase === 'matte') setAiStatus(t('msg_ai_bg_matte_preview'))
      else if (s.phase === 'process') setAiStatus(t('msg_ai_bg_preview_progress', { p: s.progress }))
      else if (s.phase === 'composite') setAiStatus(t('msg_ai_bg_composite_preview'))
    })
    try {
      const result = await window.taoclip.previewBg({ input: c.path, start, dur, bg, procWidth: aiProcWidth })
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current || selIdRef.current !== c.id || !clipsRef.current.some((clip) => clip.id === c.id && clip.path === c.path)) throw new Error('AI_RESULT_STALE')
      setAiPreviewPath(result.path); setAiStatus(t('msg_ai_bg_preview_ready'))
    } catch (error) { setAiStatus(error.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e: error.message || error })) }
    finally { off(); setAiBusy(false) }
  }
  async function ensureAiModel() {
    if (aiBusy || faceBusy) return
    setAiBusy(true); setAiStatus(t('msg_ai_model_checking'))
    const off = window.taoclip.onAiProgress((s) => {
      if (s.phase === 'download') setAiStatus(t('msg_ai_bg_model_download', { p: s.progress ?? 0 }))
      else if (s.phase === 'install') setAiStatus(t('msg_ai_model_installing'))
    })
    try { setAiModelStatus(await window.taoclip.ensureAiModel()); setAiStatus(t('msg_ai_model_ready')) }
    catch (error) { setAiStatus(t('st_err', { e: error.message || error })) }
    finally { off(); setAiBusy(false) }
  }
  async function cancelAiOperation() {
    try { if (await window.taoclip.cancelAi()) setAiStatus(t('msg_ai_cancelling')) }
    catch (error) { setAiStatus(t('st_err', { e: error.message || error })) }
  }
  async function applyReplaceBg(bg) {
    const c = selectedClip
    if (!c || isImg(c) || aiBusy || faceBusy) return
    const expectedRevision = editRevisionRef.current
    const remapCap = clips.length === 1 && captions.length > 0 // chup truoc await dai
    setAiBusy(true); setAiStatus(t('ai_loading'))
    const off = window.taoclip.onAiProgress((s) => {
      if (editRevisionRef.current !== expectedRevision) return
      if (s.phase === 'download') setAiStatus(t('ai_downloading', { p: s.progress ?? 0 }))
      else if (s.phase === 'load') setAiStatus(t('ai_loading'))
      else if (s.phase === 'matte') setAiStatus(t('msg_ai_matte'))
      else if (s.phase === 'process') setAiStatus(t('ai_processing', { p: s.progress }))
      else if (s.phase === 'composite') setAiStatus(t('ai_compositing'))
    })
    try {
      const r = await window.taoclip.replaceBg({ input: c.path, start: c.in, dur: c.out - c.in, bg, procWidth: aiProcWidth })
      await replaceClipFile(c, r.path, remapCap, expectedRevision)
      if (remapCap) setCaptionTimebase('timeline')
      setAiStatus(t('ai_done'))
    } catch (e) { setAiStatus(e.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e })) } finally { off(); setAiBusy(false) }
  }

  // ---- Doi khuon mat AI (insightface local): swap doan [in,out] clip dang chon -> thay clip ----
  async function pickFaceImage() { return window.taoclip.openFaceImage() }
  async function previewFaceSwap(sourceImage) {
    const c = selectedClip
    if (!c || isImg(c) || faceBusy || aiBusy || !sourceImage) return
    const scope = resourceScopeRef.current, revision = editRevisionRef.current
    const dur = Math.min(3, Math.max(1, aiPreviewDuration), c.out - c.in)
    const start = clamp(aiPreviewStart, c.in, Math.max(c.in, c.out - dur))
    setFaceBusy(true); setFaceStatus(t('msg_face_preview_start'))
    const off = window.taoclip.onFaceProgress((s) => {
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current) return
      if (s.phase === 'download') setFaceStatus(t('face_downloading', { f: (s.file || '').replace('.onnx', ''), p: s.progress ?? 0 }))
      else if (s.phase === 'load') setFaceStatus(t('face_loading'))
      else if (s.phase === 'source') setFaceStatus(t('face_reading_source'))
      else if (s.phase === 'process') setFaceStatus(t('face_processing', { p: s.progress }))
    })
    try {
      const r = await window.taoclip.faceSwap({ input: c.path, start, dur, sourceImage, preview: true })
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current || selIdRef.current !== c.id || !clipsRef.current.some((clip) => clip.id === c.id && clip.path === c.path)) throw new Error('AI_RESULT_STALE')
      setFacePreviewPath(r.path)
      setFaceStatus(t('face_preview_ready', { withFace: r.framesWithFace, withoutFace: r.framesWithoutFace }))
    } catch (e) {
      const message = String(e.message || e)
      if (/NO_SOURCE_FACE/.test(message)) setFaceStatus(t('face_no_source'))
      else if (/MULTIPLE_SOURCE_FACES/.test(message)) setFaceStatus(t('face_multi_source'))
      else if (/MULTIPLE_TARGET_FACES/.test(message)) setFaceStatus(t('face_multi_target'))
      else if (/NO_TARGET_FACE/.test(message)) setFaceStatus(t('face_no_face_video'))
      else if (/CANCELLED/.test(message)) setFaceStatus(t('face_cancelled'))
      else if (/AI_RESULT_STALE/.test(message)) setFaceStatus(t('ai_result_stale'))
      else setFaceStatus(t('st_err', { e }))
    } finally { off(); setFaceBusy(false) }
  }
  async function applyFaceSwap(sourceImage) {
    const c = selectedClip
    if (!c || isImg(c) || faceBusy || aiBusy || !sourceImage) return
    const expectedRevision = editRevisionRef.current
    const remapCap = clips.length === 1 && captions.length > 0 // chup truoc await dai
    setFaceBusy(true); setFaceStatus(t('face_loading'))
    const expectedScope = resourceScopeRef.current
    const off = window.taoclip.onFaceProgress((s) => {
      if (resourceScopeRef.current !== expectedScope || editRevisionRef.current !== expectedRevision) return
      if (s.phase === 'download') setFaceStatus(t('face_downloading', { f: (s.file || '').replace('.onnx', ''), p: s.progress ?? 0 }))
      else if (s.phase === 'load') setFaceStatus(t('face_loading'))
      else if (s.phase === 'source') setFaceStatus(t('face_reading_source'))
      else if (s.phase === 'process') setFaceStatus(t('face_processing', { p: s.progress }))
    })
    try {
      const r = await window.taoclip.faceSwap({ input: c.path, start: c.in, dur: c.out - c.in, sourceImage })
      if (!r.swapped) { setFaceStatus(t('face_no_face_video')); return } // co mat nguon nhung video khong co mat
      await replaceClipFile(c, r.path, remapCap, expectedRevision)
      if (remapCap) setCaptionTimebase('timeline')
      setFaceStatus(t('face_done', { n: r.swapped, total: r.frames }) + t('face_done_stats', { n: r.framesWithFace ?? r.swapped, m: r.framesWithoutFace ?? 0 }))
    } catch (e) {
      const message = String(e.message || e)
      if (/NO_SOURCE_FACE/.test(message)) setFaceStatus(t('face_no_source'))
      else if (/MULTIPLE_SOURCE_FACES/.test(message)) setFaceStatus(t('face_multi_source'))
      else if (/MULTIPLE_TARGET_FACES/.test(message)) setFaceStatus(t('face_multi_target'))
      else if (/NO_TARGET_FACE/.test(message)) setFaceStatus(t('face_no_face_video'))
      else if (/CANCELLED/.test(message)) setFaceStatus(t('face_cancelled'))
      else if (/AI_RESULT_STALE/.test(message)) setFaceStatus(t('ai_result_stale'))
      else setFaceStatus(t('st_err', { e }))
    } finally { off(); setFaceBusy(false) }
  }
  async function cancelFaceOperation() {
    try { if (await window.taoclip.cancelAi()) setFaceStatus(t('face_cancelling')) }
    catch (e) { setFaceStatus(t('st_err', { e })) }
  }

  // ---- Chu / Sticker overlay ----
  function addOverlay(ov) {
    pushHistory()
    const id = makeEntityId('overlay')
    const limit = totalDuration || current + 3
    const start = Math.min(current, Math.max(0, limit - 0.1))
    const base = { id, start, end: Math.min(limit, Math.max(start + 0.1, current + 3)), x: 0.5, y: 0.4, align: 'center', zIndex: overlays.reduce((n, item) => Math.max(n, Number(item.zIndex) || 0), 0) + 1, ...ov }
    setOverlays((os) => [...os, base]); setSelOv(id)
  }
  function addText() { addOverlay({ type: 'text', text: t('ov_default_text'), size: 0.07, color: '#ffffff' }) }
  function addEmoji(em) { addOverlay({ type: 'emoji', text: em, size: 0.14, color: null, y: 0.5 }) }
  function updateOverlay(id, patch) {
    setOverlays((os) => os.map((o) => {
      if (o.id !== id) return o
      const next = { ...o, ...patch }
      if (Object.prototype.hasOwnProperty.call(patch, 'x')) next.x = clamp(Number(patch.x) || 0, 0, 1)
      if (Object.prototype.hasOwnProperty.call(patch, 'y')) next.y = clamp(Number(patch.y) || 0, 0, 1)
      const limit = Math.max(totalDuration, next.end, next.start + 0.1)
      if (Object.prototype.hasOwnProperty.call(patch, 'start')) {
        next.start = clamp(Number(patch.start) || 0, 0, Math.max(0, limit - 0.1))
        if (next.end < next.start + 0.1) next.end = Math.min(limit, next.start + 0.1)
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'end')) next.end = clamp(Number(patch.end) || 0, next.start + 0.1, limit)
      return next
    }))
  }
  function setOverlayBoundaryAtPlayhead(id, edge) {
    const overlay = overlays.find((item) => item.id === id)
    if (!overlay || (edge !== 'start' && edge !== 'end')) return
    let patch
    if (edge === 'start') {
      const limit = Math.max(totalDuration, overlay.end, current + 0.1)
      const start = clamp(current, 0, Math.max(0, limit - 0.1))
      const end = overlay.end < start + 0.1 ? Math.min(limit, start + 0.1) : overlay.end
      patch = { start, end }
    } else {
      const limit = Math.max(totalDuration, current, overlay.start + 0.1)
      patch = { end: clamp(current, overlay.start + 0.1, limit) }
    }
    if (Object.entries(patch).every(([key, value]) => overlay[key] === value)) return
    pushHistory()
    updateOverlay(id, patch)
  }
  function moveOverlayLayer(id, direction) {
    const orderedNow = [...overlays].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
    const currentIndex = orderedNow.findIndex((item) => item.id === id)
    if (currentIndex < 0 || currentIndex + direction < 0 || currentIndex + direction >= orderedNow.length) return
    pushHistory()
    setOverlays((items) => {
      const ordered = [...items].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
      const index = ordered.findIndex((item) => item.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return items
      ;[ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]]
      return ordered.map((item, i) => ({ ...item, zIndex: i + 1 }))
    })
  }
  function delOverlay(id) { pushHistory(); setOverlays((os) => os.filter((o) => o.id !== id)); if (selOv === id) setSelOv(null) }
  function startOverlayDrag(o, e) {
    e.stopPropagation(); setSelOv(o.id)
    const frame = e.currentTarget.closest('.cc-frame'); if (!frame) return
    beginHistoryEdit()
    const rect = frame.getBoundingClientRect()
    const move = (ev) => updateOverlay(o.id, { x: clamp((ev.clientX - rect.left) / rect.width, 0, 1), y: clamp((ev.clientY - rect.top) / rect.height, 0, 1) })
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); endHistoryEdit() }
    attachDocumentMouseDrag(move, up)
  }

  const activeCaption = captions.find((c) => !c.unmapped && current >= c.start && current < c.end)
  const activeOverlays = overlays.filter((o) => current >= o.start && current < o.end)
  const activeVideoOverlays = videoOverlays.filter((item) => current >= item.start && current < item.start + (item.out - item.in) / item.speed)
  const overlayOutsideSafe = safeZone && ratio !== 'original' && activeOverlays.some((o) => o.x < 0.03 || o.x > 0.86 || o.y < 0.12 || o.y > 0.82)
  const anyAudio = clips.some((c) => c.src?.hasAudio)

  // ---- Luu / Mo du an ----
  function buildProject() {
    const legacyAudioItems = getProjectAudioItems()
    return normalizeProject({
      version: 4, projectId: projectIdRef.current, captionTimebase, ratio, filterKey, filterIntensity, mode, captions, burnCaptions, overlays, videoOverlays, assets: libraryAssets,
      audioItems: legacyAudioItems, transition, transitionDuration,
      clips: clips.map((c) => ({ id: c.id, path: c.path, name: c.name, kind: c.kind || 'video', in: c.in, out: c.out, speed: c.speed, kenBurns: c.kenBurns, animated: c.animated, cropMode: c.cropMode, cropX: c.cropX, cropY: c.cropY, missing: c.missing })),
      music, voice, musicVol, voiceVol, ducking, bgDur, voiceDur, voiceOffset, origVolume, bgLoop, syncMode, slideDur,
      ttsEngine, ttsVoice, ttsRate, ttsPitch, aiEdited, keepSegments, autoCut, autoInfo, silenceParams
    })
  }
  function getProjectAudioItems() {
    const legacyAudioItems = [
      ...(music?.path ? [{ id: 'legacy-music', path: music.path, name: music.name, track: 'music', start: 0, in: 0,
        out: Math.max(0.001, bgDur), gain: musicVol, loop: bgLoop }] : []),
      ...(voice?.path ? [{ id: 'legacy-voice', path: voice.path, name: voice.name, track: 'voice', start: voiceOffset, in: 0,
        out: Math.max(0.001, voiceDur), gain: voiceVol }] : [])
    ]
    return [...legacyAudioItems, ...audioItems]
  }
  useEffect(() => {
    if (savedProjectSerialized == null) setSavedProjectSerialized(serializedProject)
    if (pendingProjectCleanRef.current) {
      setSavedProjectSerialized(serializedProject)
      pendingProjectCleanRef.current = false
    }
  }, [serializedProject, savedProjectSerialized])
  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!projectDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [projectDirty])
  async function applyProject(data, { clean = false, filePath = '' } = {}) {
    resourceScopeRef.current++
    const loadScope = resourceScopeRef.current
    asyncResourceGuardRef.current.invalidateAll()
    editRevisionRef.current++
    const loadRevision = editRevisionRef.current
    const project = normalizeProject(data)
    const built = []
    for (const c of project.clips) {
      let m = null
      try {
        m = await window.taoclip.probe(c.path)
      } catch (e) { /* Keep missing assets in their original timeline position. */ }
      if (c.kind === 'image') {
        built.push({ id: c.id, kind: 'image', path: c.path, name: c.name, animated: c.animated, missing: !m, src: { duration: c.out, width: m?.width || 0, height: m?.height || 0, hasAudio: false, isImage: true, rotation: m?.rotation || 0 }, in: 0, out: c.out, speed: 1, kenBurns: c.kenBurns !== false, cropMode: c.cropMode, cropX: c.cropX, cropY: c.cropY, thumbs: m ? [c.path] : [] })
      } else {
        built.push({ id: c.id, path: c.path, name: c.name, missing: !m, src: m || { duration: c.out, width: 0, height: 0, hasAudio: false }, in: c.in, out: c.out, speed: c.speed, cropMode: c.cropMode, cropX: c.cropX, cropY: c.cropY, thumbs: [] })
      }
    }
    const loadedVideoOverlays = await Promise.all(project.videoOverlays.map(async (item) => {
      try { await window.taoclip.probe(item.path); return { ...item, missing: false } }
      catch { return { ...item, missing: true } }
    }))
    const loadedAudioItems = await Promise.all(project.audioItems.map(async (item) => {
      try { await window.taoclip.probe(item.path); return { ...item, missing: false } }
      catch { return { ...item, missing: true } }
    }))
    const loadedTracks = await Promise.all([project.music, project.voice].filter((item) => item?.path).map(async (item) => {
      try { await window.taoclip.inspectMedia(item.path); return { path: item.path, missing: false } }
      catch { return { path: item.path, missing: true } }
    }))
    const referencedAssets = [
      ...built.map((item) => ({ path: item.path, missing: item.missing, metadata: item.src })),
      ...loadedVideoOverlays.map((item) => ({ path: item.path, missing: item.missing, metadata: item })),
      ...loadedAudioItems.map((item) => ({ path: item.path, missing: item.missing, metadata: item })),
      ...(project.music?.path ? [{ path: project.music.path, missing: loadedTracks.find((item) => normalizeMediaPath(item.path) === normalizeMediaPath(project.music.path))?.missing ?? true, metadata: { duration: project.bgDur } }] : []),
      ...(project.voice?.path ? [{ path: project.voice.path, missing: loadedTracks.find((item) => normalizeMediaPath(item.path) === normalizeMediaPath(project.voice.path))?.missing ?? true, metadata: { duration: project.voiceDur } }] : [])
    ]
    const loadedLibraryAssets = await Promise.all(project.assets.map(async (asset) => {
      const reference = referencedAssets.find((item) => normalizeMediaPath(item.path) === normalizeMediaPath(asset.path))
      if (reference) return { ...asset, missing: !!reference.missing, metadata: asset.metadata || reference.metadata || null }
      try { const metadata = await window.taoclip.inspectMedia(asset.path); return { ...asset, missing: false, metadata } }
      catch { return { ...asset, missing: true } }
    }))
    if (resourceScopeRef.current !== loadScope || editRevisionRef.current !== loadRevision) {
      notify(t('project_changed_during_job'), 'err')
      return false
    }
    resourceScopeRef.current++
    asyncResourceGuardRef.current.invalidateAll()
    editRevisionRef.current++
    projectIdRef.current = project.projectId
    setHist([]); setFuture([])
    setLibraryAssets(loadedLibraryAssets)
    setClips(built); setSelId(built[0]?.id || null); setActiveIdx(0); setCurrent(0)
    setRatio(project.ratio); setFilterKey(project.filterKey); setFilterIntensity(project.filterIntensity); setMode(project.mode); setTransitionDuration(project.transitionDuration)
    let loadedCaptions = project.captions
    let loadedTimebase = project.captionTimebase
    if (loadedTimebase === 'source-legacy' && built.length === 1) {
      const plan = buildTimelinePlan(built)
      loadedCaptions = loadedCaptions.flatMap((caption) => {
        const ranges = mapSourceRange(plan, built[0].id, caption.start, caption.end)
        return ranges.length
          ? ranges.map((range) => ({ ...caption, ...range, unmapped: false }))
          : [{ ...caption, unmapped: true }]
      })
      loadedTimebase = 'timeline'
    }
    setCaptions(loadedCaptions); setCaptionTimebase(loadedTimebase); setBurnCaptions(project.burnCaptions)
    setOverlays(project.overlays); setSelOv(null); setTransition(project.transition)
    setVideoOverlays(loadedVideoOverlays); setAudioItems(loadedAudioItems.filter((item) => item.id !== 'legacy-music' && item.id !== 'legacy-voice'))
    // v2: music/voice rieng; v1 (cu): bgAudio 1 track kind music|tts
    const m = project.music, vo = project.voice
    commitMusic(m); commitVoice(vo); setMusicVol(project.musicVol); setVoiceVol(project.voiceVol); setDucking(project.ducking)
    setBgDur(project.bgDur); setVoiceDur(project.voiceDur); setVoiceOffset(project.voiceOffset)
    setOrigVolume(project.origVolume); setBgLoop(project.bgLoop)
    setSyncMode(project.syncMode); setSlideDur(project.slideDur)
    setKeepSegments(project.keepSegments); setAutoCut(project.autoCut); setAutoInfo(project.autoInfo)
    setSilenceParams(project.silenceParams || (project.autoInfo?.options ? {
      threshold: Number.parseFloat(project.autoInfo.options.noise) || -30,
      minSilence: project.autoInfo.options.minSilence ?? 0.4, pad: project.autoInfo.options.pad ?? 0.06
    } : { threshold: -30, minSilence: 0.4, pad: 0.06 }))
    setTtsEngine(project.ttsEngine); setTtsVoice(project.ttsVoice); setTtsRate(project.ttsRate); setTtsPitch(project.ttsPitch)
    setAiEdited(project.aiEdited)
    setProjectPath(filePath)
    pendingProjectCleanRef.current = clean
    built.filter((c) => !isImg(c)).forEach((c) => {
      loadThumbnails(c.id, c.path)
      loadWave(c.id, c.path, c.src.hasAudio)
    })
    setMusicWave(null); setVoiceWave(null)
    if (m) loadTrackWave('music', m.path)
    if (vo) loadTrackWave('voice', vo.path)
  }
  async function openProject() {
    const scope = resourceScopeRef.current
    const projectAtDialogOpen = JSON.stringify(buildProject())
    if (projectDirty && !window.confirm(t('project_unsaved_open'))) return
    try {
      const result = await window.taoclip.openProject()
      if (!result?.project || resourceScopeRef.current !== scope) return
      if (JSON.stringify(buildProject()) !== projectAtDialogOpen && !window.confirm(t('project_unsaved_open'))) return
      await applyProject(result.project, { clean: true, filePath: result.filePath })
    }
    catch (e) { setStatus(t('st_err', { e })) }
  }
  async function saveProject() {
    const scope = resourceScopeRef.current
    try {
      const data = buildProject()
      const p = projectPath ? await window.taoclip.writeProject(projectPath, data) : await window.taoclip.saveProject(data)
      if (p) {
        if (resourceScopeRef.current !== scope) { notify(t('msg_snapshot_saved', { p }), 'ok'); return }
        setProjectPath(p)
        setSavedProjectSerialized(JSON.stringify(data))
        const latest = await window.taoclip.latestRecovery?.()
        if (latest?.project?.projectId === projectIdRef.current) await window.taoclip.dismissRecovery?.(projectIdRef.current, latest.revision)
        setStatus('💾 ' + p); notify('💾 ' + p.split(/[\\/]/).pop(), 'ok', { label: t('open_folder'), run: () => window.taoclip.showInFolder(p) })
      }
    } catch (e) { setStatus(t('st_err', { e })); notify(t('st_err', { e }), 'err') }
  }
  async function saveProjectAs() {
    const scope = resourceScopeRef.current
    try {
      const data = buildProject()
      const p = await window.taoclip.saveProject(data, projectPath)
      if (!p) return
      if (resourceScopeRef.current !== scope) { notify(t('msg_snapshot_saved', { p }), 'ok'); return }
      setProjectPath(p)
      setSavedProjectSerialized(JSON.stringify(data))
      const latest = await window.taoclip.latestRecovery?.()
      if (latest?.project?.projectId === projectIdRef.current) await window.taoclip.dismissRecovery?.(projectIdRef.current, latest.revision)
      setStatus('💾 ' + p); notify('💾 ' + p.split(/[\\/]/).pop(), 'ok', { label: t('open_folder'), run: () => window.taoclip.showInFolder(p) })
    } catch (e) { setStatus(t('st_err', { e })); notify(t('st_err', { e }), 'err') }
  }
  async function collectProject() {
    if (collectingProjectRef.current) return
    collectingProjectRef.current = true
    setCollectingProject(true)
    const data = buildProject()
    const snapshot = JSON.stringify(data)
    const scope = resourceScopeRef.current
    try {
      const result = await window.taoclip.collectProject(data, projectPath)
      if (!result) return
      if (resourceScopeRef.current !== scope || JSON.stringify(buildProject()) !== snapshot) {
        notify(t('project_collect_stale', { path: result.filePath }), 'err')
        return
      }
      await applyProject(result.project, { clean: true, filePath: result.filePath })
      setStatus(t('project_collect_done'))
      notify(t('project_collect_done'), 'ok', { label: t('open_folder'), run: () => window.taoclip.showInFolder(result.filePath) })
    } catch (e) {
      setStatus(t('st_err', { e })); notify(t('st_err', { e }), 'err')
    } finally {
      collectingProjectRef.current = false
      setCollectingProject(false)
    }
  }

  async function relinkMissingClip(id) {
    const clip = clips.find((item) => item.id === id)
    if (!clip?.missing) return
    const sourcePath = clip.path
    const scope = resourceScopeRef.current
    try {
      const path = await window.taoclip.relinkMedia(isImg(clip) ? 'image' : 'video')
      if (!path) return
      const metadata = await window.taoclip.probe(path)
      const latestClip = clipsRef.current.find((item) => item.id === id)
      if (resourceScopeRef.current !== scope || !latestClip?.missing || latestClip.path !== sourcePath) return
      pushHistory()
      const oldKey = normalizeMediaPath(sourcePath)
      setLibraryAssets((items) => items.map((item) => normalizeMediaPath(item.path) === oldKey
        ? { ...item, path, name: path.split(/[\\/]/).pop(), missing: false, metadata }
        : item))
      setClips((items) => items.map((item) => item.id === id ? {
        ...item, path, name: path.split(/[\\/]/).pop(), missing: false,
        src: isImg(item) ? { ...item.src, width: metadata.width || 0, height: metadata.height || 0 } : metadata,
        thumbs: isImg(item) ? [path] : []
      } : item))
      if (!isImg(clip)) {
        loadThumbnails(id, path)
        loadWave(id, path, metadata.hasAudio)
      }
      notify(t('media_relinked'))
    } catch (e) { notify(t('st_err', { e }), 'err') }
  }

  async function relinkLibraryAsset(asset) {
    if (!asset?.missing) return
    const sourcePath = asset.path
    const scope = resourceScopeRef.current
    try {
      const path = await window.taoclip.relinkMedia(asset.kind)
      if (!path) return
      const metadata = await window.taoclip.inspectMedia(path)
      if (metadata.kind !== asset.kind) throw new Error(t('msg_relink_kind_mismatch'))
      const latest = libraryAssetsRef.current.find((item) => item.id === asset.id)
      if (resourceScopeRef.current !== scope || !latest?.missing || latest.path !== sourcePath) return
      pushHistory()
      const name = path.split(/[\\/]/).pop()
      setLibraryAssets((items) => {
        const remaining = items.filter((item) => item.id !== asset.id)
        const existing = remaining.find((item) => normalizeMediaPath(item.path) === normalizeMediaPath(path))
        if (existing) return remaining.map((item) => item.id === existing.id ? { ...item, missing: false, metadata } : item)
        return [...remaining, { ...asset, path, name, missing: false, metadata }]
      })
      const oldKey = normalizeMediaPath(sourcePath)
      setClips((items) => items.map((item) => normalizeMediaPath(item.path) === oldKey ? {
        ...item, path, name, missing: false, src: metadata, thumbs: item.kind === 'image' ? [path] : []
      } : item))
      setVideoOverlays((items) => items.map((item) => normalizeMediaPath(item.path) === oldKey ? { ...item, path, name, missing: false, sourceDuration: metadata.duration || item.sourceDuration } : item))
      setAudioItems((items) => items.map((item) => normalizeMediaPath(item.path) === oldKey ? { ...item, path, name, missing: false, sourceDuration: metadata.duration || item.sourceDuration } : item))
      if (normalizeMediaPath(music?.path) === oldKey) commitMusic({ ...music, path, name })
      if (normalizeMediaPath(voice?.path) === oldKey) commitVoice({ ...voice, path, name })
      if (asset.kind === 'video') {
        clips.filter((item) => item.path === sourcePath).forEach((item) => {
          loadThumbnails(item.id, path, item.id === selId ? 100 : 0)
          loadWave(item.id, path, metadata.hasAudio)
        })
      }
      notify(t('media_relinked'))
    } catch (error) { notify(t('st_err', { e: error.message || error }), 'err') }
  }

  // ---- Xuat ----
  async function handleExport() {
    if (!clips.length) return
    if (clips.some((clip) => clip.missing)) { notify(t('media_missing'), 'err'); return }
    const out = await window.taoclip.saveVideo('taoclip-export.mp4'); if (!out) return
    setExporting(true); setProgress(0); setExpStage('core')
    const ratios = [ratio, ...extraRatios.filter((r) => r !== ratio)]
    let segments
    if (single && autoCut && keepSegments) {
      const c = clips[0]
      segments = keepSegments.map((s) => ({ start: Math.max(s.start, c.in), end: Math.min(s.end, c.out) })).filter((s) => s.end - s.start > 0.05)
    }
    const clipPayload = clips.map((c) => ({ input: c.path, kind: c.kind || 'video', in: c.in, out: c.out, speed: c.speed, kenBurns: c.kenBurns, animated: c.animated, cropMode: c.cropMode || 'fit', cropX: c.cropX ?? 0.5, cropY: c.cropY ?? 0.5, formatName: c.src?.formatName, hasAudio: !!c.src?.hasAudio }))
    try {
      for (let i = 0; i < ratios.length; i++) {
        const r = ratios[i]
        const jobId = makeEntityId('export')
        activeExportJobRef.current = jobId
        activeExportBatchRef.current = { index: i, count: ratios.length }
        const suffix = `_${r.replace(':', 'x')}`
        const o = ratios.length === 1 ? out : (/\.mp4$/i.test(out) ? out.replace(/\.mp4$/i, suffix + '.mp4') : out + suffix + '.mp4')
        setStatus(t('st_exporting', { r, i: i + 1, n: ratios.length }))
        const res = await window.taoclip.exportVideo({
          jobId, clips: clipPayload, editPlan: toExportSegments(timelinePlan), output: o, ratio: r, mode, filterKey, filterIntensity, segments,
          captions, burnCaptions: burnCaptions && captions.length > 0,
          overlays: overlays.map((o) => ({ type: o.type, text: o.text, start: o.start, end: o.end, x: o.x, y: o.y, size: o.size, color: o.type === 'text' ? o.color : null, align: o.align || 'center', zIndex: o.zIndex || 0 })),
          videoOverlays: videoOverlays.map(({ path, kind, start, in: sourceIn, out: sourceOut, speed, x, y, width, height, opacity, zIndex, animated, missing, name }) => ({
            path, kind, start, in: sourceIn, out: sourceOut, speed, x, y, width, height, opacity, zIndex, animated, missing, name
          })),
          music: music ? { path: music.path, volume: musicVol, loop: bgLoop } : undefined,
          voice: voice ? { path: voice.path, volume: voiceVol, offset: voiceOffset } : undefined,
          audioItems: getProjectAudioItems(),
          origVolume, ducking, aiEdited,
          captionTimebase,
          useGpu, quality, resolution, transition: clips.length > 1 && transition !== 'none'
            ? { type: transition === 'cross' ? 'crossfade' : 'fade', dur: transitionDuration } : undefined
        })
        if (res && res.cancelled) { setStatus(t('export_cancelled')); notify(t('export_cancelled')); return }
        if (i === ratios.length - 1) {
          setStatus(t('st_export_done', { m: res.method, n: ratios.length }))
          notify(t('st_export_done', { m: res.method, n: ratios.length }), 'ok', { label: t('open_folder'), run: () => window.taoclip.showInFolder(o) })
        }
      }
      setProgress(100)
      setShowExport(false)
    } catch (e) { setStatus(t('st_export_err', { e })); notify(t('st_export_err', { e }), 'err') } finally { activeExportJobRef.current = null; activeExportBatchRef.current = null; setExporting(false) }
  }
  function toggleExtra(r) { setExtraRatios((arr) => arr.includes(r) ? arr.filter((x) => x !== r) : [...arr, r]) }

  const tlWidth = Math.max(totalDuration * pps, 400)
  const ticks = []
  if (totalDuration) { const step = pps < 50 ? 5 : pps < 120 ? 2 : 1; for (let s = 0; s <= totalDuration; s += step) ticks.push(s) }
  const hasClips = clips.length > 0

  return (
    <div className={`cc ${dragOver ? 'dragging' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <TopBar
        projectPath={projectPath} projectDirty={projectDirty} collecting={collectingProject}
        canUndo={hist.length > 0} canRedo={future.length > 0} canExport={hasClips} exporting={exporting} progress={progress}
        onOpen={openProject} onSave={saveProject} onSaveAs={saveProjectAs} onCollect={collectProject}
        onUndo={undo} onRedo={redo} onExport={() => setShowExport(true)} />

      {recover && !clips.length && (
        <RecoveryBanner recover={recover}
          onRestore={() => { applyProject(recover.project); window.taoclip.dismissRecovery?.(recover.project.projectId, recover.revision); setRecover(null) }}
          onDismiss={() => { window.taoclip.dismissRecovery?.(recover.project.projectId, recover.revision); setRecover(null) }} />
      )}

      <div className="cc-mid">
        <nav className="cc-rail">
          {TABS.map((tb) => (
            <button key={tb.k} className={tab === tb.k ? 'on' : ''} onClick={() => setTab(tb.k)} title={t('tab_' + tb.k)}>
              <span className="ic"><tb.Icon size={19} /></span><span className="lb">{t('tab_' + tb.k)}</span>
            </button>
          ))}
        </nav>

        <section className="cc-lib" style={{ width: libW }}>
          {tab === 'media' ? (
            <MediaTab clips={clips} selId={selId} setSelId={setSelId} layout={layout} seekGlobal={seekGlobal}
              libraryAssets={libraryAssets} assetUsage={libraryAssetUsage} onAddAssetToTimeline={addLibraryAssetToTimeline} onRemoveLibraryAsset={removeLibraryAsset} onRelinkLibraryAsset={relinkLibraryAsset}
              importing={importing} importProgress={importProgress} importReport={importReport} cancelImport={cancelImport}
              retryThumbnails={(clip) => loadThumbnails(clip.id, clip.path)}
              onAddToOverlay={addClipToV2}
              videoOverlays={videoOverlays} updateVideoOverlay={updateVideoOverlay} beginVideoOverlayEdit={beginHistoryEdit} endVideoOverlayEdit={endHistoryEdit}
              onImport={handleImport} onImportImages={handleImportImages}
              dlBusy={dlBusy} dlStatus={dlStatus} downloadFromUrl={downloadFromUrl} cancelDownload={cancelDownload} chooseDownloadDirectory={chooseDownloadDirectory} />
          ) : tab === 'text' ? (
            <TextTab hasClips={hasClips} anyAudio={anyAudio}
              captions={captions} setCaptions={setCaptions} capBusy={capBusy} capStatus={capStatus}
              capLang={capLang} setCapLang={setCapLang} burnCaptions={burnCaptions} setBurnCaptions={changeBurnCaptions}
              activeCaption={activeCaption} genCaptions={genCaptions} editCaption={editCaption} updateCaption={updateCaption}
              splitCaption={splitCaption} mergeCaption={mergeCaption} canMergeCaption={canMergeCaptions} importSrt={importSrt} exportSrt={exportSrt}
              captionAudioSource={captionAudioSource} setCaptionAudioSource={setCaptionAudioSource}
              hasVoiceTracks={getProjectAudioItems().some((item) => item.track === 'voice')} canvasDuration={totalDuration} delCaption={delCaption}
              overlays={overlays} selOv={selOv} setSelOv={setSelOv} addText={addText}
              updateOverlay={updateOverlay} delOverlay={delOverlay} moveOverlayLayer={moveOverlayLayer} setOverlayBoundaryAtPlayhead={setOverlayBoundaryAtPlayhead} seekGlobal={seekGlobal} current={current}
              beginEdit={beginHistoryEdit} endEdit={endHistoryEdit} pushHistory={pushHistory} />
          ) : tab === 'audio' ? (
            <AudioTab hasClips={hasClips} anyAudio={anyAudio} imageCount={imageCount}
              syncMode={syncMode} setSyncMode={changeSyncMode} bgDur={bgDur} setSlideDur={changeSlidePreset} setAllSlideDur={setAllSlideDur}
              fitSlideDuration={fitSlideDuration} fitMusicDuration={fitMusicDuration} hasFitMusic={hasFitMusic} timelineDuration={totalDuration}
              music={music} setMusic={(m) => { pushHistory(); commitMusic(m); if (!m) setBgDur(0) }}
              voice={voice} setVoice={(v) => { pushHistory(); commitVoice(v); if (!v) { setVoiceDur(0); setVoiceOffset(0) } }}
              audioItems={audioItems} addAudioItems={addAudioItems} updateAudioItem={updateAudioItem} removeAudioItem={removeAudioItem}
              musicVol={musicVol} setMusicVol={setMusicVol} voiceVol={voiceVol} setVoiceVol={setVoiceVol}
              origVolume={origVolume} setOrigVolume={setOrigVolume} bgLoop={bgLoop} setBgLoop={setBgLoop}
              ducking={ducking} setDucking={setDucking} importMusic={importMusic}
              ttsText={ttsText} setTtsText={setTtsText} ttsBusy={ttsBusy} ttsStatus={ttsStatus}
              ttsEngine={ttsEngine} setTtsEngine={(v) => { if (v !== ttsEngine) { pushHistory(); setTtsEngine(v) } }} ttsVoice={ttsVoice} setTtsVoice={(v) => { if (v !== ttsVoice) { pushHistory(); setTtsVoice(v) } }}
              ttsVoices={ttsVoices} ttsRate={ttsRate} setTtsRate={(v) => { if (v !== ttsRate) setTtsRate(v) }} ttsPitch={ttsPitch} setTtsPitch={(v) => { if (v !== ttsPitch) setTtsPitch(v) }}
              apiKeyInput={apiKeyInput} setApiKeyInput={setApiKeyInput} hasKey={hasKey} apiKeyStatus={apiKeyStatus} removeApiKey={removeApiKey} voicesLoading={voicesLoading}
              localTtsModel={localTtsModel} refreshLocalTtsModel={refreshLocalTtsModel}
              saveApiKey={saveApiKey} loadVoices={loadVoices} previewVoice={previewVoice} genTTS={genTTS} ttsPreviewRef={ttsPreviewRef}
              redubBusy={redubBusy} redubStatus={redubStatus} redubVideo={redubVideo}
              redubSegments={redubSegments} setRedubSegments={setRedubSegments} generateRedubSegment={generateRedubSegment}
              applyRedub={applyRedub} previewRedubSegment={previewRedubSegment} redubKeepOriginal={redubKeepOriginal} setRedubKeepOriginal={setRedubKeepOriginal}
              beginEdit={beginHistoryEdit} endEdit={endHistoryEdit} pushHistory={pushHistory} />
          ) : tab === 'filter' ? (
            <FilterTab filterKey={filterKey} setFilterKey={changeFilter} intensity={filterIntensity} setIntensity={changeFilterIntensity} beginEdit={beginHistoryEdit} endEdit={endHistoryEdit}
              renderExactPreview={renderExactFilterPreview} exactPreview={exactFilterPreview} previewBusy={exactFilterBusy} />
          ) : tab === 'effect' ? (
            <EffectTab hasClips={hasClips} selectedClip={selectedClip} selIsImage={isImg(selectedClip)}
              aiBusy={aiBusy} aiStatus={aiStatus} aiModelStatus={aiModelStatus} ensureAiModel={ensureAiModel} cancelAiOperation={cancelAiOperation} applyReplaceBg={applyReplaceBg} previewReplaceBg={previewReplaceBg} pickBgImage={pickBgImage}
              aiPreviewPath={aiPreviewPath} aiPreviewStart={aiPreviewStart} setAiPreviewStart={setAiPreviewStart}
              aiPreviewDuration={aiPreviewDuration} setAiPreviewDuration={setAiPreviewDuration} aiProcWidth={aiProcWidth} setAiProcWidth={setAiProcWidth}
              faceBusy={faceBusy} faceStatus={faceStatus} cancelFaceOperation={cancelFaceOperation} applyFaceSwap={applyFaceSwap} previewFaceSwap={previewFaceSwap} facePreviewPath={facePreviewPath} pickFaceImage={pickFaceImage} />
          ) : tab === 'sticker' ? (
            <StickerTab hasClips={hasClips} overlays={overlays} selOv={selOv} setSelOv={setSelOv}
              addEmoji={addEmoji} updateOverlay={updateOverlay} delOverlay={delOverlay} moveOverlayLayer={moveOverlayLayer} setOverlayBoundaryAtPlayhead={setOverlayBoundaryAtPlayhead} seekGlobal={seekGlobal} current={current}
              beginEdit={beginHistoryEdit} endEdit={endHistoryEdit} pushHistory={pushHistory} />
          ) : tab === 'trans' ? (
            <TransTab clipCount={clips.length} transition={transition} setTransition={changeTransition}
              duration={transitionDuration} setDuration={changeTransitionDuration} beginEdit={beginHistoryEdit} endEdit={endHistoryEdit}
              clampedCount={timelinePlan.entries.filter((entry) => entry.transitionIn === 'cross' && entry.overlapIn + 0.001 < transitionDuration).length}
              effectiveMin={timelinePlan.entries.filter((entry) => entry.transitionIn === 'cross').reduce((min, entry) => Math.min(min, entry.overlapIn), Infinity)} />
          ) : (
            (() => { const Ic = TABS.find((tb) => tb.k === tab).Icon; return <div className="cc-soon"><div className="big"><Ic size={42} /></div>{t('tab_' + tab)}<small>{t('coming_soon')}</small></div> })()
          )}
        </section>
        <div className="rsz v" onMouseDown={(e) => startPanelResize('lib', e)} />

        <section className="cc-player">
          <div className="cc-screen">
            {activeClip ? (
              <div ref={frameRef} className={`cc-frame ${ratio === 'original' ? 'orig' : 'fit'}`} style={frameStyle}>
                {activeClip.missing
                  ? <div className="cc-missing">{t('media_missing')}<small>{activeClip.path}</small><button className="cc-import" onClick={() => relinkMissingClip(activeClip.id)}>{t('media_relink')}</button></div>
                  : videoSrc
                  ? <video ref={videoRef} src={videoSrc} preload="auto" playsInline onLoadedMetadata={onLoadedMeta} onCanPlay={onPreviewCanPlay} onError={onPreviewVideoError} onTimeUpdate={onTimeUpdate} onClick={togglePlay} style={{ ...previewCropStyle, filter: filter.css, opacity: mainPreviewOpacity }} />
                  : <img className={`cc-slide ${activeClip.kenBurns !== false ? 'kb' : ''}`} src={imageSrc} alt="" draggable={false} onLoad={onPreviewImageLoad} onError={onPreviewImageError} onClick={togglePlay} style={{ ...previewCropStyle, filter: filter.css, opacity: mainPreviewOpacity }} />}
                {overlapPreview && (() => {
                  const other = activeClip?.id === overlapPreview.incoming.clipId ? overlapPreview.outgoing : overlapPreview.incoming
                  const otherClip = activeClip?.id === overlapPreview.incoming.clipId ? overlapPreview.outgoingClip : overlapPreview.incomingClip
                  const weight = 1 - mainPreviewWeight
                  if (!otherClip || otherClip.missing || weight <= 0) return null
                  const style = { opacity: weight, filter: filter.css }
                  if (isImg(otherClip)) return <img className="cc-xfade-layer" src={fileUrl(otherClip.path)} alt="" draggable={false} style={{ ...style, objectFit: otherClip.cropMode === 'fill' || otherClip.kenBurns !== false ? 'cover' : 'contain', objectPosition: `${(otherClip.cropX ?? 0.5) * 100}% ${(otherClip.cropY ?? 0.5) * 100}%` }} />
                  return <video key={otherClip.id} ref={overlapVideoRef} className="cc-xfade-layer" src={fileUrl(otherClip.path)} preload="auto" playsInline
                    onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = clamp(other.sourceTime, 0, Math.max(0, e.currentTarget.duration - 0.02)) } catch {} }}
                    onClick={togglePlay} style={style} />
                })()}
                {activeVideoOverlays.map((item) => <VideoOverlayPreview key={item.id} item={item} current={current} playing={playing} safeZone={safeZone && ratio !== 'original'}
                  onEditStart={beginHistoryEdit} onEditEnd={endHistoryEdit} onPositionChange={updateVideoOverlay} />)}
                {safeZone && ratio !== 'original' && (<div className="safe"><div className="sz top" /><div className="sz bottom" /><div className="sz right" /><span className="sz-tip">{t('safezone_tip')}</span></div>)}
                {activeCaption && <div className="cc-caption"><span>{activeCaption.text}</span></div>}
                {overlayOutsideSafe && <div className="cc-safe-warning">{t('preview_safe_warning')}</div>}
                {activePreviewOverride?.proxyPath && <div className="cc-preview-badge">{t('preview_proxy_badge')}</div>}
                {previewLoading && !activeClip.missing && <div className="cc-preview-state">{t('preview_loading')}</div>}
                {previewError && <div className="cc-preview-state error"><span>{previewError}</span>
                  {!activeIsImage && !activePreviewOverride?.proxyPath && <button className="cc-import" disabled={previewProxyBusy} onClick={tryPreviewProxy}>{previewProxyBusy ? t('preview_proxy_creating') : t('preview_proxy_create')}</button>}
                  {activePreviewOverride?.proxyPath && <button className="cc-import" onClick={useOriginalPreview}>{t('preview_use_original')}</button>}
                </div>}
                {activeOverlays.map((o) => (
                  <div key={o.id} className={`cc-ov ${o.type} ${selOv === o.id ? 'sel' : ''} ${safeZone && (o.x < 0.03 || o.x > 0.86 || o.y < 0.12 || o.y > 0.82) ? 'unsafe' : ''}`}
                    style={{ left: o.x * 100 + '%', top: o.y * 100 + '%', fontSize: Math.max(8, o.size * frameH) + 'px', color: o.type === 'text' ? o.color : undefined, textAlign: o.align || 'center', transform: `translate(${o.align === 'left' ? '0' : o.align === 'right' ? '-100%' : '-50%'}, -50%)`, zIndex: o.zIndex || 0 }}
                    onMouseDown={(e) => startOverlayDrag(o, e)}>{o.text}</div>
                ))}
              </div>
            ) : (
              <div className="cc-empty">
                <div className="ico"><Film size={50} /></div>
                <h3>{t('drop_title')}</h3><p>{t('drop_sub')}</p>
                <div className="empty-actions">
                  <button className="cc-import" onClick={handleImport}><Upload size={14} /> {t('import_video')}</button>
                  <button className="cc-import alt" onClick={handleImportImages}><Image size={14} /> {t('empty_slideshow')}</button>
                  <button className="cc-import alt" onClick={openProject}><FolderUp size={14} /> {t('proj_open')}</button>
                </div>
              </div>
            )}
            {music && <audio ref={musicRef} src={fileUrl(music.path)} loop={bgLoop} preload="auto" />}
            {voice && <audio ref={voiceRef} src={fileUrl(voice.path)} preload="auto" />}
            {audioItems.map((item) => <AudioItemPreview key={item.id} item={item} current={current} playing={playing} totalDuration={totalDuration} />)}
          </div>
          <div className="cc-pctrl">
            <span className="t">{fmt(current)}</span>
            <div className="btns">
              <button onClick={() => seekGlobal(0)} title={t('ctl_start')}><SkipBack size={16} /></button>
              <button onClick={() => seekGlobal(current - FRAME)} title={t('ctl_prev')}><ChevronLeft size={18} /></button>
              <button className="play" onClick={togglePlay} title={t('ctl_play')}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
              <button onClick={() => seekGlobal(current + FRAME)} title={t('ctl_next')}><ChevronRight size={18} /></button>
              <button onClick={() => seekGlobal(totalDuration)} title={t('ctl_end')}><SkipForward size={16} /></button>
              <button className={loop ? 'on' : ''} onClick={() => setLoop((l) => !l)} title={t('ctl_loop')}><Repeat size={15} /></button>
            </div>
            <div className="vol">
              <button onClick={() => setMuted((m) => !m)} title={t('ctl_mute')}>{muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false) }} />
            </div>
            <span className="t">{fmt(totalDuration)}</span>
          </div>
        </section>

        <div className="rsz v" onMouseDown={(e) => startPanelResize('insp', e)} />
        <Inspector width={inspW} hasClips={hasClips} single={single}
          ratio={ratio} setRatio={changeRatio} safeZone={safeZone} setSafeZone={setSafeZone}
          selectedClip={selectedClip} moveClip={moveClip} deleteClip={deleteClip} updateClip={updateClip}
          pushHistory={pushHistory} beginEdit={beginHistoryEdit} endEdit={endHistoryEdit} setAllSlideDur={setAllSlideDur}
          onDetectSilence={detectSilence} busy={busy} canDetectSilence={!!clips[0]?.src?.hasAudio}
          autoInfo={autoInfo} autoCut={autoCut} setAutoCut={changeAutoCut} status={status}
          silenceParams={silenceParams} updateSilenceAnalysis={updateSilenceAnalysis} applySilenceAnalysis={applySilenceAnalysis}
          silenceStale={!!autoInfo?.sourceKey && autoInfo.sourceKey !== (clips[0] && JSON.stringify({ id: clips[0].id, path: clips[0].path, in: clips[0].in, out: clips[0].out, speed: clips[0].speed }))}
          onPreviewSilence={previewSilenceAt} />
      </div>

      <div className="cc-tl" style={{ height: tlH }}>
        <div className="rsz h" onMouseDown={(e) => startPanelResize('tl', e)} />
        <div className="cc-tlbar">
          <button className="tb-ic" onClick={splitAtPlayhead} disabled={!hasClips} title={t('tb_split_tip')}><Scissors size={14} /> {t('tb_split')}</button>
          <button className="tb-ic" onClick={() => setSnapEnabled((value) => !value)} title={t('snap_tip')}
            style={snapEnabled ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>{t(snapEnabled ? 'snap_on' : 'snap_off')}</button>
          <button onClick={undo} disabled={!hist.length} title={t('undo')}><Undo2 size={14} /></button>
          <button onClick={redo} disabled={!future.length} title={t('redo')}><Redo2 size={14} /></button>
          <button onClick={() => setShowKeys(true)} title={t('keys_btn')}><Keyboard size={14} /></button>
          <div className="sp" />
          <span className="cur">{fmt(current)} / {fmt(totalDuration)}</span>
          <div className="zoom">
            <button onClick={() => setPps((p) => Math.max(20, p - 20))} title={t('zoom_out')}><Minus size={14} /></button>
            <button onClick={fitZoom} title={t('fit')}>{t('fit')}</button>
            <button onClick={() => setPps((p) => Math.min(300, p + 20))} title={t('zoom_in')}><Plus size={14} /></button>
          </div>
        </div>

        <div className="cc-tlscroll" ref={scrollRef} onClick={timelineClick}>
          <div className="cc-tlinner" style={{ width: tlWidth }}>
            <div className="cc-ruler" onMouseDown={startScrub}>{ticks.map((s) => <span key={s} className="tick" style={{ left: s * pps }}>{fmt(s).slice(3, 5)}s</span>)}</div>
            <div className="cc-track">
              {layout.map((seg) => (
                <div key={seg.key} className={`cc-clip ${selId === seg.id ? 'sel' : ''}`} style={{ left: seg.start * pps, width: (seg.end - seg.start) * pps }} onClick={(e) => { e.stopPropagation(); setSelId(seg.id); setSelOv(null); seekGlobal(clientXToTime(e.clientX)) }}>
                  <div className="h l" onMouseDown={(e) => startTrim(seg.clip, 'l', e)} />
                  <div className="strip" onMouseDown={(e) => startReorder(seg, e)} title={seg.clip.name}>{seg.clip.thumbs?.length ? seg.clip.thumbs.map((th, i) => <img key={i} src={fileUrl(th)} alt="" draggable={false} />) : <span className="cn">🎬 {seg.clip.name}</span>}</div>
                  <div className="h r" onMouseDown={(e) => startTrim(seg.clip, 'r', e)} />
                </div>
              ))}
            </div>
            {videoOverlays.length > 0 && <div className="cc-track cc-v2-track">
              <span className="cc-track-label">V2</span>
              {videoOverlays.map((item) => {
                const itemDuration = (item.out - item.in) / item.speed
                const outside = item.start + itemDuration > totalDuration + FRAME
                return <div key={item.id} className={`cc-v2-clip ${outside ? 'outside' : ''}`} title={`${item.name || item.path} · ${fmt(item.start)}${outside ? ` · ${t('v2_outside_v1')}` : ''}`}
                style={{ left: item.start * pps, width: Math.max(24, ((item.out - item.in) / item.speed) * pps) }}
                onMouseDown={(event) => startV2Move(item, event)} onClick={(event) => { event.stopPropagation(); seekGlobal(item.start) }}>
                <span>{item.name || item.path.split(/[\\/]/).pop()}</span>
                <button className="cc-v2-resize" onMouseDown={(event) => startV2Resize(item, event)} title={t('v2_resize_tip')} />
                <button onClick={(event) => { event.stopPropagation(); pushHistory(); setVideoOverlays((items) => items.filter((candidate) => candidate.id !== item.id)) }} title={t('v2_remove_tip')}><X size={11} /></button>
              </div>})}
            </div>}
            {anyAudio && (
              <div className="cc-track audio">
                {layout.map((seg) => seg.clip.src?.hasAudio && (
                  <div key={seg.key} className="cc-aclip" style={{ left: seg.start * pps, width: (seg.end - seg.start) * pps }}>
                    {seg.clip.wave
                      ? <div className="wimg" style={{ backgroundImage: `url(${fileUrl(seg.clip.wave)})`, backgroundSize: `${seg.clip.src.duration * pps / (seg.clip.speed || 1)}px 100%`, backgroundPosition: `${-(seg.clip.in * pps / (seg.clip.speed || 1))}px 0` }} />
                      : <div className="wave" />}
                    {seg.clip.waveError && <button className="cc-wave-retry" title={t('media_retry')} onClick={(event) => { event.stopPropagation(); loadWave(seg.clip.id, seg.clip.path, true) }}>↻</button>}
                    <span>{seg.clip.name}</span>
                  </div>
                ))}
              </div>
            )}
            {music && (
              <div className="cc-track music">
                <div className="cc-mclip" style={{ width: Math.max((bgLoop ? (totalDuration || 0) : Math.min(bgDur || totalDuration || 0, totalDuration || 0)) * pps, 120) }} onClick={(e) => { e.stopPropagation(); setTab('audio') }} title={music.name}>
                  {musicWave
                    ? <div className="wimg rep" style={{ backgroundImage: `url(${fileUrl(musicWave)})`, backgroundSize: `${Math.max(20, (bgDur || 10) * pps)}px 100%` }} />
                    : <div className="wave" />}<Music size={13} /><span>{music.name}</span>
                  <button className="mclip-x" onClick={(e) => { e.stopPropagation(); pushHistory(); commitMusic(null); setBgDur(0) }} title={t('bg_remove')}><X size={12} /></button>
                </div>
              </div>
            )}
            {voice && (
              <div className="cc-track music">
                <div className="cc-vclip" style={{ left: voiceOffset * pps, width: Math.max((voiceDur || 2) * pps, 70) }}
                  onMouseDown={startVoiceDrag} onClick={(e) => e.stopPropagation()} title={voice.name + ' — ' + fmt(voiceOffset)}>
                  {voiceWave
                    ? <div className="wimg" style={{ backgroundImage: `url(${fileUrl(voiceWave)})`, backgroundSize: `${Math.max(20, (voiceDur || 2) * pps)}px 100%` }} />
                    : <div className="wave" />}<Mic size={13} /><span>{voice.name}</span>
                  <button className="mclip-x" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); pushHistory(); commitVoice(null); setVoiceDur(0); setVoiceOffset(0) }} title={t('bg_remove')}><X size={12} /></button>
                </div>
              </div>
            )}
            {audioItems.map((item) => {
              const itemDuration = item.loop ? Math.max(0, totalDuration - item.start) : item.out - item.in
              const outside = !item.loop && item.start + itemDuration > totalDuration + FRAME
              return <div className={`cc-track cc-audio-item-track ${item.track}`} key={item.id}>
                <span className="cc-track-label">{item.track === 'music' ? 'Music' : 'Voice'}</span>
                <div className={`cc-audio-item-clip ${item.track} ${item.muted ? 'muted' : ''} ${outside ? 'outside' : ''}`}
                  style={{ left: item.start * pps, width: Math.max(28, itemDuration * pps) }}
                  onMouseDown={(event) => startAudioItemDrag(item, event)} onClick={(event) => { event.stopPropagation(); seekGlobal(item.start) }}
                  title={`${item.name} · ${fmt(item.start)}${outside ? ` · ${t('v2_outside_v1_short')}` : ''}`}>
                  <span>{item.name}</span>
                  <button onClick={(event) => { event.stopPropagation(); removeAudioItem(item.id) }} title={t('audio_item_remove_tip')}><X size={11} /></button>
                </div>
              </div>
            })}
            {overlays.length > 0 && (
              <div className="cc-track ovl">
                {overlays.map((o) => (
                  <div key={o.id} className={`cc-oclip ${selOv === o.id ? 'sel' : ''}`}
                    style={{ left: o.start * pps, width: Math.max((o.end - o.start) * pps, 18) }}
                    onMouseDown={(e) => startOvMove(o, e)} onClick={(e) => e.stopPropagation()} title={o.text}>
                    <div className="oh l" onMouseDown={(e) => startOvResize(o, 'l', e)} />
                    <span>{o.type === 'emoji' ? o.text : o.text}</span>
                    <div className="oh r" onMouseDown={(e) => startOvResize(o, 'r', e)} />
                  </div>
                ))}
              </div>
            )}
            {dragInsert != null && <div className="cc-drop-ind" style={{ left: (dragInsert < layout.length ? layout[dragInsert].start : totalDuration) * pps }} />}
            {hasClips && <div className="cc-playhead" style={{ left: current * pps }}><div className="head" onMouseDown={startScrub} /></div>}
          </div>
        </div>
      </div>

      {dragOver && <div className="cc-drop"><div>{t('drop_overlay')}</div></div>}

      <ToastStack toasts={toasts} onClose={closeToast} />

      {showExport && (
        <ExportDialog
          ratio={ratio} extraRatios={extraRatios} toggleExtra={toggleExtra}
          mode={mode} setMode={changeMode} gpuEnc={gpuEnc} useGpu={useGpu} setUseGpu={setUseGpu}
          quality={quality} setQuality={setQuality} resolution={resolution} setResolution={setResolution}
          captionsCount={captions.length} burnCaptions={burnCaptions} setBurnCaptions={changeBurnCaptions}
          clipCount={clips.length} totalDuration={totalDuration}
          hasBurnStage={(burnCaptions && captions.length > 0) || overlays.length > 0}
          hasAudioStage={!!(music || voice)}
          exporting={exporting} progress={progress} stage={expStage} status={status}
          onStart={handleExport} onCancel={() => activeExportJobRef.current && window.taoclip.cancelExport?.(activeExportJobRef.current)}
          onClose={() => setShowExport(false)} />
      )}

      {showKeys && <ShortcutsModal onClose={() => setShowKeys(false)} />}
      {trimTooltip && <div className="cc-trim-tooltip" style={{ left: trimTooltip.x, top: trimTooltip.y }} role="status" aria-live="polite">
        <b>{trimTooltip.which === 'l' ? 'In' : 'Out'} {fmt(trimTooltip.source)}</b><span>{t('trim_preview')}: {fmt(trimTooltip.duration)}</span>
      </div>}
    </div>
  )
}
