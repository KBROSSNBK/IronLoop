import { useSessionStore } from '../../state/useSessionStore';
import { useGameplayStore } from '../../state/useGameplayStore';
import { useUiStore } from '../../state/useUiStore';
import { getFactoryLevel } from '../../config/factoryLevels';
import { factoryProgress, levelProgress, xpForLevel } from '../../game/logic/progression';
import { compact, moneyExact } from '../../utils/format';

export function TopHud() {
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const stamina = useGameplayStore((s) => s.stamina);
  const staminaMax = useGameplayStore((s) => s.staminaMax);
  const online = useGameplayStore((s) => s.onlineCount);
  const setPanel = useUiStore((s) => s.setPanel);

  if (!player || !factory) return null;

  const xpRatio = levelProgress(player.level, player.xp);
  const staRatio = staminaMax > 0 ? stamina / staminaMax : 0;
  const fp = factoryProgress(factory);
  const def = getFactoryLevel(factory.level);

  return (
    <div className="hud-top">
      <div className="hud-card hud-identity bevel-sm scan">
        <div className="hud-row">
          {player.photoURL ? (
            <img className="hud-avatar" src={player.photoURL} alt="" />
          ) : (
            <div className="hud-avatar" style={{ display: 'grid', placeItems: 'center', fontSize: 14 }}>
              👷
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="hud-name">{player.name}</div>
            <div className="hud-level">NIVEL {player.level}</div>
          </div>
          <div className="hud-money mono-num" title={moneyExact(player.money)}>
            ${compact(player.money)}
          </div>
        </div>

        {/* Dos medidores compactos en fila: ocupan mucho menos ancho que
            dos barras a lo largo de toda la tarjeta. */}
        <div className="hud-meters">
          <div className="hud-meter">
            <div className="hud-meter-label">
              <span>XP</span>
              <span className="mono-num">
                {compact(player.xp)}/{compact(xpForLevel(player.level))}
              </span>
            </div>
            <div className="bar">
              <i style={{ width: `${xpRatio * 100}%`, background: 'var(--grad-violet)' }} />
            </div>
          </div>

          <div className="hud-meter">
            <div className="hud-meter-label">
              <span>EST</span>
              <span className="mono-num">
                {Math.round(stamina)}/{Math.round(staminaMax)}
              </span>
            </div>
            <div className="bar">
              <i
                style={{
                  width: `${staRatio * 100}%`,
                  background:
                    staRatio < 0.2
                      ? 'linear-gradient(135deg,#f87171,#dc2626)'
                      : 'linear-gradient(135deg,#4ade80,#16a34a)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <button className="hud-card hud-factory bevel-sm scan" onClick={() => setPanel('factory')}>
        <div className="hud-factory-title">
          <span>🏭 NIVEL {factory.level}</span>
          <span className="hud-online">
            <i className="dot" />
            {online}
          </span>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--text-mute)', letterSpacing: '0.06em' }}>
          {def.title.toUpperCase()}
        </div>
        <div className="bar" style={{ height: 7 }}>
          <i style={{ width: `${fp.ratio * 100}%`, background: 'var(--grad-cyan)' }} />
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--text-mute)', textAlign: 'right' }} className="mono-num">
          {compact(fp.contribution)} / {compact(fp.needed)}
        </div>
      </button>
    </div>
  );
}
