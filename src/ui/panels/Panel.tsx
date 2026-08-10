import { useEffect, type ReactNode } from 'react';
import { useUiStore } from '../../state/useUiStore';
import { playSfx } from '../../services/audio';

interface Props {
  icon: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Panel({ icon, title, children, footer }: Props) {
  const setPanel = useUiStore((s) => s.setPanel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPanel]);

  const close = () => {
    playSfx('click');
    setPanel(null);
  };

  return (
    <div className="panel-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <section className="panel" role="dialog" aria-label={title}>
        <header className="panel-head">
          <span className="icon">{icon}</span>
          <h2>{title}</h2>
          <button className="panel-close" onClick={close} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="panel-body">{children}</div>
        {footer && <footer className="panel-foot">{footer}</footer>}
      </section>
    </div>
  );
}
