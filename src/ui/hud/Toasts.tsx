import { useUiStore } from '../../state/useUiStore';

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast bevel-sm" data-tone={t.tone}>
          {t.icon && <span className="icon">{t.icon}</span>}
          <div className="txt">
            <div className="title">{t.title}</div>
            {t.body && <div className="body">{t.body}</div>}
          </div>
          {/* Repetido: en vez de apilar tarjetas iguales, se cuenta. */}
          {t.count > 1 && <span className="times mono-num">×{t.count}</span>}
        </div>
      ))}
    </div>
  );
}
