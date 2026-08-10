import { useEffect } from 'react';
import { useUiStore } from '../../state/useUiStore';
import { useSessionStore } from '../../state/useSessionStore';
import { getFactoryLevel } from '../../config/factoryLevels';
import { invalidateStaticLayer } from '../../game/render/world';

/** Celebración a pantalla completa cuando la fábrica sube de nivel. */
export function FactoryCelebration() {
  const level = useUiStore((s) => s.factoryCelebration);
  const celebrate = useUiStore((s) => s.celebrateFactory);
  const factory = useSessionStore((s) => s.factory);

  useEffect(() => {
    if (level === null) return;
    // La nave cambia de aspecto: hay que re-rasterizar la capa estática.
    invalidateStaticLayer();
    const id = window.setTimeout(() => celebrate(null), 2600);
    return () => window.clearTimeout(id);
  }, [level, celebrate]);

  if (level === null) return null;
  const def = getFactoryLevel(level);

  return (
    <div className="celebration">
      <div className="big">
        <span className="small">{factory?.name ?? 'FÁBRICA'}</span>
        NIVEL {level}
        <span className="small" style={{ marginTop: 8 }}>
          {def.title}
        </span>
        <span
          className="small"
          style={{ fontSize: '0.28em', color: 'var(--amber-soft)', marginTop: 6 }}
        >
          {def.unlocks.join(' · ')}
        </span>
      </div>
    </div>
  );
}
