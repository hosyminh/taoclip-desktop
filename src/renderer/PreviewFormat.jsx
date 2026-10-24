import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronUp, RectangleVertical } from 'lucide-react'
import { useI18n } from './i18n.jsx'

export const RATIOS = ['9:16', '1:1', '4:5', '16:9', 'original']

// Tỉ lệ khung của cả video (mỗi timeline một tỉ lệ) + vùng an toàn: nằm ở thanh dưới khung xem trước vì là cài đặt chung, không thuộc về clip nào
export default function PreviewFormat({ ratio, setRatio, safeZone, setSafeZone }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const label = ratio === 'original' ? t('ratio_original') : ratio

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => { if (!box.current?.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [open])

  return (
    <div className="cc-format" ref={box}>
      <button className={`cc-format-btn ${open ? 'on' : ''}`} onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}
        title={t('format_tip')} data-ratio={ratio}>
        <RectangleVertical size={14} /><span>{label}</span><ChevronUp size={12} />
      </button>
      {open && (
        <div className="cc-format-menu" role="menu">
          <div className="cap-hint">{t('format_whole_video')}</div>
          {RATIOS.map((value) => (
            <button key={value} role="menuitemradio" aria-checked={ratio === value} data-ratio-option={value} className={ratio === value ? 'on' : ''}
              onClick={() => { setRatio(value); setOpen(false) }}>
              <span className="ck">{ratio === value && <Check size={13} />}</span>{value === 'original' ? t('ratio_original') : value}
            </button>
          ))}
          <div className="sep" />
          <button role="menuitemcheckbox" aria-checked={safeZone} data-safezone className={safeZone ? 'on' : ''} onClick={() => setSafeZone(!safeZone)} title={t('safezone_hint')}>
            <span className="ck">{safeZone && <Check size={13} />}</span>{t('safezone')}
          </button>
        </div>
      )}
    </div>
  )
}
