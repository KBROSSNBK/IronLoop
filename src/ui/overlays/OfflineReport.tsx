import { useSessionStore } from '../../state/useSessionStore';
import { getFactoryLevel } from '../../config/factoryLevels';
import { compact, duration, moneyExact } from '../../utils/format';

export function OfflineReport() {
  const report = useSessionStore((s) => s.offlineReport);
  const dismiss = useSessionStore((s) => s.dismissOfflineReport);
  if (!report) return null;

  const def = getFactoryLevel(report.factoryLevel);

  return (
    <div className="modal-scrim">
      <div className="modal bevel">
        <h2>MIENTRAS ESTABAS FUERA…</h2>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
          La fábrica siguió trabajando durante <b>{duration(report.seconds)}</b> gracias a
          la automatización de nivel {report.factoryLevel} ({def.title}).
        </div>

        <Line icon="⚙️" label="Producción" value={`+${compact(report.units)}`} />
        <Line icon="💰" label="Ganancias" value={`+${moneyExact(report.money)}`} />
        <Line icon="⭐" label="Experiencia" value={`+${compact(report.xp)} XP`} />
        <Line icon="🤖" label="Robots trabajando" value={String(report.robots)} />

        <button className="btn btn-primary" onClick={dismiss}>
          Recoger recompensa
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>
          Sube el nivel de la fábrica para aumentar la producción offline.
        </div>
      </div>
    </div>
  );
}

function Line({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="offline-line bevel-sm">
      <span>
        {icon} {label}
      </span>
      <span className="v mono-num">{value}</span>
    </div>
  );
}
