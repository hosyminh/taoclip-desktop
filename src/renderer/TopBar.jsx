import React from 'react'
import { CopyPlus, FolderOpen, FolderUp, Redo2, Save, Undo2, Upload } from 'lucide-react'
import { LANGS, useI18n } from './i18n.jsx'

// Thanh tren cung: ten du an, mo/luu/thu thap media, undo/redo, ngon ngu, nut xuat
export default function TopBar({
  projectPath, projectDirty, collecting,
  canUndo, canRedo, canExport, exporting, progress,
  onOpen, onSave, onSaveAs, onCollect, onUndo, onRedo, onExport
}) {
  const { t, lang, setLang } = useI18n()
  // Windows: thanh tren cung la titleBarOverlay (main.cjs), can chua cho nut cua so
  const winOverlay = window.taoclip?.platform === 'win32'
  return (
    <header className={winOverlay ? 'cc-top cc-top-win' : 'cc-top'}>
      <div className="cc-logo">Tao<span>Clip</span></div>
      <div className="cc-proj" title={projectPath || t('proj_untitled')}>{projectPath ? projectPath.split(/[\\/]/).pop() : t('proj_untitled')}{projectDirty ? ' •' : ''} <span className="free">Free</span></div>
      <div className="cc-top-right">
        <button className="cc-ghost ic-btn" onClick={onOpen} disabled={collecting} title={t('proj_open')}><FolderOpen size={16} /></button>
        <button className="cc-ghost ic-btn" onClick={onSave} disabled={collecting} title={t('proj_save')}><Save size={16} /></button>
        <button className="cc-ghost ic-btn" onClick={onSaveAs} disabled={collecting} title={t('proj_save_as')}><CopyPlus size={16} /></button>
        <button className="cc-ghost ic-btn" onClick={onCollect} disabled={collecting} title={t('project_collect')}>{collecting ? '…' : <FolderUp size={16} />}</button>
        <button className="cc-ghost ic-btn" onClick={onUndo} disabled={!canUndo} title={t('undo')}><Undo2 size={16} /></button>
        <button className="cc-ghost ic-btn" onClick={onRedo} disabled={!canRedo} title={t('redo')}><Redo2 size={16} /></button>
        <select className="cc-lang" value={lang} onChange={(e) => setLang(e.target.value)} title="Language">
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button className="cc-export" onClick={onExport} disabled={!canExport || exporting}>
          {exporting ? t('exporting_pct', { p: progress }) : <><Upload size={15} /> {t('export')}</>}
        </button>
      </div>
    </header>
  )
}
