import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { usePos } from '../store';

export function ToastStack() {
  const toasts = usePos((state) => state.toasts);
  const dismiss = usePos((state) => state.dismissToast);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          <span className="toast-icon">
            {toast.tone === 'success' ? <CheckCircle2 size={20} />
              : toast.tone === 'warn' || toast.tone === 'error' ? <AlertTriangle size={20} />
                : <Info size={20} />}
          </span>
          <span>{toast.text}</span>
          <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Tutup">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
