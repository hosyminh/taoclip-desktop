import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'

// Menu chuot phai cua timeline. items: { id, label, icon, shortcut, disabled, danger, checked, run } hoac { separator: true }.
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Giu menu nam tron trong cua so
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({ left: Math.max(6, Math.min(x, window.innerWidth - width - 6)), top: Math.max(6, Math.min(y, window.innerHeight - height - 6)) })
  }, [x, y, items.length])

  useEffect(() => {
    const close = () => onClose()
    const onPointerDown = (event) => { if (!ref.current?.contains(event.target)) onClose() }
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
    }
  }, [onClose])

  return (
    <div className="cc-ctxmenu" ref={ref} role="menu" style={pos} onContextMenu={(event) => event.preventDefault()}>
      {items.map((item, index) => item.separator
        ? <div className="sep" key={`sep-${index}`} role="separator" />
        : (
          <button key={item.id} role="menuitem" data-ctx={item.id} className={`item ${item.danger ? 'danger' : ''}`} disabled={item.disabled}
            onClick={() => { onClose(); item.run?.() }}>
            <span className="ic">{item.icon}</span>
            <span className="lb">{item.label}</span>
            {item.checked && <Check size={13} />}
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ))}
    </div>
  )
}
