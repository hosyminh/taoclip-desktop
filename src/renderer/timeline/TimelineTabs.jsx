import React, { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { fmt } from '../utils.js'
import { MAX_NAME_LENGTH } from '../timelines-model.js'

// Thanh tab timeline (nhieu "tap phim" trong mot du an). Chi hien thi; thao tac di qua callback cua App.
// renamingId do App giu de menu chuot phai cung bat duoc che do doi ten.
export default function TimelineTabs({ tabs, activeId, renamingId, onRenameStart, onRenameEnd, onSelect, onAdd, onRename, onClose, onContextMenu, canAdd }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(null) // { id, value }
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const finishedRef = useRef(false) // Enter / Escape roi blur khi o nhap bi go: chi xu ly mot lan
  const editValue = renamingId ? (draft?.id === renamingId ? draft.value : tabs.find((tab) => tab.id === renamingId)?.name ?? '') : ''

  useEffect(() => {
    finishedRef.current = false
    if (renamingId) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [renamingId])

  // Tab dang mo luon nam trong tam nhin khi co nhieu tab
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector('.cc-tltab.on')
    if (!list || !el) return
    if (el.offsetLeft < list.scrollLeft) list.scrollLeft = Math.max(0, el.offsetLeft - 4)
    else if (el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = el.offsetLeft + el.offsetWidth - list.clientWidth + 4
  }, [activeId, tabs.length])

  const finish = (save) => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (save && renamingId) onRename(renamingId, editValue)
    setDraft(null)
    onRenameEnd()
  }

  return (
    <div className="cc-tltabs">
      <div className="cc-tltabs-list" role="tablist" aria-label={t('tltab_label')} ref={listRef}>
      {tabs.map((tab) => {
        const active = tab.id === activeId
        const renaming = renamingId === tab.id
        return (
          <div key={tab.id} role="tab" aria-selected={active} data-tl={tab.id} className={`cc-tltab ${active ? 'on' : ''}`}
            onClick={() => { if (!active && !renaming) onSelect(tab.id) }}
            onContextMenu={(event) => { event.preventDefault(); onContextMenu(event, tab.id) }}
            onAuxClick={(event) => { if (event.button === 1 && tabs.length > 1) { event.preventDefault(); onClose(tab.id) } }}>
            {renaming
              ? (
                <input ref={inputRef} className="nm-edit" value={editValue} maxLength={MAX_NAME_LENGTH} aria-label={t('tltab_rename')}
                  onChange={(event) => setDraft({ id: tab.id, value: event.target.value })}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={() => finish(true)}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') finish(true)
                    else if (event.key === 'Escape') finish(false)
                  }} />
              )
              : <span className="nm" title={t('tltab_rename_tip')} onDoubleClick={() => onRenameStart(tab.id)}>{tab.name}</span>}
            <small className="du">{fmt(tab.duration)}</small>
            {tabs.length > 1 && (
              <button className="x" title={t('tltab_close')} aria-label={t('tltab_close')}
                onClick={(event) => { event.stopPropagation(); onClose(tab.id) }}><X size={11} /></button>
            )}
          </div>
        )
      })}
      </div>
      <button className="cc-tltab-add" onClick={onAdd} disabled={!canAdd} title={t('tltab_add')} aria-label={t('tltab_add')}><Plus size={14} /></button>
    </div>
  )
}
