import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { getMissionDef } from '../../config/missions';
import { FACTORY_OBJECTIVES } from '../../config/factoryLevels';
import { getItem } from '../../config/items';
import { compact, moneyExact } from '../../utils/format';

export function MissionsPanel() {
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  if (!player || !factory) return null;

  const objectives = FACTORY_OBJECTIVES.filter((o) => factory.level >= o.fromLevel);

  return (
    <Panel icon="🎯" title="MISIONES">
      <div className="section-title">TUS MISIONES</div>
      {player.missions.map((m) => {
        const def = getMissionDef(m.id);
        if (!def) return null;
        const done = m.progress >= def.target;
        const ratio = Math.min(1, m.progress / def.target);
        return (
          <div className="mission" key={m.id} data-done={done}>
            <span className="ico">{def.icon}</span>
            <div className="main">
              <div className="title">{def.title}</div>
              <div className="bar" style={{ margin: '5px 0 4px' }}>
                <i
                  style={{
                    width: `${ratio * 100}%`,
                    background: done ? 'var(--grad-lime)' : 'var(--grad-cyan)',
                  }}
                />
              </div>
              <div className="prog">
                {compact(m.progress)} / {compact(def.target)}
                <span className="rew">
                  {'  '}· {moneyExact(def.reward.money)} · {def.reward.xp} XP
                  {def.reward.items &&
                    Object.keys(def.reward.items).map((i) => ` · ${getItem(i).icon}`)}
                </span>
              </div>
            </div>
            <button
              className="btn btn-sm btn-primary"
              disabled={!done || busy}
              onClick={() => void op('claimMission', { missionId: m.id })}
            >
              {done ? 'Cobrar' : '…'}
            </button>
          </div>
        );
      })}

      <div className="section-title">OBJETIVOS DE FÁBRICA (COOPERATIVOS)</div>
      {objectives.length === 0 && (
        <div className="empty-note">Sube el nivel de la fábrica para desbloquear objetivos.</div>
      )}
      {objectives.map((o) => {
        const raw = factory.objectives[o.id] ?? 0;
        const complete = raw < 0;
        const value = complete ? o.target : raw;
        const ratio = Math.min(1, value / o.target);
        return (
          <div className="mission" key={o.id} data-done={complete}>
            <span className="ico">{complete ? '✅' : '🏭'}</span>
            <div className="main">
              <div className="title">{o.title}</div>
              <div className="bar" style={{ margin: '5px 0 4px' }}>
                <i style={{ width: `${ratio * 100}%`, background: 'var(--grad-amber)' }} />
              </div>
              <div className="prog">
                {compact(value)} / {compact(o.target)}
                <span className="rew"> · +{compact(o.rewardContribution)} a la fábrica</span>
              </div>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
