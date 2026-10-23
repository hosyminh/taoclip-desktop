import React from 'react'
import { X } from 'lucide-react'
import { useI18n } from './i18n.jsx'

// Bang phim tat (bam ? de mo)
export default function ShortcutsModal({ onClose }) {
  const { t } = useI18n()
  return (
    <div className="cc-modal" onClick={onClose}>
      <div className="cc-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-head"><b>{t('keys_title')}</b><button className="cap-del" onClick={onClose}><X size={15} /></button></div>
        <div className="keys-grid">
          <kbd>Space</kbd><span>{t('sc_play')}</span>
          <kbd>← / →</kbd><span>{t('sc_frame')}</span>
          <kbd>Home / End</kbd><span>{t('sc_home')}</span>
          <kbd>I / O</kbd><span>{t('sc_io')}</span>
          <kbd>S</kbd><span>{t('sc_split')}</span>
          <kbd>Del</kbd><span>{t('sc_del')}</span>
          <kbd>+ / −</kbd><span>{t('sc_zoom')}</span>
          <kbd>Ctrl+Z / Y</kbd><span>{t('sc_undo')}</span>
          <kbd>Ctrl+🖱</kbd><span>{t('sc_wheel')}</span>
        </div>
      </div>
    </div>
  )
}
