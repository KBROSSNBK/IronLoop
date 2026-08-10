import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { useUiStore } from '../../state/useUiStore';
import { getBackend } from '../../services/backend';
import { createPlayerState } from '../../game/logic/defaults';
import { DEBUG_ENABLED } from '../../config/env';
import { ITEM_LIST } from '../../config/items';
import { getFactoryLevel } from '../../config/factoryLevels';

/**
 * Panel de desarrollo. Sólo se monta si DEBUG_ENABLED (dev local o flag
 * explícito). En producción, además, las Security Rules impiden que un
 * cliente escriba estos campos directamente.
 */
export function DebugPanel() {
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const pushToast = useUiStore((s) => s.pushToast);

  if (!DEBUG_ENABLED || !player || !factory) return null;

  const patchPlayer = async (patch: Record<string, unknown>) => {
    const b = await getBackend();
    await b.debugPatchPlayer?.(player.uid, patch);
    pushToast({ title: 'DEBUG aplicado', icon: '🧪', tone: 'info' });
  };

  const patchFactory = async (patch: Record<string, unknown>) => {
    const b = await getBackend();
    await b.debugPatchFactory?.(factory.id, patch);
    pushToast({ title: 'DEBUG fábrica', icon: '🧪', tone: 'info' });
  };

  const addItems = () => {
    const inv = { ...player.inventory };
    for (const item of ITEM_LIST) inv[item.id] = (inv[item.id] ?? 0) + 25;
    void patchPlayer({ inventory: inv });
  };

  return (
    <Panel icon="🧪" title="DEBUG / ADMIN">
      <div className="notice">
        Herramientas de desarrollo. Sólo activas en entorno local o con{' '}
        <code>VITE_ENABLE_DEBUG=true</code>.
      </div>

      <div className="section-title">JUGADOR</div>
      <div className="debug-grid">
        <button className="btn" onClick={() => void patchPlayer({ money: player.money + 10000 })}>
          +$10.000
        </button>
        <button className="btn" onClick={() => void patchPlayer({ money: player.money + 1000000 })}>
          +$1.000.000
        </button>
        <button className="btn" onClick={() => void patchPlayer({ level: player.level + 1, xp: 0 })}>
          +1 nivel
        </button>
        <button className="btn" onClick={() => void patchPlayer({ level: player.level + 10, xp: 0 })}>
          +10 niveles
        </button>
        <button
          className="btn"
          onClick={() => void patchPlayer({ stamina: 9999, staminaAt: Date.now() })}
        >
          Estamina llena
        </button>
        <button className="btn" onClick={addItems}>
          +25 de cada item
        </button>
        <button className="btn" onClick={() => void patchPlayer({ inventory: {} })}>
          Vaciar inventario
        </button>
        <button
          className="btn"
          onClick={() =>
            void patchPlayer({
              lastOfflineClaimAt: Date.now() - 4 * 3600 * 1000,
            })
          }
        >
          Simular 4h offline
        </button>
      </div>

      <div className="section-title">FÁBRICA — nivel actual {factory.level}</div>
      <div className="debug-grid">
        <button
          className="btn"
          onClick={() =>
            void patchFactory({
              contribution: getFactoryLevel(factory.level).xpToNext - 1,
            })
          }
        >
          Casi subir nivel
        </button>
        <button
          className="btn"
          onClick={() => void patchFactory({ level: factory.level + 1, contribution: 0 })}
        >
          +1 nivel fábrica
        </button>
        <button
          className="btn"
          onClick={() => void patchFactory({ level: factory.level + 3, contribution: 0 })}
        >
          +3 niveles fábrica
        </button>
        <button
          className="btn"
          onClick={() => void patchFactory({ level: 1, contribution: 0, totalContribution: 0 })}
        >
          Reset fábrica
        </button>
      </div>

      <div className="section-title">PELIGROSO</div>
      <button
        className="btn"
        style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
        onClick={() => {
          if (!confirm('¿Resetear TU progreso personal? La fábrica no se toca.')) return;
          const fresh = createPlayerState({
            uid: player.uid,
            displayName: player.name,
            photoURL: player.photoURL,
            email: null,
          });
          void patchPlayer({ ...fresh, factoryId: player.factoryId });
        }}
      >
        Resetear jugador
      </button>
    </Panel>
  );
}
