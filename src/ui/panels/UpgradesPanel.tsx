import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { UPGRADE_LIST, upgradeCost } from '../../config/upgrades';
import { moneyExact } from '../../utils/format';

export function UpgradesPanel() {
  const player = useSessionStore((s) => s.player);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  if (!player) return null;

  return (
    <Panel
      icon="🛠️"
      title="MEJORAS PERSONALES"
      footer={
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Tu dinero</span>
          <span className="mono-num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--amber-soft)' }}>
            {moneyExact(player.money)}
          </span>
        </div>
      }
    >
      <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Estas mejoras son <b>sólo tuyas</b>. Además, un <b>35%</b> de lo que gastas
        alimenta el progreso de la fábrica compartida.
      </div>

      {UPGRADE_LIST.map((def) => {
        const level = player.upgrades[def.id] ?? 0;
        const maxed = level >= def.maxLevel;
        const cost = upgradeCost(def, level);
        const locked = player.level < def.unlockLevel;
        const afford = player.money >= cost;
        return (
          <div
            className="upg-card"
            key={def.id}
            data-locked={locked}
            style={{ ['--upg-color' as string]: def.accent }}
          >
            <div className="upg-icon">{def.icon}</div>
            <div className="upg-main">
              <div className="upg-name">
                {def.name} <span style={{ color: 'var(--text-mute)' }}>Nv.{level}</span>
              </div>
              <div className="upg-effect">
                {locked ? `🔒 Requiere nivel ${def.unlockLevel}` : def.effect(level) || def.desc}
              </div>
              <div className="upg-pips">
                {Array.from({ length: Math.min(def.maxLevel, 15) }, (_, i) => (
                  <i key={i} className={i < Math.min(level, 15) ? 'on' : ''} />
                ))}
              </div>
            </div>
            <button
              className={`upg-buy${maxed ? ' max' : ''}`}
              disabled={busy || maxed || locked || !afford}
              onClick={() => void op('buyUpgrade', { upgradeId: def.id })}
            >
              {maxed ? 'MÁX' : locked ? '🔒' : moneyExact(cost)}
            </button>
          </div>
        );
      })}
    </Panel>
  );
}
