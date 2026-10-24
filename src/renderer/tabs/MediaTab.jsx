import React, { useEffect, useState } from 'react'
import { Link, FolderOpen, X } from 'lucide-react'
import { ASSET_DRAG_TYPE } from '../timeline/geometry.js'
import { useI18n } from '../i18n.jsx'
import { fmt, fileUrl, clipOut } from '../utils.js'

// Tab Media: nhap video/anh + tai tu link (YouTube/TikTok) + luoi thumbnail
export default function MediaTab({ clips, selId, setSelId, layout, seekGlobal, onImport, onImportImages,
  dlBusy, dlStatus, downloadFromUrl, cancelDownload, chooseDownloadDirectory, importing, importProgress, importReport, cancelImport, retryThumbnails,
  onAddToOverlay, videoOverlays = [], updateVideoOverlay, beginVideoOverlayEdit, endVideoOverlayEdit,
  libraryAssets = [], assetUsage = () => 0, onAddAssetToTimeline = () => {}, onRemoveLibraryAsset = () => {}, onRelinkLibraryAsset = () => {} }) {
  const { t } = useI18n()
  const [url, setUrl] = useState('')
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [maxRes, setMaxRes] = useState(1080)
  const [outDir, setOutDir] = useState('')
  const [assetPreviews, setAssetPreviews] = useState({})
  const go = async () => { if (url.trim() && !dlBusy && await downloadFromUrl(url.trim(), { maxRes, outDir })) setUrl('') }
  const clipsByPath = new Map()
  for (const clip of clips) {
    const key = String(clip.path || '').replace(/\\/g, '/').toLowerCase()
    if (!clipsByPath.has(key)) clipsByPath.set(key, [])
    clipsByPath.get(key).push(clip)
  }
  const assets = libraryAssets.filter((asset) => {
    return (kindFilter === 'all' || asset.kind === kindFilter) && asset.name.toLowerCase().includes(search.trim().toLowerCase())
  })
  function assetKey(asset) { return String(asset.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  async function loadAssetPreview(asset) {
    const key = assetKey(asset)
    setAssetPreviews((items) => ({ ...items, [key]: { state: 'loading', path: asset.path } }))
    try {
      const preview = asset.kind === 'audio'
        ? await window.taoclip.waveform(asset.path)
        : await window.taoclip.thumbnails(asset.path, 1)
      const source = asset.kind === 'image' ? asset.path : asset.kind === 'audio' ? preview : preview?.[0]
      if (!source) throw new Error('Preview unavailable')
      setAssetPreviews((items) => ({ ...items, [key]: { state: 'ready', path: asset.path, source, audio: asset.kind === 'audio' } }))
    } catch {
      setAssetPreviews((items) => ({ ...items, [key]: { state: 'error', path: asset.path } }))
    }
  }
  useEffect(() => {
    for (const asset of libraryAssets) {
      const key = assetKey(asset)
      if (asset.kind === 'image' || asset.missing || assetPreviews[key]) continue
      void loadAssetPreview(asset)
    }
  }, [libraryAssets, assetPreviews])
  return (
    <>
      <div className="cc-import-row">
        <button className="cc-import" onClick={onImport} disabled={importing}>{t('import_video')}</button>
        <button className="cc-import alt" onClick={onImportImages} disabled={importing}>{t('import_image')}</button>
      </div>
      {importing && <div className="cc-import-progress"><span>{importProgress || t('import_checking')}</span><button className="cc-ghost" onClick={cancelImport}>{t('import_cancel')}</button></div>}
      {importReport.length > 0 && <div className="cc-import-report" role="status">
        {importReport.slice(0, 6).map((entry, index) => <div key={`${entry.path}-${index}`} className={entry.ok ? 'ok' : 'err'} title={entry.reason || ''}>
          <span>{entry.ok ? '✓' : '!'}</span> {entry.path}{entry.reason ? ` — ${entry.reason}` : ''}
        </div>)}
        {importReport.length > 6 && <small>+{importReport.length - 6}</small>}
      </div>}
      {clips.some((clip) => clip.animated) && <small className="cap-hint">{t('gif_animation_hint')}</small>}
      <div className="key-row" style={{ marginBottom: 6 }}>
        <input className="cc-key" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder={t('dl_ph')} disabled={dlBusy} onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
        <button className="cc-mini" onClick={go} disabled={dlBusy || !url.trim()} title={t('dl_btn')}>
          {dlBusy ? '...' : <Link size={14} />}
        </button>
      </div>
      <div className="key-row" style={{ marginBottom: 6 }}>
        <select className="cc-key" value={maxRes} onChange={(e) => setMaxRes(Number(e.target.value))} disabled={dlBusy} aria-label={t('dl_max_res')}>
          {[240, 360, 480, 720, 1080, 1440, 2160].map((height) => <option key={height} value={height}>{t('dl_max_height', { h: height })}</option>)}
        </select>
        <button className="cc-mini" onClick={async () => { const dir = await chooseDownloadDirectory?.(); if (dir) setOutDir(dir) }} disabled={dlBusy} title={t('dl_choose_dir')}><FolderOpen size={14} /></button>
      </div>
      {outDir && <small className="cap-hint">{t('dl_save_to', { d: outDir })}</small>}
      {dlBusy && <button className="cc-ghost" onClick={cancelDownload}>{t('dl_cancel')}</button>}
      {dlStatus && <small className="cap-hint">{dlStatus}</small>}
      <small className="cap-hint" style={{ marginBottom: 10 }}>{t('dl_hint')}</small>
      <div className="cc-grid">
        <div className="cc-media-tools">
          <input className="cc-key" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('media_search_ph')} />
          <div className="seg media-filter">
            {['all', 'video', 'image', 'audio'].map((kind) => <button key={kind} className={kindFilter === kind ? 'on' : ''} onClick={() => setKindFilter(kind)}>{t(`media_filter_${kind}`)}</button>)}
          </div>
        </div>
        {assets.map((asset) => {
          const key = String(asset.path || '').replace(/\\/g, '/').toLowerCase()
          const appearances = clipsByPath.get(key) || []
          const selected = appearances.find((clip) => clip.id === selId) || appearances[0]
          const image = asset.kind === 'image'
          const audio = asset.kind === 'audio'
          const missing = asset.missing || appearances.some((clip) => clip.missing)
          const preview = missing ? null : asset.kind === 'image' ? asset.path : assetPreviews[key]?.source
          const previewError = assetPreviews[key]?.state === 'error'
          const uses = assetUsage(asset)
          return <div key={asset.id} className={`cc-card ${appearances.some((clip) => clip.id === selId) ? 'on' : ''}`}
            draggable={!missing} onDragStart={(event) => {
              event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify({ path: asset.path, kind: asset.kind, name: asset.name }))
              event.dataTransfer.effectAllowed = 'copy'
            }} onClick={() => {
            if (selected) { setSelId(selected.id); seekGlobal((layout.find((segment) => segment.id === selected.id) || {}).start || 0) }
          }}>
            <div className="thumb" style={preview ? { backgroundImage: `url(${fileUrl(preview)})` } : undefined}>{!preview && (missing ? '⚠️' : audio ? '🎵' : image ? '🖼️' : assetPreviews[key]?.state === 'loading' ? '…' : '🎬')}{(image || audio) && <em className="badge">{image ? 'IMG' : 'AUDIO'}</em>}<span>{fmt(image ? (selected ? clipOut(selected) : asset.metadata?.duration || 0) : asset.metadata?.duration || selected?.src.duration || 0)}</span></div>
            <div className="nm" title={asset.name}>{asset.name}</div>
            <small className={`cc-asset-use ${missing ? 'cap-warn' : ''}`}>{missing ? t('media_missing_asset') : t('media_usage_count', { n: uses })}</small>
            <div className="key-row">
              <button className="cc-mini" onClick={(event) => { event.stopPropagation(); onAddAssetToTimeline(asset) }} disabled={missing}>{t('media_add_to_timeline')}</button>
              {missing && <button className="cc-mini" onClick={(event) => { event.stopPropagation(); onRelinkLibraryAsset(asset) }}>{t('media_relink')}</button>}
              {selected && <button className="cc-v2-add" onClick={(event) => { event.stopPropagation(); onAddToOverlay?.(selected) }} title={t('v2_add_tip')}>+ V2</button>}
              <button className="cap-del" onClick={(event) => { event.stopPropagation(); onRemoveLibraryAsset(asset) }} title={t('media_remove_library')} aria-label={t('media_remove_library')}><X size={13} /></button>
            </div>
            {!preview && previewError && <button className="cc-thumb-retry" onClick={(event) => { event.stopPropagation(); void loadAssetPreview(asset) }}>{t('media_retry')}</button>}
          </div>
        })}
        {!assets.length && <div className="cc-hint">{libraryAssets.length ? t('media_no_match') : <>{t('drop_hint')}<br />{t('drop_hint2')}</>}</div>}
      </div>
      {videoOverlays.length > 0 && <section className="cc-v2-controls">
        <h4>{t('v2_track')}</h4>
        {videoOverlays.map((item) => <div key={item.id} className="cc-v2-control-item">
          <strong title={item.name || item.path}>{item.name || item.path.split(/[\\/]/).pop()}</strong>
          <label>{t('v2_width')} <output>{Math.round(item.width * 100)}%</output>
            <input type="range" min="0.1" max="2" step="0.05" value={item.width}
              onPointerDown={beginVideoOverlayEdit} onFocus={beginVideoOverlayEdit} onBlur={endVideoOverlayEdit} onChange={(event) => updateVideoOverlay(item.id, { width: Number(event.target.value) })} />
          </label>
          <label>{t('v2_height')} <output>{Math.round(item.height * 100)}%</output>
            <input type="range" min="0.1" max="2" step="0.05" value={item.height}
              onPointerDown={beginVideoOverlayEdit} onFocus={beginVideoOverlayEdit} onBlur={endVideoOverlayEdit} onChange={(event) => updateVideoOverlay(item.id, { height: Number(event.target.value) })} />
          </label>
          <label>{t('v2_opacity')} <output>{Math.round(item.opacity * 100)}%</output>
            <input type="range" min="0" max="1" step="0.05" value={item.opacity}
              onPointerDown={beginVideoOverlayEdit} onFocus={beginVideoOverlayEdit} onBlur={endVideoOverlayEdit} onChange={(event) => updateVideoOverlay(item.id, { opacity: Number(event.target.value) })} />
          </label>
        </div>)}
      </section>}
    </>
  )
}
