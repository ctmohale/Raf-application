import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

const ToastContext = createContext(null);

const toastIcons = {
  success: CheckCircle2,
  error: TriangleAlert,
  info: Info
};

const toastTitles = {
  success: 'Done',
  error: 'Needs attention',
  info: 'Notice'
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const lastToastRef = useRef({ key: '', time: 0 });

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type = 'info', title, message, duration = 4500 }) => {
      const safeMessage = String(message || '').trim();
      if (!safeMessage) return null;

      const safeType = ['success', 'error', 'info'].includes(type) ? type : 'info';
      const key = `${safeType}:${title || ''}:${safeMessage}`;
      const now = Date.now();

      if (lastToastRef.current.key === key && now - lastToastRef.current.time < 900) {
        return null;
      }

      lastToastRef.current = { key, time: now };

      const id = `${now}-${Math.random().toString(36).slice(2)}`;
      const toast = {
        id,
        type: safeType,
        title: title || toastTitles[safeType],
        message: safeMessage
      };

      setToasts((current) => [...current.slice(-4), toast]);

      if (duration > 0) {
        window.setTimeout(() => dismissToast(id), duration);
      }

      return id;
    },
    [dismissToast]
  );

  const value = useMemo(
    () => ({
      showToast,
      dismissToast,
      success: (message, options = {}) => showToast({ ...options, type: 'success', message }),
      error: (message, options = {}) => showToast({ ...options, type: 'error', message }),
      info: (message, options = {}) => showToast({ ...options, type: 'info', message })
    }),
    [dismissToast, showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="status" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => {
          const Icon = toastIcons[toast.type] || Info;

          return (
            <div className={`toast-card ${toast.type}`} key={toast.id}>
              <span className="toast-icon" aria-hidden="true">
                <Icon size={19} strokeWidth={2.4} />
              </span>
              <div className="toast-copy">
                <strong>{toast.title}</strong>
                <span>{toast.message}</span>
              </div>
              <button
                className="toast-close"
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={16} strokeWidth={2.4} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: () => null,
      dismissToast: () => null,
      success: () => null,
      error: () => null,
      info: () => null
    };
  }

  return context;
}
