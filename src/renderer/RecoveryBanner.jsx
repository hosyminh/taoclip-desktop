import React from 'react'
import { useI18n } from './i18n.jsx'

// Moi khoi phuc ban autosave khi mo app voi du an trong
export default function RecoveryBanner({ recover, onRestore, onDismiss }) {
  const { t } = useI18n()
  return (
    <div className="cc-recover">
      <span>↩ {t('recover_msg')} {recover.name ? `— ${recover.name}` : ''} ({new Date(recover.timestamp).toLocaleString()})</span>
      <button className="cc-export" onClick={onRestore}>{t('recover_yes')}</button>
      <button className="cc-ghost" onClick={onDismiss}>{t('recover_no')}</button>
    </div>
  )
}
