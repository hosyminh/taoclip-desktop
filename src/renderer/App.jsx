import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getEntitlements } from './entitlements.js'
import { useI18n } from './i18n.jsx'
import {
  Film, Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Repeat, Volume2, VolumeX,
  Upload, Scissors, Image, FolderUp, Copy, CopyPlus, ClipboardPaste, Frame, Sparkles, AudioLines, AudioWaveform, Captions, Lock, Unlock, Trash2, Pencil
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
import Timeline from './timeline/Timeline.jsx'
import ContextMenu from './timeline/ContextMenu.jsx'
import { MIN_PIECE, FREEZE_SECONDS, splitTimelineItem, insertFreezeFrame, duplicateClipAfter, mergeClipCaptions, splitAnchoredCaptions, rippleItems, rippleOverlays } from './timeline/clip-commands.js'
import { clientXToTime as geometryClientXToTime, ASSET_DRAG_TYPE, HEAD_W, ZOOM_STEP, clampPps, fitPps, tickStep } from './timeline/geometry.js'
import {
  defaultTracks, normalizeTracks, makeTrack, nextTrackNumber, choosePlacement, itemSpan, clipAudioSpans, layerIndex, withLayerZIndex,
  audibleTrackIds, visibleVideoTrackIds, insertIndexForTime, buildDetachedAudioItem, isCoreTrack, MAIN_VIDEO_TRACK, MAIN_AUDIO_TRACK
} from './track-model.js'
import { DEFAULT_TRANSITION_STYLE } from './transition-styles.js'
import { stickerChar } from './sticker-catalog.js'
import Inspector from './Inspector.jsx'
import ExportDialog from './ExportDialog.jsx'
import TopBar from './TopBar.jsx'
import ToastStack from './ToastStack.jsx'
import ShortcutsModal from './ShortcutsModal.jsx'
import RecoveryBanner from './RecoveryBanner.jsx'
import VideoOverlayPreview from './VideoOverlayPreview.jsx'
import AudioItemPreview from './AudioItemPreview.jsx'
import { normalizeProject } from './project-model.js'
import {
  MAX_TIMELINES, nextTimelineName, copyTimelineName, cleanTimelineName, activeAfterRemove, moveTimeline, libraryAfterRestore, approxTimelineDuration
} from './timelines-model.js'
import TimelineTabs from './timeline/TimelineTabs.jsx'
import { buildTimelinePlan, fitImageDurationToTarget, mapSourceRange, mapTimelineTime, mapTimelineRangeToSources, resolvePreviewSource, toExportSegments, snapToFrameTime } from './timeline-plan.js'
import { snapshotHistoryClips, restoreHistoryClips, historySnapshotsEqual, restoreHistorySelection } from './history-model.js'
import { createAsyncResourceGuard } from './async-resource-guard.js'
import { attachDocumentMouseDrag } from './drag-utils.js'
import { aggregateBatchProgress } from './export-progress.js'

function makeEntityId(kind) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `${kind}_${value}`
}

// Doi tab timeline khong phai la sua du an: bo tab dang mo khoi khoa so sanh "da thay doi chua luu"
const projectKey = (project) => JSON.stringify({ ...project, activeTimelineId: null })

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
  // Khung hinh thu nho cho video tren V2+ (khoa theo duong dan; dung chung neu nhieu item cung nguon)
  const [overlayThumbs, setOverlayThumbs] = useState({})
  const overlayThumbRequests = useRef(new Set())
  const [audioWaves, setAudioWaves] = useState({}) // anh song am theo duong dan cho item audio roi
  const audioWaveRequests = useRef(new Set())
  const [multiSel, setMultiSel] = useState([]) // [{kind: 'clip' | 'v2' | 'audio', id}]: tap chon nhieu (chi co hieu luc khi >= 2 va chua muc dang chon chinh)
  const [marquee, setMarquee] = useState(null) // { x1, y1, x2, y2 } toa do man hinh cua khung quet chon
  const [laneDrag, setLaneDrag] = useState(null) // { trackId, time }: duong dich + thoi diem khi keo clip / item sang duong khac
  const ppsRef = useRef(pps)
  ppsRef.current = pps
  const zoomAnchorRef = useRef(null) // diem thoi gian giu yen khi doi muc thu phong: { time, x (px trong khung cuon) }
  // Sau khi doi pps: cuon lai de diem neo (con tro / tam man hinh / dau timeline) nam dung cho cu
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    zoomAnchorRef.current = null
    const el = scrollRef.current
    if (anchor && el) el.scrollLeft = Math.max(0, HEAD_W + anchor.time * pps - anchor.x)
  }, [pps])
  const [snapEnabled, setSnapEnabled] = useState(() => localStorage.getItem('taoclip_snap') !== '0')
  const [compactLanes, setCompactLanes] = useState(() => { try { return localStorage.getItem('taoclip_compact') === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem('taoclip_compact', compactLanes ? '1' : '0') } catch {} }, [compactLanes])
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
  const [markers, setMarkers] = useState([]) // [{ id, time, name }]: moc tren thuoc thoi gian cua timeline
  const [renamingMarkerId, setRenamingMarkerId] = useState(null)
  const [busy, setBusy] = useState(false)
  // am thanh them: cac doan audio (nhac / giong / tieng goc da tach) tren cac track, tron cung luc khi xuat
  const [videoOverlays, setVideoOverlays] = useState([])
  const [audioItems, setAudioItems] = useState([])
  const [ducking, setDucking] = useState(true) // tu ha nhac khi co giong
  const [syncMode, setSyncMode] = useState('fit') // fit = chia deu theo nhac | fixed = co dinh moi anh
  const [slideDur, setSlideDur] = useState(3) // thoi luong mac dinh moi anh (che do fixed)
  const [origVolume, setOrigVolume] = useState(1)
  const [tracks, setTracks] = useState(() => defaultTracks())
  const [selItem, setSelItem] = useState(null) // {kind: 'v2' | 'audio', id}
  const [ctxMenu, setCtxMenu] = useState(null) // {x, y, target: {kind: 'clip' | 'v2' | 'audio', id}}
  const [clipboard, setClipboard] = useState(null) // {kind, data}: ban sao clip / item de dan tai dau phat
  // Ban sao moi nhat cua tracks + item phu + audio: tranh doc state cu sau cac await (nhap media...)
  const timelineStateRef = useRef({ tracks, videoOverlays, audioItems })
  timelineStateRef.current = { tracks, videoOverlays, audioItems }
  const visibleVideoIds = useMemo(() => visibleVideoTrackIds(tracks), [tracks])
  const audibleIds = useMemo(() => audibleTrackIds(tracks), [tracks])
  // A1 la track tieng goc cua clip V1: tat tieng / solo track khac se tat luon tieng goc
  const effOrigVolume = audibleIds.has(MAIN_AUDIO_TRACK) ? origVolume : 0
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
  const [transitionStyle, setTransitionStyle] = useState(DEFAULT_TRANSITION_STYLE) // kieu xfade khi transition = cross
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
  // Nhieu timeline trong mot du an: timeline dang mo song trong cac state o tren; tab con lai giu snapshot + lich su rieng
  const firstTimelineRef = useRef(null)
  if (!firstTimelineRef.current) firstTimelineRef.current = { id: makeEntityId('timeline'), name: 'Timeline 1', snap: null, hist: [], future: [] }
  const [timelines, setTimelines] = useState(() => [firstTimelineRef.current])
  const [activeTimelineId, setActiveTimelineId] = useState(firstTimelineRef.current.id)
  const [renamingTabId, setRenamingTabId] = useState(null)
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
  const [tlH, setTlH] = useState(() => clamp(Number(localStorage.getItem('taoclip_tlh3')) || clamp(Math.round(window.innerHeight * 0.45), 340, 520), 200, 640))

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
      else setTlH(clamp(t0 - (ev.clientY - sy), 200, 640))
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
  // Clip dang xem co tieng rieng duoc tach / tat -> phan tieng cua the <video> phai im (tieng tach phat qua audio item)
  const clipSilent = !!(activeClip?.audioDetached || activeClip?.audioMuted)
  const mainFilterCss = activeClip?.enhance ? `${filter.css === 'none' ? '' : filter.css + ' '}contrast(1.05) saturate(1.1)` : filter.css
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
  const fitMusicDuration = useMemo(() => Math.max(0, ...audioItems.filter((item) => item.track === 'music' && !item.muted)
    .map((item) => Math.max(0, Number(item.start) || 0) + Math.max(0, (Number(item.out) || 0) - (Number(item.in) || 0)) / (Number(item.speed) > 0 ? Number(item.speed) : 1))), [audioItems])
  const hasFitMusic = audioItems.some((item) => item.track === 'music' && !item.muted)

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
    try { localStorage.setItem('taoclip_libw', libW); localStorage.setItem('taoclip_inspw', inspW); localStorage.setItem('taoclip_tlh3', tlH) } catch {}
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
  // Nap khung hinh thu nho cho video tren V2+ (mot lan moi file; loi thi cho phep thu lai o lan doi sau)
  useEffect(() => {
    for (const item of videoOverlays) {
      const mediaPath = item.path
      if (item.kind !== 'video' || item.sticker || item.missing || !mediaPath || overlayThumbRequests.current.has(mediaPath)) continue
      overlayThumbRequests.current.add(mediaPath)
      window.taoclip.thumbnails(mediaPath, 8)
        .then((thumbs) => setOverlayThumbs((map) => ({ ...map, [mediaPath]: thumbs?.length ? thumbs : [] })))
        .catch(() => { overlayThumbRequests.current.delete(mediaPath) })
    }
  }, [videoOverlays])
  // Song am cho item audio roi (mot lan moi file; loi thi cho phep thu lai o lan doi sau)
  useEffect(() => {
    for (const item of audioItems) {
      const mediaPath = item.path
      if (item.missing || !mediaPath || audioWaveRequests.current.has(mediaPath) || !window.taoclip.waveform) continue
      audioWaveRequests.current.add(mediaPath)
      window.taoclip.waveform(mediaPath)
        .then((wave) => { if (wave) setAudioWaves((map) => ({ ...map, [mediaPath]: wave })) })
        .catch(() => { audioWaveRequests.current.delete(mediaPath) })
    }
  }, [audioItems])
  // Tu luu (debounce 1.2s) khi du an thay doi
  useEffect(() => {
    clearTimeout(autosaveRef.current)
    autosaveRef.current = setTimeout(() => { window.taoclip.writeRecovery?.(buildProject()).catch(() => {}) }, 1200)
    return () => clearTimeout(autosaveRef.current)
  }, [clips, ratio, filterKey, filterIntensity, mode, captions, overlays, videoOverlays, audioItems, tracks, ducking, origVolume, transition, transitionDuration, burnCaptions, syncMode, slideDur, keepSegments, autoCut, autoInfo, aiEdited, ttsEngine, ttsVoice, ttsRate, ttsPitch, silenceParams, markers, timelines, activeTimelineId, libraryAssets])
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
    if (video) { video.volume = volume * effOrigVolume * mainPreviewOpacity; video.muted = muted || clipSilent }
  }, [volume, muted, clipSilent, effOrigVolume, activeIdx, mainPreviewOpacity])
  useEffect(() => {
    const video = overlapVideoRef.current
    if (!video || !overlapPreview) return
    const other = activeClip?.id === overlapPreview.incoming.clipId ? overlapPreview.outgoing : overlapPreview.incoming
    const otherClip = activeClip?.id === overlapPreview.incoming.clipId ? overlapPreview.outgoingClip : overlapPreview.incomingClip
    if (!otherClip || otherClip.missing || isImg(otherClip)) { video.pause(); return }
    video.playbackRate = otherClip.speed || 1
    video.volume = volume * effOrigVolume * (1 - mainPreviewWeight)
    video.muted = muted || !otherClip.src?.hasAudio || !!otherClip.audioDetached || !!otherClip.audioMuted
    if (Number.isFinite(video.duration) && video.duration > 0 && Math.abs(video.currentTime - other.sourceTime) > 0.12) {
      try { video.currentTime = clamp(other.sourceTime, 0, Math.max(0, video.duration - 0.02)) } catch {}
    }
    if (playing) video.play().catch(() => {})
    else video.pause()
  }, [overlapPreview, activeClip, mainPreviewWeight, volume, muted, effOrigVolume, playing])
  // Giu activeIdx & current trong pham vi hop le khi xoa/doi thu tu/cat clip
  useEffect(() => { if (selOv) setSelItem(null) }, [selOv])
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
  }, [timelinePlan, totalDuration, clips, activeIdx])

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

  // ---- Lich su (snapshot toan bo noi dung du an: clips + overlay + phu de + audio) ----
  function snapshot() {
    return {
      selectedClipId: selId, selectedOverlayId: selOv, activeClipId: clips[activeIdx]?.id || null, activeClipIndex: activeIdx,
      clips: snapshotHistoryClips(clips), libraryAssets, overlays, videoOverlays, audioItems, tracks, captions, captionTimebase,
      ratio, filterKey, filterIntensity, mode, transition, transitionStyle, transitionDuration, burnCaptions,
      origVolume, ducking, syncMode, slideDur,
      ttsEngine, ttsVoice, ttsRate, ttsPitch, keepSegments, autoCut, autoInfo, aiEdited, silenceParams, markers
    }
  }
  // Thu vien media dung chung nhieu timeline: hoan tac o tab nay khong duoc lam mat media tab khac dang dung
  function restoredLibrary(restoredAssets) {
    const others = timelines.filter((entry) => entry.id !== activeTimelineId && entry.snap).map((entry) => entry.snap)
    return libraryAfterRestore(restoredAssets, libraryAssetsRef.current, others)
  }
  // Cac bo xu ly keo (mouseup) duoc tao luc nhan chuot nen "snapshot" trong closure da cu: luon so sanh voi trang thai moi nhat
  const latestSnapshotRef = useRef(null)
  latestSnapshotRef.current = snapshot
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
    if (snapshotsEqual(latestSnapshotRef.current(), pending.before)) {
      if (pending.added) setHist((items) => items[items.length - 1] === pending.before ? items.slice(0, -1) : items)
      setFuture(pending.futureBefore)
      if (editRevisionRef.current === pending.revisionAtStart) editRevisionRef.current = pending.revisionBefore
    }
  }
  function restore(s) {
    const restoredClips = restoreHistoryClips(s.clips, clips)
    const restoredSelection = restoreHistorySelection(s, restoredClips, s.overlays || [], activeIdx)
    setClips(restoredClips)
    setLibraryAssets(restoredLibrary(s.libraryAssets))
    setSelId(restoredSelection.selectedClipId); setSelOv(restoredSelection.selectedOverlayId); setActiveIdx(restoredSelection.activeClipIndex)
    restoredClips.forEach((clip) => {
      if (clip.kind !== 'image' && !clip.missing && !clip.thumbs?.length) loadThumbnails(clip.id, clip.path)
      if (clip.kind !== 'image' && !clip.missing && clip.src?.hasAudio && !clip.wave) loadWave(clip.id, clip.path, true)
    })
    setOverlays(s.overlays || []); setVideoOverlays(s.videoOverlays || []); setAudioItems(s.audioItems || []); setTracks(normalizeTracks(s.tracks)); setSelItem(null); setCaptions(s.captions || []); setCaptionTimebase(s.captionTimebase || 'timeline')
    setRatio(s.ratio || '9:16'); setFilterKey(s.filterKey || 'none'); setFilterIntensity(s.filterIntensity ?? 100); setMode(s.mode || 'smart')
    setTransition(s.transition || 'none'); setTransitionStyle(s.transitionStyle || DEFAULT_TRANSITION_STYLE); setTransitionDuration(s.transitionDuration ?? 0.5); setBurnCaptions(s.burnCaptions !== false)
    setOrigVolume(s.origVolume ?? 1)
    setDucking(s.ducking !== false); setSyncMode(s.syncMode || 'fit'); setSlideDur(s.slideDur ?? 3)
    setTtsEngine(s.ttsEngine || 'local'); setTtsVoice(s.ttsVoice || ''); setTtsRate(s.ttsRate ?? 1); setTtsPitch(s.ttsPitch ?? 0)
    setKeepSegments(s.keepSegments ?? null); setAutoCut(!!s.autoCut); setAutoInfo(s.autoInfo ?? null); setAiEdited(!!s.aiEdited)
    setSilenceParams(s.silenceParams || (s.autoInfo?.options ? {
      threshold: Number.parseFloat(s.autoInfo.options.noise) || -30,
      minSilence: s.autoInfo.options.minSilence ?? 0.4, pad: s.autoInfo.options.pad ?? 0.06
    } : { threshold: -30, minSilence: 0.4, pad: 0.06 }))
    setMarkers(s.markers || [])
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
  function changeTransitionStyle(value) { if (value !== transitionStyle) { pushHistory(); setTransitionStyle(value) } }
  function changeMode(value) { if (value !== mode) { pushHistory(); setMode(value) } }
  function changeBurnCaptions(value) { if (value !== burnCaptions) { pushHistory(); setBurnCaptions(value) } }
  function changeSyncMode(value) { if (value !== syncMode) { pushHistory(); setSyncMode(value) } }
  function changeAutoCut(value) {
    if (value === autoCut) return
    if (value && (clips[0]?.audioDetached || clips[0]?.audioMuted)) { setStatus(t('msg_autocut_blocked_detached')); return }
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
    const audioFound = []
    let duplicates = 0
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
        if (seen.has(key)) {
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
            audioFound.push({ path: p, name, media }); libraryAdditions.push(makeLibraryAsset(p, 'audio', media))
          } else if (media.kind === 'image') {
            libraryAdditions.push(makeLibraryAsset(p, 'image', media))
            built.push(makeClipFromMedia(p, name, media))
          } else {
            libraryAdditions.push(makeLibraryAsset(p, 'video', media))
            built.push(makeClipFromMedia(p, name, media))
          }
        } catch (error) { failures.push({ path: name, reason: String(error.message || error).slice(0, 240) }) }
      }
      if (resourceScopeRef.current !== importScope) {
        setStatus(t('msg_project_changed_import'))
        return { added: 0, stale: true }
      }
      if (built.length || audioFound.length) {
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
        if (audioFound.length) {
          appendAudioItems(audioFound.map((found) => makeAudioItem({ path: found.path, name: found.name, role: 'music', start: 0, duration: found.media.duration })))
        }
      }
      const result = [...built.map((item) => ({ path: item.name, ok: true })),
        ...audioFound.map((found) => ({ path: found.name, ok: true })), ...failures]
      setImportReport(result)
      const cancelled = cancelImportRef.current && built.length < inputs.length
      setStatus(t('msg_import_summary', { n: built.length + audioFound.length, f: failures.length }) + (cancelled ? ` · ${t('msg_cancelled_suffix')}` : '') + (duplicates ? ` · ${t('msg_dup_suffix', { n: duplicates })}` : ''))
      return { added: built.length + audioFound.length, failed: failures.length, cancelled }
    } finally {
      importBusyRef.current = false; cancelImportRef.current = false
      setImporting(false); setImportProgress('')
    }
  }
  // Clip V1 moi tu thong tin media (anh: thoi luong = slideDur, ken burns; video: toan bo file)
  function makeClipFromMedia(mediaPath, name, media) {
    if (media.kind === 'image') {
      return { id: makeEntityId('clip'), kind: 'image', path: mediaPath, name, animated: media.formatName === 'gif',
        src: { duration: media.duration || slideDur, width: media.width, height: media.height, hasAudio: false, isImage: true, rotation: media.rotation || 0 },
        in: 0, out: slideDur, speed: 1, kenBurns: true, thumbs: [mediaPath] }
    }
    return { id: makeEntityId('clip'), path: mediaPath, name, src: media, in: 0, out: media.duration, speed: 1, thumbs: [] }
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
  // ---- Audio item: moi doan nhac / giong / tieng goc da tach la mot item tren track ----
  function makeAudioItem({ path: audioPath, name, role = 'music', start = 0, duration, sourceDuration = duration, gain, loop, source = 'local', speed = 1, extra = {} }) {
    const length = Math.max(0.001, Number(duration) || 0.001)
    return { id: makeEntityId('audio'), path: audioPath, name: name || audioPath.split(/[\\/]/).pop(), track: role, start, in: 0, out: length,
      sourceDuration: Number(sourceDuration) || length, speed, gain: gain ?? (role === 'music' ? 0.4 : 1), fadeIn: 0, fadeOut: 0,
      loop: loop ?? role === 'music', muted: false, missing: false, ...(source !== 'local' ? { source } : {}), ...extra }
  }
  function appendAudioItems(newItems) { if (newItems.length) editTimeline((state) => placeItems(state, 'audio', newItems)) }
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
  // Sua dong thoi tracks + item phu + audio (dat item vao track con trong, tao track moi khi can)
  function editTimeline(mutator) {
    const next = mutator(timelineStateRef.current)
    timelineStateRef.current = next
    setTracks(next.tracks); setVideoOverlays(next.videoOverlays); setAudioItems(next.audioItems)
  }
  // Dat item moi vao track: uu tien track mong muon, va cham thi sang track ke tiep, het thi tao track moi (xem track-model.choosePlacement)
  function placeItems(state, kind, newItems, preferred = null, forceNew = false, ignoreClipAudio = []) {
    let nextTracks = state.tracks, nextVideo = state.videoOverlays, nextAudio = state.audioItems
    let newTrackFirst = forceNew, running = preferred
    const a1Busy = clipAudioSpans(layout).filter((span) => !ignoreClipAudio.includes(span.clipId)).map(({ start, end }) => ({ start, end }))
    for (const item of newItems) {
      const prefer = item.trackId || running || (kind === 'video' ? 'V2' : item.track === 'original' ? MAIN_AUDIO_TRACK : 'A2')
      const { trackId, created } = choosePlacement({ tracks: nextTracks, items: kind === 'video' ? nextVideo : nextAudio, kind, preferred: prefer,
        span: itemSpan(item, { totalDuration }), totalDuration, extraByTrack: kind === 'audio' ? { [MAIN_AUDIO_TRACK]: a1Busy } : {}, forceNew: newTrackFirst })
      if (newTrackFirst) { newTrackFirst = false; running = trackId }
      if (created) nextTracks = normalizeTracks([...nextTracks, created])
      if (kind === 'video') nextVideo = [...nextVideo, { ...item, trackId, zIndex: layerIndex(nextTracks, trackId) }]
      else nextAudio = [...nextAudio, { ...item, trackId }]
    }
    return { tracks: nextTracks, videoOverlays: nextVideo, audioItems: nextAudio }
  }
  function addClipToV2(clip) {
    if (!clip || clip.missing) return
    pushHistory()
    editTimeline((state) => placeItems(state, 'video', [{
      id: makeEntityId('video-overlay'), path: clip.path, name: clip.name, kind: isImg(clip) ? 'image' : 'video',
      start: current, in: isImg(clip) ? 0 : clip.in, out: clip.out, speed: isImg(clip) ? 1 : (clip.speed || 1),
      x: 0.25, y: 0.25, width: 0.5, height: 0.5, opacity: 1,
      animated: !!clip.animated, sourceDuration: clip.src?.duration || clip.out, missing: false
    }]))
    setStatus(t('msg_added_v2'))
  }
  const trackLocked = (trackId) => !!tracks.find((track) => track.id === trackId)?.locked
  function warnLocked() { setStatus(t('track_locked_msg')) }
  function patchTrack(id, patch) { pushHistory(); setTracks((items) => items.map((track) => track.id === id ? { ...track, ...patch } : track)) }
  function addTrack(kind) { pushHistory(); setTracks((items) => normalizeTracks([...items, makeTrack(kind, nextTrackNumber(items, kind))])) }
  function removeTrack(id) {
    if (isCoreTrack(id) || [...videoOverlays, ...audioItems].some((item) => item.trackId === id)) return
    pushHistory(); setTracks((items) => items.filter((track) => track.id !== id))
  }
  function removeVideoOverlay(id) {
    const item = videoOverlays.find((candidate) => candidate.id === id)
    if (!item) return
    if (trackLocked(item.trackId)) { warnLocked(); return }
    pushHistory(); setVideoOverlays((items) => items.filter((candidate) => candidate.id !== id))
    setSelItem((sel) => (sel?.id === id ? null : sel))
  }
  // ---- Tach / gan lai am thanh cua clip V1: tieng thanh doan audio rieng tren track tieng (A1), sua / keo / xoa doc lap ----
  function detachAudio(clipId, place = null) {
    const clip = clips.find((candidate) => candidate.id === clipId)
    const entry = layout.find((seg) => seg.id === clipId)
    if (!clip || !entry || isImg(clip) || clip.missing || !clip.src?.hasAudio || clip.audioDetached) return
    if (trackLocked(MAIN_VIDEO_TRACK) || trackLocked(MAIN_AUDIO_TRACK)) { warnLocked(); return }
    if (autoCut && clips.length === 1) { setStatus(t('msg_detach_blocked_autocut')); return }
    pushHistory()
    const item = { ...buildDetachedAudioItem(clip, entry, makeEntityId('audio')), ...(place ? { start: place.start, trackId: place.trackId } : {}) }
    updateClip(clipId, { audioDetached: true })
    editTimeline((state) => placeItems(state, 'audio', [item], place?.trackId || MAIN_AUDIO_TRACK, false, [clipId]))
    setSelItem({ kind: 'audio', id: item.id }); setSelOv(null)
    setStatus(t('msg_audio_detached'))
  }
  function reattachAudio(clipId) {
    const clip = clips.find((candidate) => candidate.id === clipId)
    if (!clip?.audioDetached) return
    pushHistory()
    updateClip(clipId, { audioDetached: false })
    setAudioItems((items) => items.filter((item) => item.sourceClipId !== clipId))
    setSelItem(null)
    setStatus(t('msg_audio_reattached'))
  }
  function toggleDetachSelected() {
    if (!selectedClip) return
    if (selectedClip.audioDetached) reattachAudio(selectedClip.id)
    else detachAudio(selectedClip.id)
  }
  // ---- Menu chuot phai va lenh tren clip / item ----
  function findTarget(target) {
    if (!target) return null
    if (target.kind === 'clip') return clips.find((candidate) => candidate.id === target.id) || null
    if (target.kind === 'v2') return videoOverlays.find((candidate) => candidate.id === target.id) || null
    if (target.kind === 'audio') return audioItems.find((candidate) => candidate.id === target.id) || null
    return null
  }
  const selectedTarget = selItem ? { kind: selItem.kind, id: selItem.id } : selId ? { kind: 'clip', id: selId } : null
  function selectTarget(target) { if (target.kind === 'clip') selectClip(target.id); else selectItem({ kind: target.kind, id: target.id }) }
  const sameTarget = (a, b) => a.kind === b.kind && a.id === b.id
  // Chon don le o cho khac (muc chinh khong con nam trong tap) thi tap chon nhieu tu huy
  const multi = multiSel.length > 1 && selectedTarget && multiSel.some((m) => sameTarget(m, selectedTarget)) ? multiSel.filter((m) => findTarget(m)) : []
  const multiKeys = new Set(multi.map((m) => `${m.kind}:${m.id}`))
  const inMulti = (target) => multi.length > 1 && multi.some((m) => sameTarget(m, target))
  const selectedTargets = () => (multi.length > 1 ? multi : selectedTarget ? [selectedTarget] : [])
  function applySelection(targets) {
    if (!targets.length) { setMultiSel([]); setSelId(null); setSelItem(null); setSelOv(null); return }
    if (targets.length === 1) { setMultiSel([]); selectTarget(targets[0]); return }
    setMultiSel(targets); selectTarget(targets[targets.length - 1])
    setStatus(t('msg_multi_selected', { n: targets.length }))
  }
  // Ctrl / Shift + click: them / bo mot muc khoi tap chon; click thuong: chon don le
  function clickSelect(target, event) {
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      const base = selectedTargets()
      applySelection(base.some((m) => sameTarget(m, target)) ? base.filter((m) => !sameTarget(m, target)) : [...base, target])
      return
    }
    setMultiSel([]); selectTarget(target)
  }
  function selectAllTargets() {
    applySelection([...clips.map((c) => ({ kind: 'clip', id: c.id })), ...videoOverlays.map((i) => ({ kind: 'v2', id: i.id })), ...audioItems.map((i) => ({ kind: 'audio', id: i.id }))])
  }
  // Quet chon: keo tren vung trong cua timeline, chon moi clip / item cham vao khung
  function startMarquee(e) {
    if (e.button !== 0) return
    if (e.target.closest('.cc-clip, .cc-v2-clip, .cc-audio-item-clip, .cc-aclip, .cc-oclip, .cc-thead, .cc-ruler-row, .cc-tl-corner, .cc-playhead, .cc-newtrack, button, input')) return
    e.preventDefault() // khong boi den chu khi quet
    const startX = e.clientX, startY = e.clientY
    const additive = e.ctrlKey || e.metaKey || e.shiftKey
    let active = false
    const move = (ev) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
      if (!active) { active = true; dragRef.current = 'marquee' }
      setMarquee({ x1: startX, y1: startY, x2: ev.clientX, y2: ev.clientY })
    }
    const up = (ev) => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      if (active) {
        const left = Math.min(startX, ev.clientX), right = Math.max(startX, ev.clientX), top = Math.min(startY, ev.clientY), bottom = Math.max(startY, ev.clientY)
        const hits = []
        for (const el of scrollRef.current.querySelectorAll('.cc-clip, .cc-v2-clip, .cc-audio-item-clip')) {
          const r = el.getBoundingClientRect()
          if (!(r.right > left && r.left < right && r.bottom > top && r.top < bottom)) continue
          if (el.classList.contains('cc-clip')) hits.push({ kind: 'clip', id: el.dataset.clipId })
          else hits.push({ kind: el.classList.contains('cc-v2-clip') ? 'v2' : 'audio', id: el.dataset.itemId })
        }
        const base = additive ? selectedTargets() : []
        applySelection([...base, ...hits.filter((h) => !base.some((m) => sameTarget(m, h)))])
      }
      setMarquee(null)
      setTimeout(() => { dragRef.current = null }, 0)
    }
    attachDocumentMouseDrag(move, up)
  }
  // ---- Thao tac nhom (khi chon nhieu) ----
  function deleteTargets(targets) {
    const ids = (kind) => new Set(targets.filter((x) => x.kind === kind).map((x) => x.id))
    const clipIds = ids('clip'), v2Ids = ids('v2'), audioIds = ids('audio')
    const state = timelineStateRef.current
    const v2 = state.videoOverlays.filter((i) => v2Ids.has(i.id) && !trackLocked(i.trackId))
    const audio = state.audioItems.filter((i) => audioIds.has(i.id) && !trackLocked(i.trackId))
    const gone = trackLocked(MAIN_VIDEO_TRACK) ? [] : clipsRef.current.filter((c) => clipIds.has(c.id))
    if (!v2.length && !audio.length && !gone.length) { warnLocked(); return }
    pushHistory()
    if (gone.length) {
      const next = clipsRef.current.filter((c) => !clipIds.has(c.id))
      if (!next.length) { setKeepSegments(null); setAutoCut(false); setAutoInfo(null) }
      setClips(next)
      setCaptions((items) => remapAnchoredCaptions(next, items, transition))
    }
    editTimeline((st) => ({ ...st, videoOverlays: st.videoOverlays.filter((i) => !v2.some((r) => r.id === i.id)), audioItems: st.audioItems.filter((i) => !audio.some((r) => r.id === i.id)) }))
    setMultiSel([]); setSelId(null); setSelItem(null); setSelOv(null)
    if (v2.length + audio.length + gone.length < targets.length) warnLocked()
  }
  function copyTargets(targets) {
    const items = targets.map((x) => ({ kind: x.kind, data: findTarget(x) })).filter((x) => x.data).map((x) => ({ kind: x.kind, data: JSON.parse(JSON.stringify(x.data)) }))
    if (!items.length) return
    setClipboard({ kind: 'multi', items })
    setStatus(t('msg_copied'))
  }
  function pasteGroup(board) {
    const loose = board.items.filter((x) => x.kind !== 'clip')
    const mains = board.items.filter((x) => x.kind === 'clip')
    const pastedMains = mains.length && !trackLocked(MAIN_VIDEO_TRACK) ? mains : []
    if (!loose.length && !pastedMains.length) { warnLocked(); return }
    pushHistory()
    const selection = []
    if (pastedMains.length) {
      const copies = pastedMains.map((x) => ({ ...x.data, id: makeEntityId('clip'), audioDetached: false }))
      const next = [...clipsRef.current]
      next.splice(insertIndexForTime(layout, current), 0, ...copies)
      setClips(next)
      setCaptions((items) => remapAnchoredCaptions(next, items, transition))
      copies.forEach((c) => selection.push({ kind: 'clip', id: c.id }))
    }
    if (loose.length) {
      const anchor = Math.min(...loose.map((x) => Number(x.data.start) || 0))
      editTimeline((st) => {
        let result = st
        for (const x of loose) {
          const copy = { ...x.data, id: makeEntityId(x.kind === 'v2' ? 'video-overlay' : 'audio'), start: x.data.loop ? x.data.start : current + ((Number(x.data.start) || 0) - anchor), sourceClipId: undefined }
          result = placeItems(result, x.kind === 'v2' ? 'video' : 'audio', [copy], x.data.trackId)
          selection.push({ kind: x.kind, id: copy.id })
        }
        return result
      })
    }
    applySelection(selection)
  }
  function duplicateTargets(targets) {
    const loose = targets.map((x) => ({ target: x, found: findTarget(x) })).filter((x) => x.found && x.target.kind !== 'clip' && !trackLocked(x.found.trackId))
    const clipIds = trackLocked(MAIN_VIDEO_TRACK) ? [] : targets.filter((x) => x.kind === 'clip' && findTarget(x)).map((x) => x.id)
    if (!loose.length && !clipIds.length) { warnLocked(); return }
    pushHistory()
    const selection = []
    if (clipIds.length) {
      let working = clipsRef.current
      for (const id of clipIds) {
        const result = duplicateClipAfter(working, id, makeEntityId('clip'))
        if (result) { working = result.clips; selection.push({ kind: 'clip', id: result.copy.id }) }
      }
      setClips(working)
      setCaptions((items) => remapAnchoredCaptions(working, items, transition))
    }
    if (loose.length) {
      const spans = loose.map((x) => itemSpan(x.found, { totalDuration }))
      const offset = Math.max(...spans.map((x) => x.end)) - Math.min(...spans.map((x) => x.start)) // sau het nhom, giu khoang cach tuong doi
      editTimeline((st) => {
        let result = st
        for (const x of loose) {
          const copy = { ...x.found, id: makeEntityId(x.target.kind === 'v2' ? 'video-overlay' : 'audio'), start: x.found.loop ? x.found.start : x.found.start + offset, sourceClipId: undefined }
          result = placeItems(result, x.target.kind === 'v2' ? 'video' : 'audio', [copy], x.found.trackId)
          selection.push({ kind: x.target.kind, id: copy.id })
        }
        return result
      })
    }
    applySelection(selection)
  }
  function toggleMuteTargets(targets) {
    const audioIds = new Set(targets.filter((x) => x.kind === 'audio').map((x) => x.id))
    const clipIds = new Set(targets.filter((x) => x.kind === 'clip').map((x) => x.id))
    const audio = audioItems.filter((i) => audioIds.has(i.id) && !trackLocked(i.trackId))
    const withAudio = autoCut && clips.length === 1 ? [] : clips.filter((c) => clipIds.has(c.id) && !isImg(c) && c.src?.hasAudio && !c.audioDetached)
    if (!audio.length && !withAudio.length) return
    const mute = [...audio.map((i) => !i.muted), ...withAudio.map((c) => !c.audioMuted)].some(Boolean) // con muc dang bat tieng -> tat het; da tat het -> bat lai
    pushHistory()
    if (audio.length) setAudioItems((items) => items.map((i) => (audio.some((a) => a.id === i.id) ? { ...i, muted: mute } : i)))
    if (withAudio.length) setClips((items) => items.map((c) => (withAudio.some((a) => a.id === c.id) ? { ...c, audioMuted: mute } : c)))
  }
  // Keo nhom: cac item V2+ / audio dang chon cung doi thoi diem (giu duong cua tung item); va cham xu ly khi tha
  function startGroupDrag(item, e, group) {
    const members = group.map((x) => ({ target: x, found: findTarget(x) })).filter((x) => x.found)
    if (members.some((x) => trackLocked(x.found.trackId))) { e.stopPropagation(); warnLocked(); return }
    e.stopPropagation(); beginHistoryEdit(); dragRef.current = 'group'
    const startX = e.clientX
    const originals = new Map(members.map((x) => [`${x.target.kind}:${x.target.id}`, x.found.start]))
    const minStart = Math.min(...originals.values())
    const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
    const primarySpan = item.loop ? 0 : (item.out - item.in) / speed
    const kindOf = (list, kind) => list.filter((m) => m.target.kind === kind)
    const applyShift = (dt) => {
      setVideoOverlays((items) => items.map((i) => (originals.has(`v2:${i.id}`) ? { ...i, start: originals.get(`v2:${i.id}`) + dt } : i)))
      setAudioItems((items) => items.map((i) => (originals.has(`audio:${i.id}`) ? { ...i, start: originals.get(`audio:${i.id}`) + dt } : i)))
    }
    let dt = 0
    const move = (event) => {
      const wanted = snapTime(Math.max(0, item.start + (event.clientX - startX) / pps), primarySpan) - item.start
      dt = Math.max(-minStart, wanted)
      applyShift(dt)
    }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      const state = timelineStateRef.current
      let tracksNow = state.tracks
      const resolve = (kind, list) => {
        const ids = new Set(kindOf(members, kind).map((m) => m.target.id))
        const placed = list.filter((i) => !ids.has(i.id))
        const moved = new Map()
        for (const m of list.filter((i) => ids.has(i.id)).sort((a, b) => a.start - b.start)) {
          const placement = choosePlacement({ tracks: tracksNow, items: placed, kind: kind === 'v2' ? 'video' : 'audio', preferred: m.trackId, span: itemSpan(m, { totalDuration }), totalDuration,
            extraByTrack: kind === 'audio' ? { [MAIN_AUDIO_TRACK]: clipAudioSpans(layout).map(({ start, end }) => ({ start, end })) } : {} })
          if (placement.created) tracksNow = normalizeTracks([...tracksNow, placement.created])
          const next = { ...m, trackId: placement.trackId, ...(kind === 'v2' ? { zIndex: layerIndex(tracksNow, placement.trackId) } : {}) }
          placed.push(next); moved.set(m.id, next)
        }
        return list.map((i) => moved.get(i.id) || i)
      }
      const nextVideo = resolve('v2', state.videoOverlays), nextAudio = resolve('audio', state.audioItems)
      editTimeline(() => ({ tracks: tracksNow, videoOverlays: nextVideo, audioItems: nextAudio }))
      endHistoryEdit()
      setTimeout(() => { dragRef.current = null }, 0)
    }
    attachDocumentMouseDrag(move, up)
  }
  function openItemMenu(event, target) {
    event.preventDefault(); event.stopPropagation()
    selectTarget(target)
    setCtxMenu({ x: event.clientX, y: event.clientY, target })
  }
  const targetTrackId = (target) => (target.kind === 'clip' ? MAIN_VIDEO_TRACK : findTarget(target)?.trackId)
  function targetSpan(target) {
    if (target.kind === 'clip') { const seg = layout.find((entry) => entry.id === target.id); return seg ? { start: seg.start, end: seg.end } : null }
    const found = findTarget(target)
    return found ? itemSpan(found, { totalDuration }) : null
  }
  function playheadInside(target) {
    const span = targetSpan(target)
    return !!span && current > span.start + MIN_PIECE && current < span.end - MIN_PIECE
  }
  function copyTarget(target) {
    const found = findTarget(target)
    if (!found) return
    setClipboard({ kind: target.kind, data: JSON.parse(JSON.stringify(found)) })
    setStatus(t('msg_copied'))
  }
  function duplicateTarget(target) {
    const found = findTarget(target)
    if (!found) return
    if (trackLocked(targetTrackId(target))) { warnLocked(); return }
    if (target.kind === 'clip') {
      const result = duplicateClipAfter(clips, found.id, makeEntityId('clip'))
      if (!result) return
      pushHistory(); setClips(result.clips)
      setCaptions((items) => remapAnchoredCaptions(result.clips, items, transition))
      selectClip(result.copy.id)
      return
    }
    const span = itemSpan(found, { totalDuration })
    const copy = { ...found, id: makeEntityId(target.kind === 'v2' ? 'video-overlay' : 'audio'), start: found.loop ? found.start : span.end, sourceClipId: undefined }
    pushHistory()
    editTimeline((state) => placeItems(state, target.kind === 'v2' ? 'video' : 'audio', [copy], found.trackId))
    selectItem({ kind: target.kind, id: copy.id })
  }
  function pasteClipboard() {
    if (!clipboard) { setStatus(t('msg_nothing_to_paste')); return }
    const { kind, data } = clipboard
    if (kind === 'multi') { pasteGroup(clipboard); return }
    if (kind === 'clip') {
      if (trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); return }
      const copy = { ...data, id: makeEntityId('clip'), audioDetached: false }
      const nextClips = [...clipsRef.current]
      nextClips.splice(insertIndexForTime(layout, current), 0, copy)
      pushHistory(); setClips(nextClips)
      setCaptions((items) => remapAnchoredCaptions(nextClips, items, transition))
      selectClip(copy.id)
      return
    }
    const copy = { ...data, id: makeEntityId(kind === 'v2' ? 'video-overlay' : 'audio'), start: current, sourceClipId: undefined }
    pushHistory()
    editTimeline((state) => placeItems(state, kind === 'v2' ? 'video' : 'audio', [copy], data.trackId))
    selectItem({ kind, id: copy.id })
  }
  function splitTarget(target) {
    const found = findTarget(target)
    if (!found) return
    if (trackLocked(targetTrackId(target))) { warnLocked(); return }
    if (target.kind === 'clip') {
      if (!playheadInside(target)) { setStatus(t('msg_split_outside')); return }
      splitAtPlayhead()
      return
    }
    const pieces = splitTimelineItem(found, current, makeEntityId(target.kind === 'v2' ? 'video-overlay' : 'audio'))
    if (!pieces) { setStatus(t('msg_split_outside')); return }
    pushHistory()
    const apply = (items) => items.flatMap((candidate) => (candidate.id === found.id ? pieces : [candidate]))
    if (target.kind === 'v2') setVideoOverlays(apply); else setAudioItems(apply)
    selectItem({ kind: target.kind, id: pieces[1].id })
  }
  async function freezeFrame(target) {
    const clip = findTarget(target)
    if (!clip || target.kind !== 'clip' || isImg(clip) || clip.missing) return
    if (trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); return }
    const preview = resolvePreviewSource(timelinePlan, current)
    const seg = preview && layout[preview.entryIndex]
    if (!seg || seg.id !== clip.id) { setStatus(t('msg_split_outside')); return }
    const sourceTime = preview.sourceTime
    const scope = resourceScopeRef.current, revision = editRevisionRef.current
    try {
      setStatus(t('msg_freeze_working'))
      const png = await window.taoclip.freezeFrame(clip.path, sourceTime)
      const media = await window.taoclip.inspectMedia(png)
      if (scope !== resourceScopeRef.current || revision !== editRevisionRef.current) { notify(t('msg_freeze_stale'), 'err'); return }
      const freeze = { ...makeClipFromMedia(png, `Freeze · ${clip.name}`, media), out: FREEZE_SECONDS, kenBurns: false, cropMode: clip.cropMode, cropX: clip.cropX, cropY: clip.cropY }
      const result = insertFreezeFrame(clipsRef.current, clip.id, sourceTime, freeze, makeEntityId('clip'))
      if (!result) { setStatus(t('msg_split_outside')); return }
      pushHistory(); setClips(result.clips)
      setCaptions((items) => remapAnchoredCaptions(result.clips, splitAnchoredCaptions(items, clip.id, sourceTime, result.rightId), transition))
      addLibraryAssets([makeLibraryAsset(png, 'image', media)])
      selectClip(freeze.id)
      setStatus(t('msg_freeze_done'))
    } catch (error) { notify(t('st_err', { e: error.message || error }), 'err') }
  }
  function toggleEnhance(target) {
    const clip = findTarget(target)
    if (!clip || target.kind !== 'clip' || clip.missing) return
    pushHistory(); updateClip(clip.id, { enhance: !clip.enhance })
    setStatus(t(clip.enhance ? 'msg_enhance_off' : 'msg_enhance_on'))
  }
  async function saveAudioTarget(target) {
    const found = findTarget(target)
    if (!found || found.missing) return
    const hasAudio = target.kind === 'clip' ? !isImg(found) && !!found.src?.hasAudio : target.kind === 'v2' ? found.kind !== 'image' : true
    if (!hasAudio) { notify(t('msg_no_audio_to_save'), 'err'); return }
    const request = { input: found.path, start: found.in, end: found.out, speed: found.speed || 1, defaultName: `${String(found.name || 'audio').replace(/\.[^.]+$/, '')}.wav` }
    try {
      const saved = await window.taoclip.saveAudioAs(request)
      if (saved) notify(t('msg_audio_saved', { p: saved.split(/[\\/]/).pop() }), 'ok', { label: t('open_folder'), run: () => window.taoclip.showInFolder(saved) })
    } catch (error) { notify(/NO_AUDIO/.test(String(error.message)) ? t('msg_no_audio_to_save') : t('st_err', { e: error.message || error }), 'err') }
  }
  async function captionsForClip(target) {
    const clip = findTarget(target)
    if (!clip || target.kind !== 'clip' || isImg(clip) || !clip.src?.hasAudio || clip.missing || capBusy) return
    setTab('text')
    const expectedRevision = editRevisionRef.current
    setCapBusy(true); setCapStatus(t('cap_extracting'))
    try {
      const segs = await transcribeClips(setCapStatus)
      if (editRevisionRef.current !== expectedRevision) throw new Error('AI_RESULT_STALE')
      const mine = segs.filter((caption) => caption.clipId === clip.id).map((caption) => ({ ...caption, id: caption.id || makeEntityId('caption') }))
      pushHistory()
      setCaptions((items) => mergeClipCaptions(items, mine, clip.id)); setCaptionTimebase('timeline')
      setCapStatus(t('cap_count', { n: mine.length }))
    } catch (e) { setCapStatus(e.message === 'AI_RESULT_STALE' ? t('ai_result_stale') : t('st_err', { e })) } finally { setCapBusy(false) }
  }
  function toggleMuteTarget(target) {
    const found = findTarget(target)
    if (!found) return
    if (target.kind === 'audio') { pushHistory(); updateAudioItem(found.id, { muted: !found.muted }); return }
    if (target.kind !== 'clip' || isImg(found) || !found.src?.hasAudio || found.audioDetached) return
    if (!found.audioMuted && autoCut && clips.length === 1) { setStatus(t('msg_mute_blocked_autocut')); return }
    pushHistory(); updateClip(found.id, { audioMuted: !found.audioMuted })
  }
  function toggleLockTarget(target) {
    const trackId = targetTrackId(target)
    if (trackId) patchTrack(trackId, { locked: !trackLocked(trackId) })
  }
  function deleteTarget(target) {
    if (target.kind === 'clip') deleteClip(target.id)
    else if (target.kind === 'v2') removeVideoOverlay(target.id)
    else removeAudioItem(target.id)
  }
  function buildContextItems(target) {
    const found = findTarget(target)
    if (!found) return []
    if (inMulti(target)) {
      const group = multi
      const entryG = (id, labelKey, icon, run, extra = {}) => ({ id, label: t(labelKey), icon, run, ...extra })
      return [
        entryG('copy', 'ctx_copy', <Copy size={14} />, () => copyTargets(group), { shortcut: 'Ctrl+C' }),
        entryG('duplicate', 'ctx_duplicate', <CopyPlus size={14} />, () => duplicateTargets(group), { shortcut: 'Ctrl+D' }),
        entryG('paste', 'ctx_paste', <ClipboardPaste size={14} />, pasteClipboard, { shortcut: 'Ctrl+V', disabled: !clipboard }),
        { separator: true },
        entryG('mute', 'ctx_mute', <VolumeX size={14} />, () => toggleMuteTargets(group), { shortcut: 'M' }),
        { separator: true },
        entryG('delete', 'ctx_delete', <Trash2 size={14} />, () => deleteTargets(group), { shortcut: 'Del', danger: true })
      ]
    }
    const clip = target.kind === 'clip' ? found : null
    const video = !!clip && !isImg(clip)
    const hasOwnAudio = video && !!clip.src?.hasAudio && !clip.missing
    const locked = trackLocked(targetTrackId(target))
    const inside = playheadInside(target)
    const loopItem = target.kind === 'audio' && !!found.loop
    const canSaveAudio = target.kind === 'clip' ? hasOwnAudio : target.kind === 'v2' ? found.kind !== 'image' && !found.missing : !found.missing
    const muted = target.kind === 'audio' ? !!found.muted : !!clip?.audioMuted
    const muteDisabled = target.kind === 'audio' ? false : !(hasOwnAudio && !clip.audioDetached)
    const entry = (id, labelKey, icon, run, extra = {}) => ({ id, label: t(labelKey), icon, run, ...extra })
    return [
      entry('copy', 'ctx_copy', <Copy size={14} />, () => copyTarget(target), { shortcut: 'Ctrl+C' }),
      entry('duplicate', 'ctx_duplicate', <CopyPlus size={14} />, () => duplicateTarget(target), { shortcut: 'Ctrl+D', disabled: locked }),
      entry('paste', 'ctx_paste', <ClipboardPaste size={14} />, pasteClipboard, { shortcut: 'Ctrl+V', disabled: !clipboard }),
      { separator: true },
      entry('split', 'ctx_split', <Scissors size={14} />, () => splitTarget(target), { shortcut: 'Ctrl+B', disabled: locked || !inside || loopItem }),
      entry('freeze', 'ctx_freeze', <Frame size={14} />, () => freezeFrame(target), { shortcut: 'F', disabled: locked || !video || !inside || !!clip?.missing }),
      entry('enhance', 'ctx_enhance', <Sparkles size={14} />, () => toggleEnhance(target), { disabled: !clip || !!clip.missing, checked: !!clip?.enhance }),
      { separator: true },
      clip?.audioDetached
        ? entry('reattach', 'ctx_reattach', <AudioLines size={14} />, () => reattachAudio(clip.id), { disabled: locked })
        : entry('detach', 'ctx_detach', <AudioLines size={14} />, () => detachAudio(clip.id), { disabled: !hasOwnAudio || locked }),
      { separator: true },
      entry('save-audio', 'ctx_save_audio', <AudioWaveform size={14} />, () => saveAudioTarget(target), { disabled: !canSaveAudio }),
      entry('captions', 'ctx_captions', <Captions size={14} />, () => captionsForClip(target), { disabled: !hasOwnAudio || capBusy }),
      { separator: true },
      entry('mute', muted ? 'ctx_unmute' : 'ctx_mute', <VolumeX size={14} />, () => toggleMuteTarget(target), { shortcut: 'M', disabled: muteDisabled }),
      entry('lock', locked ? 'ctx_unlock' : 'ctx_lock', locked ? <Unlock size={14} /> : <Lock size={14} />, () => toggleLockTarget(target)),
      { separator: true },
      entry('delete', 'ctx_delete', <Trash2 size={14} />, () => deleteTarget(target), { shortcut: 'Del', danger: true, disabled: locked }),
      ...(target.kind === 'clip' ? [entry('ripple', 'ctx_ripple', <Trash2 size={14} />, () => rippleDeleteClip(target.id), { shortcut: 'Shift+Del', danger: true, disabled: locked })] : [])
    ]
  }
  function selectClip(id) { setSelId(id); setSelOv(null); setSelItem(null) }
  function selectItem(sel) { setSelItem(sel); setSelOv(null) }
  function deleteSelectedItem() {
    if (!selItem) return
    if (selItem.kind === 'v2') removeVideoOverlay(selItem.id)
    else removeAudioItem(selItem.id)
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
        appendAudioItems([makeAudioItem({ path: asset.path, name: asset.name, role: 'music', start: current, duration: media.duration })])
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
      audioItems.filter((item) => normalizeMediaPath(item.path) === key).length
    if (uses && !window.confirm(t('media_remove_confirm', { name: asset.name, uses }))) return
    pushHistory()
    setLibraryAssets((items) => items.filter((item) => item.id !== asset.id))
    notify(t('media_asset_removed'))
  }
  function libraryAssetUsage(asset) {
    const key = normalizeMediaPath(asset.path)
    return clips.filter((item) => normalizeMediaPath(item.path) === key).length +
      videoOverlays.filter((item) => normalizeMediaPath(item.path) === key).length +
      audioItems.filter((item) => normalizeMediaPath(item.path) === key).length
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
    if (trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); return }
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
    if (e.button !== 0) return
    if (e.ctrlKey || e.metaKey || e.shiftKey) { e.stopPropagation(); return }
    e.stopPropagation(); setSelId(seg.id); setSelOv(null); setSelItem(null)
    if (trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); return }
    const fromIdx = clips.findIndex((c) => c.id === seg.id)
    const startX = e.clientX, startY = e.clientY; let moved = false
    const span = seg.end - seg.start
    const overlayRows = [...scrollRef.current.querySelectorAll('.cc-trow.video[data-track-id]')]
      .filter((row) => row.dataset.trackId !== 'TEXT' && row.dataset.trackId !== MAIN_VIDEO_TRACK)
      .map((row) => ({ id: row.dataset.trackId, rect: row.getBoundingClientRect() }))
    let cross = null // { trackId, start }: keo len mot duong phu -> tha xuong se thanh lop phu
    dragRef.current = 'reorder'
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return
      moved = true
      const hit = overlayRows.find((row) => ev.clientY >= row.rect.top && ev.clientY < row.rect.bottom)
      if (hit) {
        const start = snapTime(Math.max(0, seg.start + (ev.clientX - startX) / pps), span)
        cross = { trackId: hit.id, start }
        setDragInsert(null); setLaneDrag({ trackId: hit.id, time: start })
        return
      }
      cross = null; setLaneDrag(null)
      const gt = clientXToTime(ev.clientX)
      setDragInsert(layout.filter((s) => gt > (s.start + s.end) / 2).length)
    }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      setLaneDrag(null)
      if (moved && cross) {
        setDragInsert(null)
        promoteClipToOverlay(seg.id, cross.trackId, cross.start)
      } else {
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
      }
      setTimeout(() => { dragRef.current = null }, 0)
    }
    attachDocumentMouseDrag(move, up)
  }

  // Clip V1 -> lop phu tren duong V2+: clip roi V1 (cac clip sau don lai), tieng cua no thanh doan tieng cung thoi diem
  function promoteClipToOverlay(clipId, laneId, start) {
    const clip = clipsRef.current.find((candidate) => candidate.id === clipId)
    if (!clip || clip.missing) return false
    if (trackLocked(MAIN_VIDEO_TRACK) || trackLocked(laneId)) { warnLocked(); return false }
    if (clipsRef.current.length <= 1) { notify(t('tl_promote_last'), 'err'); return false }
    pushHistory()
    const image = isImg(clip)
    const overlay = {
      id: makeEntityId('video-overlay'), path: clip.path, name: clip.name, kind: image ? 'image' : 'video',
      start, in: image ? 0 : clip.in, out: clip.out, speed: image ? 1 : (clip.speed || 1),
      x: 0.25, y: 0.25, width: 0.5, height: 0.5, opacity: 1, animated: !!clip.animated, sourceDuration: clip.src?.duration || clip.out, missing: false
    }
    const carryAudio = !image && !!clip.src?.hasAudio && !clip.audioDetached && !clip.audioMuted
    const audio = carryAudio ? { ...buildDetachedAudioItem(clip, { start }, makeEntityId('audio')), sourceClipId: undefined } : null
    const next = clipsRef.current.filter((candidate) => candidate.id !== clipId)
    setClips(next)
    setCaptions((items) => remapAnchoredCaptions(next, items, transition))
    editTimeline((state) => {
      let result = placeItems(state, 'video', [overlay], laneId)
      if (audio) result = placeItems(result, 'audio', [audio], MAIN_AUDIO_TRACK, false, [clipId])
      return { ...result, audioItems: result.audioItems.map((item) => (item.sourceClipId === clipId ? { ...item, sourceClipId: undefined } : item)) }
    })
    setSelId(null); setSelOv(null); setSelItem({ kind: 'v2', id: overlay.id })
    return true
  }
  // Item V2+ -> clip V1 tai thoi diem tha (chen giua cac clip)
  async function demoteOverlayToMain(item, time) {
    if (trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); return false }
    const scope = resourceScopeRef.current
    const key = normalizeMediaPath(item.path)
    let media = libraryAssetsRef.current.find((asset) => normalizeMediaPath(asset.path) === key)?.metadata
    if (!media || !(media.duration > 0 || media.width > 0)) {
      try { media = await window.taoclip.inspectMedia(item.path) }
      catch (error) { notify(t('st_err', { e: error.message || error }), 'err'); return false }
    }
    if (resourceScopeRef.current !== scope) return false
    const image = item.kind === 'image'
    const base = makeClipFromMedia(item.path, item.name, { ...media, kind: item.kind })
    const clip = { ...base, in: image ? 0 : item.in, out: item.out, speed: image ? 1 : (item.speed || 1), animated: !!item.animated || !!base.animated }
    const nextClips = [...clipsRef.current]
    nextClips.splice(insertIndexForTime(layout, time), 0, clip)
    setClips(nextClips)
    setCaptions((items) => remapAnchoredCaptions(nextClips, items, transition))
    editTimeline((state) => ({ ...state, videoOverlays: state.videoOverlays.filter((candidate) => candidate.id !== item.id) }))
    setSelId(clip.id); setSelItem(null)
    if (!image) { loadThumbnails(clip.id, clip.path); loadWave(clip.id, clip.path, !!clip.src?.hasAudio) }
    return true
  }
  // Khoi tieng goc A1: keo sang duong tieng khac (hoac doi thoi diem) thi tach khoi clip va dat tai cho tha
  function startClipAudioDrag(seg, e) {
    if (e.button !== 0 || !seg.clip) return
    const startX = e.clientX, startY = e.clientY
    const span = seg.end - seg.start
    const lanes = [...scrollRef.current.querySelectorAll('.cc-trow.audio[data-track-id]')].map((row) => ({ id: row.dataset.trackId, rect: row.getBoundingClientRect() }))
    let moved = false, lane = MAIN_AUDIO_TRACK, start = seg.start
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
      moved = true; dragRef.current = 'clip-audio'
      start = snapTime(Math.max(0, seg.start + (ev.clientX - startX) / pps), span)
      const hit = lanes.find((row) => ev.clientY >= row.rect.top && ev.clientY < row.rect.bottom)
      if (hit) lane = hit.id
      setLaneDrag({ trackId: lane, time: start })
    }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      setLaneDrag(null)
      if (moved && !(lane === MAIN_AUDIO_TRACK && Math.abs(start - seg.start) < 0.05)) {
        if (trackLocked(lane)) warnLocked()
        else detachAudio(seg.id, { trackId: lane, start })
      }
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
  function onDragLeave(e) {
    e.preventDefault()
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }
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
    v.playbackRate = activeClip.speed || 1; v.volume = volume * effOrigVolume * mainPreviewOpacity; v.muted = muted || clipSilent
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
    if (trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); return }
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
  function clientXToTime(clientX) { return geometryClientXToTime(clientX, scrollRef.current, pps) }
  function timelineClick(e) {
    if (dragRef.current) return
    setSelItem(null); setMultiSel([])
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
    if (trackLocked(MAIN_VIDEO_TRACK)) { e.stopPropagation(); warnLocked(); return }
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
  // Thu phong theo nhan, giu yen thoi diem o anchorClientX (mac dinh: giua vung nhin) de khong bi tru ve dau timeline
  function zoomBy(factor, anchorClientX = null) {
    const el = scrollRef.current
    const target = clampPps(ppsRef.current * factor)
    if (target === ppsRef.current) return
    if (el && !zoomAnchorRef.current) {
      const rect = el.getBoundingClientRect()
      const x = Math.max(HEAD_W, anchorClientX == null ? HEAD_W + (rect.width - HEAD_W) / 2 : anchorClientX - rect.left)
      zoomAnchorRef.current = { time: (el.scrollLeft + x - HEAD_W) / ppsRef.current, x }
    }
    ppsRef.current = target
    setPps(target)
  }
  const zoomByRef = useRef(zoomBy)
  zoomByRef.current = zoomBy
  // Vua khung: ca timeline nam trong man hinh (video 1 gio van xem het duoc), cuon ve dau
  function fitZoom() {
    const el = scrollRef.current
    if (!totalDuration || !el) return
    const target = fitPps(totalDuration, el.clientWidth)
    zoomAnchorRef.current = null
    if (target === ppsRef.current) { el.scrollLeft = 0; return }
    zoomAnchorRef.current = { time: 0, x: HEAD_W }
    ppsRef.current = target
    setPps(target)
  }

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


  // ---- Moc (marker) tren thuoc thoi gian ----
  function addMarkerAtPlayhead() {
    const time = Math.max(0, Math.round(current * 30) / 30)
    if (markers.some((marker) => Math.abs(marker.time - time) < FRAME / 2)) { setStatus(t('marker_exists')); return }
    pushHistory()
    setMarkers((items) => [...items, { id: makeEntityId('marker'), time, name: '' }].sort((a, b) => a.time - b.time))
    setStatus(t('marker_added', { time: fmt(time) }))
  }
  function removeMarker(id) { pushHistory(); setMarkers((items) => items.filter((marker) => marker.id !== id)) }
  function renameMarker(id, name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    const found = markers.find((marker) => marker.id === id)
    if (!found || found.name === clean) return
    pushHistory(); setMarkers((items) => items.map((marker) => (marker.id === id ? { ...marker, name: clean } : marker)))
  }
  function jumpMarker(direction) {
    const eps = FRAME / 2
    const target = direction > 0 ? markers.find((marker) => marker.time > current + eps) : [...markers].reverse().find((marker) => marker.time < current - eps)
    if (target) seekGlobal(target.time)
  }
  function openMarkerMenu(event, id) {
    event.preventDefault(); event.stopPropagation()
    setCtxMenu({ x: event.clientX, y: event.clientY, target: { kind: 'marker', id } })
  }
  function buildMarkerMenuItems(id) {
    if (!markers.some((marker) => marker.id === id)) return []
    return [
      { id: 'marker-rename', label: t('marker_rename'), icon: <Pencil size={14} />, run: () => setRenamingMarkerId(id) },
      { separator: true },
      { id: 'marker-delete', label: t('marker_delete'), icon: <Trash2 size={14} />, danger: true, run: () => removeMarker(id) }
    ]
  }
  // ---- Xoa dan: bo clip V1 va keo cac lop (hinh phu, tieng, chu) phia sau lui theo; muc nam tron trong doan bi xoa cung ----
  function rippleDeleteClip(id) {
    const seg = layout.find((entry) => entry.id === id)
    if (!seg) return
    if (trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); return }
    const from = seg.start, to = seg.end
    pushHistory()
    const next = clipsRef.current.filter((candidate) => candidate.id !== id)
    if (!next.length) { setKeepSegments(null); setAutoCut(false); setAutoInfo(null) }
    setClips(next)
    setCaptions((items) => remapAnchoredCaptions(next, items, transition))
    setOverlays((items) => rippleOverlays(items, from, to))
    setMarkers((items) => items.map((marker) => ({ ...marker, time: marker.time < from ? marker.time : marker.time < to ? from : marker.time - (to - from) })))
    editTimeline((state) => {
      const locked = new Set(state.tracks.filter((track) => track.locked).map((track) => track.id))
      const skip = (item) => locked.has(item.trackId)
      const endOf = (item) => itemSpan(item, { totalDuration }).end
      return { ...state, videoOverlays: rippleItems(state.videoOverlays, from, to, endOf, skip).items, audioItems: rippleItems(state.audioItems, from, to, endOf, skip).items }
    })
    setSelId(null); setSelItem(null); setMultiSel([])
  }

  // ---- Keo khoi CHU/STICKER tren timeline: di chuyen / keo mep doi thoi luong ----
  // ---- Keo item phu (V2+) / audio: doi thoi diem (ngang) va doi track (doc); va cham duoc xu ly luc tha ----
  function startItemDrag(kind, item, e) {
    if (e.button !== 0 || e.target.closest('button')) return // chuot phai chi mo menu, khong bat dau keo
    if (e.ctrlKey || e.metaKey || e.shiftKey) { e.stopPropagation(); return } // chi chon them / bo chon (xu ly o click), khong keo va khong doi muc chinh
    if (!(e.ctrlKey || e.metaKey || e.shiftKey) && multi.length > 1 && multi.some((m) => m.kind === kind && m.id === item.id)) {
      const group = multi.filter((m) => m.kind !== 'clip')
      if (group.length > 1) { startGroupDrag(item, e, group); return }
    }
    if (trackLocked(item.trackId)) { e.stopPropagation(); warnLocked(); return }
    e.stopPropagation(); beginHistoryEdit(); dragRef.current = `${kind}:${item.id}`
    selectItem({ kind, id: item.id })
    const startX = e.clientX, original = item.start
    const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
    const span = item.loop ? 0 : (item.out - item.in) / speed
    const lanes = [...scrollRef.current.querySelectorAll(kind === 'v2' ? '.cc-trow.video[data-track-id]' : '.cc-trow.audio[data-track-id]')]
      .filter((row) => row.dataset.trackId !== 'TEXT' && row.dataset.trackId !== MAIN_VIDEO_TRACK)
      .map((row) => ({ id: row.dataset.trackId, rect: row.getBoundingClientRect() }))
    const mainRect = kind === 'v2' && !item.sticker && item.path ? scrollRef.current.querySelector(`.cc-trow[data-track-id="${MAIN_VIDEO_TRACK}"]`)?.getBoundingClientRect() : null
    let target = { trackId: item.trackId, start: original }
    const apply = (patch) => (kind === 'v2'
      ? setVideoOverlays((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, ...patch } : candidate))
      : setAudioItems((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, ...patch } : candidate)))
    const move = (event) => {
      const start = snapTime(Math.max(0, original + (event.clientX - startX) / pps), span)
      const hit = lanes.find((lane) => event.clientY >= lane.rect.top && event.clientY < lane.rect.bottom)
      const overMain = !!mainRect && event.clientY >= mainRect.top && event.clientY < mainRect.bottom
      const trackId = overMain ? item.trackId : (hit && !trackLocked(hit.id) ? hit.id : target.trackId)
      target = { trackId, start, toMain: overMain }
      setLaneDrag(overMain ? { trackId: MAIN_VIDEO_TRACK, time: start } : null)
      apply({ start, trackId, ...(kind === 'v2' ? { zIndex: layerIndex(timelineStateRef.current.tracks, trackId) } : {}) })
    }
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      setLaneDrag(null)
      if (target.toMain) {
        // Tha len V1: chuyen thanh clip V1 (bat dong bo vi co the phai doc thong tin media); chi chot lich su khi xong
        demoteOverlayToMain(item, target.start).finally(() => endHistoryEdit())
        setTimeout(() => { dragRef.current = null }, 0)
        return
      }
      const state = timelineStateRef.current
      const others = (kind === 'v2' ? state.videoOverlays : state.audioItems).filter((candidate) => candidate.id !== item.id)
      const placement = choosePlacement({ tracks: state.tracks, items: others, kind: kind === 'v2' ? 'video' : 'audio', preferred: target.trackId,
        span: itemSpan({ ...item, start: target.start }, { totalDuration }), totalDuration,
        extraByTrack: kind === 'audio' ? { [MAIN_AUDIO_TRACK]: clipAudioSpans(layout).map(({ start, end }) => ({ start, end })) } : {} })
      if (placement.trackId !== target.trackId || placement.created) {
        editTimeline((current) => {
          const nextTracks = placement.created ? normalizeTracks([...current.tracks, placement.created]) : current.tracks
          const patch = { start: target.start, trackId: placement.trackId, ...(kind === 'v2' ? { zIndex: layerIndex(nextTracks, placement.trackId) } : {}) }
          const mapItems = (items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, ...patch } : candidate)
          return { tracks: nextTracks, videoOverlays: kind === 'v2' ? mapItems(current.videoOverlays) : current.videoOverlays,
            audioItems: kind === 'audio' ? mapItems(current.audioItems) : current.audioItems }
        })
      }
      endHistoryEdit()
      setTimeout(() => { dragRef.current = null }, 0)
    }
    attachDocumentMouseDrag(move, up)
  }
  function startV2Move(item, e) { startItemDrag('v2', item, e) }
  function startAudioItemDrag(item, e) { startItemDrag('audio', item, e) }

  // ---- Tha file (tu he dieu hanh) hoac asset thu vien vao mot lane cu the, dung thoi diem tha ----
  async function handleLaneDrop(event, lane) {
    setDragOver(false)
    const time = Math.max(0, clientXToTime(event.clientX))
    let sources = []
    const rawAsset = event.dataTransfer.getData(ASSET_DRAG_TYPE)
    if (rawAsset) { try { const asset = JSON.parse(rawAsset); sources = [{ path: asset.path, name: asset.name }] } catch { sources = [] } }
    else sources = [...event.dataTransfer.files].map((file) => window.taoclip.getDroppedPath(file)).filter(Boolean).map((p) => ({ path: p, name: p.split(/[\\/]/).pop() }))
    if (!sources.length) { setStatus(t('st_not_media', { f: '' })); return }
    await placeDroppedMedia(sources, lane, time)
  }
  async function placeDroppedMedia(sources, lane, time) {
    const scope = resourceScopeRef.current
    const found = [], failures = []
    for (const source of sources) {
      try { found.push({ ...source, media: await window.taoclip.inspectMedia(source.path) }) }
      catch (error) { failures.push(`${source.name}: ${String(error.message || error).slice(0, 160)}`) }
    }
    if (resourceScopeRef.current !== scope) { notify(t('msg_pick_media_project_changed'), 'err'); return }
    const audioFiles = [], overlayFiles = [], mainFiles = []
    for (const item of found) {
      const kind = item.media.kind
      if (lane.kind === 'audio') {
        if (kind === 'audio') audioFiles.push({ ...item, role: 'music' })
        else if (kind === 'video' && item.media.hasAudio) audioFiles.push({ ...item, role: 'original' })
        else failures.push(t('msg_drop_no_audio', { f: item.name }))
      } else if (kind === 'audio') audioFiles.push({ ...item, role: 'music' })
      else if (lane.forceNew || lane.trackId !== MAIN_VIDEO_TRACK) overlayFiles.push(item)
      else mainFiles.push(item)
    }
    if (mainFiles.length && trackLocked(MAIN_VIDEO_TRACK)) { warnLocked(); mainFiles.length = 0 }
    if (failures.length) notify(failures.slice(0, 3).join('\n'), 'err')
    const total = audioFiles.length + overlayFiles.length + mainFiles.length
    if (!total) return
    pushHistory()
    addLibraryAssets(found.map((item) => makeLibraryAsset(item.path, item.media.kind, item.media)))
    if (mainFiles.length) {
      const built = mainFiles.map((item) => makeClipFromMedia(item.path, item.name, item.media))
      const nextClips = [...clipsRef.current]
      nextClips.splice(insertIndexForTime(layout, time), 0, ...built)
      setClips(nextClips)
      setCaptions((items) => remapAnchoredCaptions(nextClips, items, transition))
      setSelId(built[0].id); setSelItem(null)
      built.filter((clip) => !isImg(clip)).forEach((clip) => { loadThumbnails(clip.id, clip.path); loadWave(clip.id, clip.path, clip.src.hasAudio) })
    }
    if (overlayFiles.length) {
      let cursor = time
      const items = overlayFiles.map((item) => {
        const image = item.media.kind === 'image'
        const length = image ? slideDur : item.media.duration
        const overlay = { id: makeEntityId('video-overlay'), path: item.path, name: item.name, kind: image ? 'image' : 'video', start: cursor, in: 0, out: length,
          speed: 1, x: 0.25, y: 0.25, width: 0.5, height: 0.5, opacity: 1, animated: item.media.formatName === 'gif', sourceDuration: length, missing: false }
        cursor += length
        return overlay
      })
      editTimeline((state) => placeItems(state, 'video', items, lane.trackId, !!lane.forceNew))
    }
    if (audioFiles.length) {
      let cursor = time
      const items = audioFiles.map((item) => {
        const audio = makeAudioItem({ path: item.path, name: item.role === 'original' ? `${item.name} ♪` : item.name, role: item.role, start: cursor, duration: item.media.duration, loop: false })
        cursor += item.media.duration
        return audio
      })
      editTimeline((state) => placeItems(state, 'audio', items, lane.kind === 'audio' ? lane.trackId : null, lane.kind === 'audio' && !!lane.forceNew))
    }
    setStatus(t('msg_dropped', { n: total }))
  }

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
  // Cat mep bang chuot: mep phai doi do dai, mep trai doi diem bat dau + diem vao nguon (anh / sticker: do dai tu do)
  function startItemTrim(kind, item, edge, e) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    if (trackLocked(item.trackId)) { warnLocked(); return }
    beginHistoryEdit(); dragRef.current = 'trim'
    selectItem({ kind, id: item.id })
    const speed = Number(item.speed) > 0 ? Number(item.speed) : 1
    const still = item.kind === 'image' || !!item.sticker // khong co doan nguon: do dai chinh la out
    const base = { start: item.start, in: still ? 0 : (item.in || 0), out: item.out }
    const minLen = FRAME * 3
    const sourceMax = still ? Infinity : Math.max(base.out, Number(item.sourceDuration) || Infinity)
    const startX = e.clientX
    const apply = (patch) => (kind === 'v2'
      ? setVideoOverlays((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, ...patch } : candidate))
      : setAudioItems((items) => items.map((candidate) => candidate.id === item.id ? { ...candidate, ...patch } : candidate)))
    const move = (event) => {
      let dt = (event.clientX - startX) / pps
      if (edge === 'r') {
        const baseEnd = base.start + (base.out - base.in) / speed
        dt = clamp(snapTime(baseEnd + dt) - baseEnd, -((base.out - base.in) / speed - minLen), (sourceMax - base.out) / speed)
        apply({ out: base.out + dt * speed })
      } else {
        const lowest = still ? -base.start : Math.max(-base.start, -base.in / speed)
        dt = clamp(snapTime(base.start + dt) - base.start, lowest, (base.out - base.in) / speed - minLen)
        apply(still ? { start: base.start + dt, out: base.out - dt } : { start: base.start + dt, in: base.in + dt * speed })
      }
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
  const serializedProject = projectKey(buildProject())
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
      else if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.key === 'Delete' && selectedTarget?.kind === 'clip') rippleDeleteClip(selectedTarget.id)
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (multi.length > 1) deleteTargets(multi); else if (selItem) deleteSelectedItem(); else if (selOv) delOverlay(selOv); else if (selId) deleteClip(selId) }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) { if (multi.length > 1) { e.preventDefault(); copyTargets(multi) } else if (selectedTarget) { e.preventDefault(); copyTarget(selectedTarget) } }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteClipboard() }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); if (multi.length > 1) duplicateTargets(multi); else if (selectedTarget) duplicateTarget(selectedTarget) }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); if (selectedTarget) splitTarget(selectedTarget) }
      else if (!e.ctrlKey && !e.metaKey && (e.key === 'f' || e.key === 'F')) { if (selectedTarget) freezeFrame(selectedTarget) }
      else if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'M' || e.key === 'm')) addMarkerAtPlayhead()
      else if (!e.ctrlKey && !e.metaKey && e.key === '[') jumpMarker(-1)
      else if (!e.ctrlKey && !e.metaKey && e.key === ']') jumpMarker(1)
      else if (!e.ctrlKey && !e.metaKey && (e.key === 'm' || e.key === 'M')) { if (multi.length > 1) toggleMuteTargets(multi); else if (selectedTarget) toggleMuteTarget(selectedTarget) }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAllTargets() }
      else if (e.key === '?') setShowKeys((s) => !s)
      else if (e.key === 'Escape') { setShowKeys(false); setMultiSel([]); if (!exporting) setShowExport(false) }
      else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM_STEP)
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, totalDuration, clips, activeIdx, seekGlobal, togglePlay, selId, selOv, overlays, captions, audioItems, videoOverlays, tracks, selItem, multiSel, markers, clipboard, layout, exporting, projectPath, projectDirty, saveProject, saveProjectAs])

  // ---- Ctrl + lan chuot tren timeline = thu phong ----
  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomByRef.current(Math.exp(-clamp(e.deltaY, -240, 240) * 0.0015), e.clientX)
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
        audioItems: audioItems.filter((item) => item.track === 'voice').map(({ path, start, in: sourceIn, out, gain, fadeIn, fadeOut }) => ({ path, start, in: sourceIn, out, gain, fadeIn, fadeOut })) }
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
    if (clips[0]?.audioDetached || clips[0]?.audioMuted) { setStatus(t('msg_autocut_blocked_detached')); return }
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
  async function importMusic() {
    const scope = resourceScopeRef.current
    const p = await window.taoclip.openAudio()
    if (scope !== resourceScopeRef.current) { if (p) notify(t('msg_music_project_changed'), 'err'); return }
    if (!p) return
    try {
      const media = await window.taoclip.inspectMedia(p)
      if (media.kind !== 'audio') throw new Error(t('msg_audio_invalid'))
      if (scope !== resourceScopeRef.current) { notify(t('msg_music_project_changed'), 'err'); return }
      pushHistory()
      addLibraryAssets([makeLibraryAsset(p, 'audio', media)])
      appendAudioItems([makeAudioItem({ path: p, name: p.split(/[\\/]/).pop(), role: 'music', start: 0, duration: media.duration })])
    } catch (error) { notify(t('st_err', { e: error.message || error }), 'err') }
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
        additions.push(makeAudioItem({ path: filePath, name: filePath.split(/[\\/]/).pop(), role: track, start: current, duration: media.duration }))
      } catch (error) { errors.push(`${filePath.split(/[\\/]/).pop()}: ${error.message}`) }
    }
    if (resourceScopeRef.current !== scope) { notify(t('msg_audio_inspect_project_changed'), 'err'); return }
    if (additions.length) {
      pushHistory()
      addLibraryAssets(additions.map((item) => makeLibraryAsset(item.path, 'audio', { duration: item.sourceDuration })))
      appendAudioItems(additions)
    }
    setStatus(t('msg_audio_added', { n: additions.length }) + (errors.length ? ` · ${t('msg_errors_suffix', { n: errors.length })}` : ''))
    if (errors.length) notify(errors.slice(0, 3).join('\n'), 'err')
  }
  function updateAudioItem(id, patch) {
    setAudioItems((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }
  function removeAudioItem(id) {
    const item = audioItems.find((candidate) => candidate.id === id)
    if (!item) return
    if (trackLocked(item.trackId)) { warnLocked(); return }
    pushHistory(); setAudioItems((items) => items.filter((candidate) => candidate.id !== id))
    setSelItem((sel) => (sel?.id === id ? null : sel))
  }
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
      appendAudioItems([makeAudioItem({ path: r.path, name: t('tts_label'), role: 'voice', start: current, duration: r.duration || 0, source: 'tts' })]); setTtsStatus('')
      addLibraryAssets([makeLibraryAsset(r.path, 'audio', { duration: r.duration || 0 }, 'tts')])
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
      setAudioItems((items) => [...items.filter((item) => item.source !== 'redub'),
        makeAudioItem({ path: r.path, name: t('redub_voice_name'), role: 'voice', start: 0, duration: r.duration || totalDuration, source: 'redub' })])
      addLibraryAssets([makeLibraryAsset(r.path, 'audio', { duration: r.duration || totalDuration }, 'tts')])
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
  // Sticker Twemoji la anh tinh tren track V2, bat dau tai playhead; kich thuoc la fraction cua canh ngan nhat khung
  function addStickerToV2(id) {
    if (!id) return
    pushHistory()
    editTimeline((state) => placeItems(state, 'video', [{
      id: makeEntityId('sticker'), sticker: id, path: '', name: stickerChar(id) || id, kind: 'image',
      start: current, in: 0, out: 3, speed: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.2, opacity: 1,
      animated: false, missing: false
    }]))
  }
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
  const activeVideoOverlays = videoOverlays
    .filter((item) => visibleVideoIds.has(item.trackId) && current >= item.start && current < item.start + (item.out - item.in) / item.speed)
    .map((item) => ({ ...item, zIndex: layerIndex(tracks, item.trackId) }))
    .sort((a, b) => a.zIndex - b.zIndex)
  const overlayOutsideSafe = safeZone && ratio !== 'original' && activeOverlays.some((o) => o.x < 0.03 || o.x > 0.86 || o.y < 0.12 || o.y > 0.82)
  const anyAudio = clips.some((c) => c.src?.hasAudio)

  // ---- Luu / Mo du an ----
  // Truong cua mot timeline o dang luu file; `src` la state dang mo hoac snapshot cua tab khac
  function timelineContent(src) {
    return {
      captionTimebase: src.captionTimebase, ratio: src.ratio, filterKey: src.filterKey, filterIntensity: src.filterIntensity, mode: src.mode,
      captions: src.captions, burnCaptions: src.burnCaptions, overlays: src.overlays, videoOverlays: src.videoOverlays,
      audioItems: src.audioItems, tracks: src.tracks, transition: src.transition, transitionStyle: src.transitionStyle, transitionDuration: src.transitionDuration,
      clips: src.clips.map((c) => ({ id: c.id, path: c.path, name: c.name, kind: c.kind || 'video', audioDetached: c.audioDetached, audioMuted: c.audioMuted, enhance: c.enhance, in: c.in, out: c.out, speed: c.speed, kenBurns: c.kenBurns, animated: c.animated, cropMode: c.cropMode, cropX: c.cropX, cropY: c.cropY, missing: c.missing })),
      ducking: src.ducking, origVolume: src.origVolume, syncMode: src.syncMode, slideDur: src.slideDur,
      ttsEngine: src.ttsEngine, ttsVoice: src.ttsVoice, ttsRate: src.ttsRate, ttsPitch: src.ttsPitch,
      aiEdited: src.aiEdited, keepSegments: src.keepSegments, autoCut: src.autoCut, autoInfo: src.autoInfo, silenceParams: src.silenceParams, markers: src.markers
    }
  }
  function buildProject() {
    const live = timelineContent({
      captionTimebase, ratio, filterKey, filterIntensity, mode, captions, burnCaptions, overlays, videoOverlays, audioItems, tracks, transition, transitionStyle, transitionDuration,
      clips, ducking, origVolume, syncMode, slideDur, ttsEngine, ttsVoice, ttsRate, ttsPitch, aiEdited, keepSegments, autoCut, autoInfo, silenceParams, markers
    })
    return normalizeProject({
      version: 6, projectId: projectIdRef.current, assets: libraryAssets, activeTimelineId,
      timelines: timelines.map((entry) => ({ id: entry.id, name: entry.name, ...(entry.id !== activeTimelineId && entry.snap ? timelineContent(entry.snap) : live) }))
    })
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
    // Moi file media chi probe mot lan du nhieu timeline cung dung
    const probes = new Map()
    const probeOnce = (mediaPath) => {
      if (!probes.has(mediaPath)) probes.set(mediaPath, window.taoclip.probe(mediaPath).catch(() => null))
      return probes.get(mediaPath).then((media) => (media ? { ...media } : null))
    }
    const loadTimeline = async (timeline) => {
      const built = []
      for (const c of timeline.clips) {
        const m = await probeOnce(c.path) // thieu file: giu clip nguyen vi tri, danh dau missing
        if (c.kind === 'image') {
          built.push({ id: c.id, kind: 'image', path: c.path, name: c.name, animated: c.animated, missing: !m, src: { duration: c.out, width: m?.width || 0, height: m?.height || 0, hasAudio: false, isImage: true, rotation: m?.rotation || 0 }, in: 0, out: c.out, speed: 1, kenBurns: c.kenBurns !== false, cropMode: c.cropMode, cropX: c.cropX, cropY: c.cropY, thumbs: m ? [c.path] : [] })
        } else {
          built.push({ id: c.id, path: c.path, name: c.name, missing: !m, src: m || { duration: c.out, width: 0, height: 0, hasAudio: false }, in: c.in, out: c.out, speed: c.speed, audioDetached: c.audioDetached, audioMuted: c.audioMuted, enhance: c.enhance, cropMode: c.cropMode, cropX: c.cropX, cropY: c.cropY, thumbs: [] })
        }
      }
      const loadedVideoOverlays = await Promise.all(timeline.videoOverlays.map(async (item) => (item.sticker ? { ...item, missing: false } : { ...item, missing: !(await probeOnce(item.path)) })))
      const loadedAudioItems = await Promise.all(timeline.audioItems.map(async (item) => ({ ...item, missing: !(await probeOnce(item.path)) })))
      let loadedCaptions = timeline.captions
      let loadedTimebase = timeline.captionTimebase
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
      const silence = timeline.silenceParams || (timeline.autoInfo?.options ? {
        threshold: Number.parseFloat(timeline.autoInfo.options.noise) || -30,
        minSilence: timeline.autoInfo.options.minSilence ?? 0.4, pad: timeline.autoInfo.options.pad ?? 0.06
      } : { threshold: -30, minSilence: 0.4, pad: 0.06 })
      return { timeline, clips: built, videoOverlays: loadedVideoOverlays, audioItems: loadedAudioItems, captions: loadedCaptions, captionTimebase: loadedTimebase, silenceParams: silence }
    }
    const loaded = []
    for (const timeline of project.timelines) loaded.push(await loadTimeline(timeline))
    const referencedAssets = loaded.flatMap((entry) => [
      ...entry.clips.map((item) => ({ path: item.path, missing: item.missing, metadata: item.src })),
      ...entry.videoOverlays.filter((item) => !item.sticker).map((item) => ({ path: item.path, missing: item.missing, metadata: item })),
      ...entry.audioItems.map((item) => ({ path: item.path, missing: item.missing, metadata: item }))
    ])
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
    const open = loaded.find((entry) => entry.timeline.id === project.activeTimelineId) || loaded[0]
    const tl = open.timeline
    const built = open.clips
    setHist([]); setFuture([])
    setLibraryAssets(loadedLibraryAssets)
    // Tab khac giu snapshot san de doi tab tuc thi (khong probe lai)
    setTimelines(loaded.map((entry) => ({
      id: entry.timeline.id, name: entry.timeline.name, hist: [], future: [],
      snap: entry === open ? null : {
        selectedClipId: null, selectedOverlayId: null, activeClipId: null, activeClipIndex: 0,
        clips: snapshotHistoryClips(entry.clips), libraryAssets: loadedLibraryAssets, overlays: entry.timeline.overlays, videoOverlays: entry.videoOverlays,
        audioItems: entry.audioItems, tracks: entry.timeline.tracks, captions: entry.captions, captionTimebase: entry.captionTimebase,
        ratio: entry.timeline.ratio, filterKey: entry.timeline.filterKey, filterIntensity: entry.timeline.filterIntensity, mode: entry.timeline.mode,
        transition: entry.timeline.transition, transitionStyle: entry.timeline.transitionStyle, transitionDuration: entry.timeline.transitionDuration, burnCaptions: entry.timeline.burnCaptions,
        origVolume: entry.timeline.origVolume, ducking: entry.timeline.ducking, syncMode: entry.timeline.syncMode, slideDur: entry.timeline.slideDur,
        ttsEngine: entry.timeline.ttsEngine, ttsVoice: entry.timeline.ttsVoice, ttsRate: entry.timeline.ttsRate, ttsPitch: entry.timeline.ttsPitch,
        keepSegments: entry.timeline.keepSegments, autoCut: entry.timeline.autoCut, autoInfo: entry.timeline.autoInfo, aiEdited: entry.timeline.aiEdited,
        silenceParams: entry.silenceParams, markers: entry.timeline.markers
      }
    })))
    setActiveTimelineId(tl.id); setRenamingTabId(null)
    setClips(built); setSelId(built[0]?.id || null); setActiveIdx(0); setCurrent(0)
    setRatio(tl.ratio); setFilterKey(tl.filterKey); setFilterIntensity(tl.filterIntensity); setMode(tl.mode); setTransitionDuration(tl.transitionDuration)
    setCaptions(open.captions); setCaptionTimebase(open.captionTimebase); setBurnCaptions(tl.burnCaptions)
    setOverlays(tl.overlays); setSelOv(null); setTransition(tl.transition); setTransitionStyle(tl.transitionStyle)
    setVideoOverlays(open.videoOverlays); setAudioItems(open.audioItems); setTracks(tl.tracks); setSelItem(null)
    setDucking(tl.ducking)
    setOrigVolume(tl.origVolume)
    setSyncMode(tl.syncMode); setSlideDur(tl.slideDur)
    setKeepSegments(tl.keepSegments); setAutoCut(tl.autoCut); setAutoInfo(tl.autoInfo)
    setSilenceParams(open.silenceParams); setMarkers(tl.markers)
    setTtsEngine(tl.ttsEngine); setTtsVoice(tl.ttsVoice); setTtsRate(tl.ttsRate); setTtsPitch(tl.ttsPitch)
    setAiEdited(tl.aiEdited)
    setProjectPath(filePath)
    pendingProjectCleanRef.current = clean
    built.filter((c) => !isImg(c)).forEach((c) => {
      loadThumbnails(c.id, c.path)
      loadWave(c.id, c.path, c.src.hasAudio)
    })
  }

  // ---- Nhieu timeline (tab) ----
  const timelineBusy = exporting || importing || busy || capBusy || ttsBusy || redubBusy || aiBusy || faceBusy || dlBusy || collectingProject
  // Timeline moi: rong, nhung ke thua ti le + cai dat dau ra + giong doc cua tab dang mo
  function blankTimelineSnapshot() {
    return {
      selectedClipId: null, selectedOverlayId: null, activeClipId: null, activeClipIndex: 0,
      clips: [], libraryAssets: libraryAssetsRef.current, overlays: [], videoOverlays: [], audioItems: [], tracks: defaultTracks(), captions: [], captionTimebase: 'timeline',
      ratio, filterKey: 'none', filterIntensity: 100, mode, transition, transitionStyle, transitionDuration, burnCaptions,
      origVolume: 1, ducking, syncMode, slideDur, ttsEngine, ttsVoice, ttsRate, ttsPitch,
      keepSegments: null, autoCut: false, autoInfo: null, aiEdited: false, silenceParams: { threshold: -30, minSilence: 0.4, pad: 0.06 }, markers: []
    }
  }
  // Doi sang tab `toId` (hoac them tab `add` roi mo no; `dropId`: bo tab nay khi roi di). Tab dang mo luu snapshot + lich su vao danh sach.
  function switchTimeline(toId, { add = null, dropId = null } = {}) {
    if (toId === activeTimelineId) return true
    const target = add || timelines.find((entry) => entry.id === toId)
    if (!target?.snap) return false
    if (timelineBusy) { notify(t('tltab_busy'), 'err'); return false }
    endHistoryEdit()
    // Ket qua cua cac tac vu dang bay thuoc ve tab cu: huy nhu khi mo du an khac
    resourceScopeRef.current++
    asyncResourceGuardRef.current.invalidateAll()
    editRevisionRef.current++
    const leaving = snapshot()
    const leavingHist = hist, leavingFuture = future
    setTimelines((list) => (add ? [...list, add] : list)
      .filter((entry) => entry.id !== dropId)
      .map((entry) => entry.id === activeTimelineId ? { ...entry, snap: leaving, hist: leavingHist, future: leavingFuture }
        : entry.id === toId ? { ...entry, snap: null, hist: [], future: [] } : entry))
    restore({ ...target.snap, libraryAssets: libraryAssetsRef.current })
    setHist(target.hist); setFuture(target.future)
    setActiveTimelineId(toId); setRenamingTabId(null); setCtxMenu(null)
    setPlaying(false); curRef.current = 0; setCurrent(0); setActiveIdx(0); setExactFilterPreview('')
    return true
  }
  function addTimeline() {
    if (timelines.length >= MAX_TIMELINES) { notify(t('tltab_limit', { n: MAX_TIMELINES }), 'err'); return }
    const entry = { id: makeEntityId('timeline'), name: nextTimelineName(timelines), snap: blankTimelineSnapshot(), hist: [], future: [] }
    switchTimeline(entry.id, { add: entry })
  }
  function duplicateTimeline(id) {
    if (timelines.length >= MAX_TIMELINES) { notify(t('tltab_limit', { n: MAX_TIMELINES }), 'err'); return }
    const source = timelines.find((entry) => entry.id === id)
    if (!source) return
    const copied = JSON.parse(JSON.stringify(id === activeTimelineId ? snapshot() : source.snap))
    const entry = { id: makeEntityId('timeline'), name: copyTimelineName(timelines, source.name), hist: [], future: [],
      snap: { ...copied, selectedClipId: null, selectedOverlayId: null, libraryAssets: libraryAssetsRef.current } }
    switchTimeline(entry.id, { add: entry })
  }
  function renameTimeline(id, value) {
    setTimelines((list) => list.map((entry) => entry.id === id ? { ...entry, name: cleanTimelineName(value, entry.name) } : entry))
  }
  function removeTimeline(id) {
    if (timelines.length <= 1) return
    const entry = timelines.find((item) => item.id === id)
    if (!entry) return
    const content = id === activeTimelineId ? { clips, videoOverlays, audioItems, overlays, captions } : entry.snap
    const hasContent = !!(content.clips.length || content.videoOverlays.length || content.audioItems.length || content.overlays.length || content.captions.length)
    if (hasContent && !window.confirm(t('tltab_delete_confirm', { name: entry.name }))) return
    if (id === activeTimelineId) { switchTimeline(activeAfterRemove(timelines, id, id), { dropId: id }); return }
    setTimelines((list) => list.filter((item) => item.id !== id))
  }
  function shiftTimeline(id, delta) {
    setTimelines((list) => moveTimeline(list, id, list.findIndex((entry) => entry.id === id) + delta))
  }
  function openTabMenu(event, id) {
    setCtxMenu({ x: event.clientX, y: event.clientY, target: { kind: 'tab', id } })
  }
  function buildTabMenuItems(id) {
    const index = timelines.findIndex((entry) => entry.id === id)
    if (index < 0) return []
    const entry = (itemId, labelKey, icon, run, extra = {}) => ({ id: itemId, label: t(labelKey), icon, run, ...extra })
    return [
      entry('tab-rename', 'tltab_rename', <Pencil size={14} />, () => setRenamingTabId(id)),
      entry('tab-duplicate', 'tltab_duplicate', <CopyPlus size={14} />, () => duplicateTimeline(id), { disabled: timelines.length >= MAX_TIMELINES }),
      entry('tab-left', 'tltab_left', <ChevronLeft size={14} />, () => shiftTimeline(id, -1), { disabled: index === 0 }),
      entry('tab-right', 'tltab_right', <ChevronRight size={14} />, () => shiftTimeline(id, 1), { disabled: index === timelines.length - 1 }),
      { separator: true },
      entry('tab-delete', 'tltab_delete', <Trash2 size={14} />, () => removeTimeline(id), { danger: true, disabled: timelines.length <= 1 })
    ]
  }
  const timelineTabs = timelines.map((entry) => ({
    id: entry.id, name: entry.name,
    duration: entry.id === activeTimelineId || !entry.snap ? totalDuration : approxTimelineDuration(entry.snap)
  }))

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
        setSavedProjectSerialized(projectKey(data))
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
      setSavedProjectSerialized(projectKey(data))
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
    // Nhieu timeline: ten file mac dinh theo ten tab de xuat tung tap khong bi lan
    const tabName = timelines.length > 1 ? timelines.find((entry) => entry.id === activeTimelineId)?.name : ''
    const out = await window.taoclip.saveVideo(tabName ? `${tabName.replace(/[\\/:*?"<>|]/g, '_')}.mp4` : 'taoclip-export.mp4'); if (!out) return
    setExporting(true); setProgress(0); setExpStage('core')
    const ratios = [ratio, ...extraRatios.filter((r) => r !== ratio)]
    let segments
    if (single && autoCut && keepSegments) {
      const c = clips[0]
      segments = keepSegments.map((s) => ({ start: Math.max(s.start, c.in), end: Math.min(s.end, c.out) })).filter((s) => s.end - s.start > 0.05)
    }
    const clipPayload = clips.map((c) => ({ input: c.path, kind: c.kind || 'video', audioDetached: !!c.audioDetached, audioMuted: !!c.audioMuted, enhance: !!c.enhance, in: c.in, out: c.out, speed: c.speed, kenBurns: c.kenBurns, animated: c.animated, cropMode: c.cropMode || 'fit', cropX: c.cropX ?? 0.5, cropY: c.cropY ?? 0.5, formatName: c.src?.formatName, hasAudio: !!c.src?.hasAudio && !c.audioDetached && !c.audioMuted }))
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
          videoOverlays: withLayerZIndex(videoOverlays, tracks).filter((item) => visibleVideoIds.has(item.trackId)).map(({ path, kind, start, in: sourceIn, out: sourceOut, speed, x, y, width, height, opacity, zIndex, animated, missing, name, sticker }) => ({
            path, kind, start, in: sourceIn, out: sourceOut, speed, x, y, width, height, opacity, zIndex, animated, missing, name, sticker
          })),
          audioItems: audioItems.filter((item) => audibleIds.has(item.trackId)),
          origVolume: effOrigVolume, ducking, aiEdited,
          captionTimebase,
          useGpu, quality, resolution, transition: clips.length > 1 && transition !== 'none'
            ? { type: transition === 'cross' ? 'crossfade' : 'fade', dur: transitionDuration, style: transitionStyle } : undefined
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

  const ticks = []
  if (totalDuration) { const step = tickStep(pps); for (let s = 0; s <= totalDuration; s += step) ticks.push(s) }
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
              hasVoiceTracks={audioItems.some((item) => item.track === 'voice')} canvasDuration={totalDuration} delCaption={delCaption}
              overlays={overlays} selOv={selOv} setSelOv={setSelOv} addText={addText}
              updateOverlay={updateOverlay} delOverlay={delOverlay} moveOverlayLayer={moveOverlayLayer} setOverlayBoundaryAtPlayhead={setOverlayBoundaryAtPlayhead} seekGlobal={seekGlobal} current={current}
              beginEdit={beginHistoryEdit} endEdit={endHistoryEdit} pushHistory={pushHistory} />
          ) : tab === 'audio' ? (
            <AudioTab hasClips={hasClips} anyAudio={anyAudio} imageCount={imageCount}
              syncMode={syncMode} setSyncMode={changeSyncMode} setSlideDur={changeSlidePreset} setAllSlideDur={setAllSlideDur}
              fitSlideDuration={fitSlideDuration} fitMusicDuration={fitMusicDuration} hasFitMusic={hasFitMusic} timelineDuration={totalDuration}
              audioItems={audioItems} addAudioItems={addAudioItems} updateAudioItem={updateAudioItem} removeAudioItem={removeAudioItem}
              origVolume={origVolume} setOrigVolume={setOrigVolume}
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
              addSticker={addStickerToV2} videoOverlays={videoOverlays} updateVideoOverlay={updateVideoOverlay} delVideoOverlay={removeVideoOverlay}
              updateOverlay={updateOverlay} delOverlay={delOverlay} moveOverlayLayer={moveOverlayLayer} setOverlayBoundaryAtPlayhead={setOverlayBoundaryAtPlayhead} seekGlobal={seekGlobal} current={current}
              beginEdit={beginHistoryEdit} endEdit={endHistoryEdit} pushHistory={pushHistory} />
          ) : tab === 'trans' ? (
            <TransTab clipCount={clips.length} transition={transition} setTransition={changeTransition} style={transitionStyle} setStyle={changeTransitionStyle}
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
                  ? <video ref={videoRef} src={videoSrc} preload="auto" playsInline onLoadedMetadata={onLoadedMeta} onCanPlay={onPreviewCanPlay} onError={onPreviewVideoError} onTimeUpdate={onTimeUpdate} onClick={togglePlay} style={{ ...previewCropStyle, filter: mainFilterCss, opacity: mainPreviewOpacity }} />
                  : <img className={`cc-slide ${activeClip.kenBurns !== false ? 'kb' : ''}`} src={imageSrc} alt="" draggable={false} onLoad={onPreviewImageLoad} onError={onPreviewImageError} onClick={togglePlay} style={{ ...previewCropStyle, filter: mainFilterCss, opacity: mainPreviewOpacity }} />}
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
            {audioItems.map((item) => <AudioItemPreview key={item.id} item={item} current={current} playing={playing} totalDuration={totalDuration} audible={audibleIds.has(item.trackId)} />)}
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

      <Timeline
        tlH={tlH} onResizePanel={(e) => startPanelResize('tl', e)} overlayThumbs={overlayThumbs} audioWaves={audioWaves} laneDrag={laneDrag}
        compact={compactLanes} onToggleCompact={() => setCompactLanes((value) => !value)} markers={markers} onAddMarker={addMarkerAtPlayhead} onMarkerContext={openMarkerMenu} onMarkerRename={renameMarker} renamingMarkerId={renamingMarkerId} onRenameMarkerStart={setRenamingMarkerId} onRenameMarkerEnd={() => setRenamingMarkerId(null)} onStartClipAudioDrag={startClipAudioDrag}
        tabs={<TimelineTabs tabs={timelineTabs} activeId={activeTimelineId} renamingId={renamingTabId}
          onRenameStart={setRenamingTabId} onRenameEnd={() => setRenamingTabId(null)} onRename={renameTimeline}
          onSelect={(id) => switchTimeline(id)} onAdd={addTimeline} onClose={removeTimeline} onContextMenu={openTabMenu}
          canAdd={timelines.length < MAX_TIMELINES} />}
        tracks={tracks} onTrackPatch={patchTrack} onAddTrack={addTrack} onRemoveTrack={removeTrack}
        layout={layout} selId={selId} onSelectClip={(id, event) => clickSelect({ kind: 'clip', id }, event)} multiKeys={multiKeys} onMarqueeStart={startMarquee} videoOverlays={videoOverlays} audioItems={audioItems} overlays={overlays}
        selOv={selOv} selItem={selItem} onSelectItem={(sel, event) => clickSelect(sel, event)}
        pps={pps} scrollRef={scrollRef} totalDuration={totalDuration} current={current} ticks={ticks} dragInsert={dragInsert} hasClips={hasClips}
        snapEnabled={snapEnabled} onToggleSnap={() => setSnapEnabled((value) => !value)} canUndo={hist.length > 0} canRedo={future.length > 0}
        onUndo={undo} onRedo={redo} onSplit={splitAtPlayhead} onShowKeys={() => setShowKeys(true)}
        canDetach={!!selectedClip && !isImg(selectedClip) && !!selectedClip.src?.hasAudio && !selectedClip.audioDetached && !selectedClip.missing}
        isDetached={!!selectedClip?.audioDetached} onDetachAudio={toggleDetachSelected}
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)} onZoomIn={() => zoomBy(ZOOM_STEP)} onFit={fitZoom}
        onSeekClick={timelineClick} onStartScrub={startScrub} onStartTrim={startTrim} onStartReorder={startReorder}
        onRetryWave={(id, mediaPath) => loadWave(id, mediaPath, true)} onSeek={seekGlobal}
        onStartV2Move={startV2Move} onStartItemTrim={startItemTrim} onRemoveV2={removeVideoOverlay}
        onStartAudioDrag={startAudioItemDrag} onRemoveAudio={removeAudioItem}
        onStartOverlayMove={startOvMove} onStartOverlayResize={startOvResize} onItemContextMenu={openItemMenu} dragActive={dragOver} onLaneDrop={handleLaneDrop} />

      {dragOver && <div className="cc-drop" style={{ bottom: tlH }}><div>{t('drop_overlay')}</div></div>}

      {marquee && <div className="cc-marquee" style={{ left: Math.min(marquee.x1, marquee.x2), top: Math.min(marquee.y1, marquee.y2), width: Math.abs(marquee.x2 - marquee.x1), height: Math.abs(marquee.y2 - marquee.y1) }} />}
      <ToastStack toasts={toasts} onClose={closeToast} />
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.target.kind === 'tab' ? buildTabMenuItems(ctxMenu.target.id) : ctxMenu.target.kind === 'marker' ? buildMarkerMenuItems(ctxMenu.target.id) : buildContextItems(ctxMenu.target)} onClose={() => setCtxMenu(null)} />}

      {showExport && (
        <ExportDialog
          ratio={ratio} extraRatios={extraRatios} toggleExtra={toggleExtra}
          mode={mode} setMode={changeMode} gpuEnc={gpuEnc} useGpu={useGpu} setUseGpu={setUseGpu}
          quality={quality} setQuality={setQuality} resolution={resolution} setResolution={setResolution}
          captionsCount={captions.length} burnCaptions={burnCaptions} setBurnCaptions={changeBurnCaptions}
          clipCount={clips.length} totalDuration={totalDuration}
          hasBurnStage={(burnCaptions && captions.length > 0) || overlays.length > 0}
          hasAudioStage={audioItems.length > 0}
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
