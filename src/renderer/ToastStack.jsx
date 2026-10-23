import React from 'react'
import { X } from 'lucide-react'

// Thong bao noi o goc man hinh; moi toast co the kem mot nut hanh dong
export default function ToastStack({ toasts, onClose }) {
  return (
    <div className="cc-toasts">
      {toasts.map((n) => (
        <div key={n.id} className={`cc-toast ${n.type}`}>
          <span>{n.msg}</span>
          {n.action && <button className="act" onClick={() => { n.action.run(); onClose(n.id) }}>{n.action.label}</button>}
          <button className="cap-del" onClick={() => onClose(n.id)}><X size={12} /></button>
        </div>
      ))}
    </div>
  )
}
