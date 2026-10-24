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
          <kbd>Ctrl+B</kbd><span>{t('sc_split_at')}</span>
          <kbd>Ctrl+C / V / D</kbd><span>{t('sc_copy')}</span>
          <kbd>F</kbd><span>{t('sc_freeze')}</span>
          <kbd>M</kbd><span>{t('sc_mute_item')}</span>
          <kbd>Ctrl+🖱 / Ctrl+A</kbd><span>{t('sc_multi')}</span>
          <kbd>Shift+Del</kbd><span>{t('sc_ripple')}</span>
          <kbd>Shift+M · [ ]</kbd><span>{t('sc_marker')}</span>
          <kbd>Del</kbd><span>{t('sc_del')}</span>
          <kbd>+ / −</kbd><span>{t('sc_zoom')}</span>
          <kbd>Ctrl+Z / Y</kbd><span>{t('sc_undo')}</span>
          <kbd>Ctrl+🖱</kbd><span>{t('sc_wheel')}</span>
        </div>
      </div>
    </div>
  )
}
