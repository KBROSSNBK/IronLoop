import { useEffect } from 'react';
import { useUiStore, type PanelId } from '../../state/useUiStore';
import { useSessionStore } from '../../state/useSessionStore';
import { onPanelHotkey } from '../../game/engine/input';
import { isMissionComplete } from '../../game/logic/progression';
import { DEBUG_ENABLED } from '../../config/env';
import { playSfx } from '../../services/audio';

interface RailItem {
  id: Exclude<PanelId, null>;
  icon: string;
  key: string;
  title: string;
}

const ITEMS: RailItem[] = [
  { id: 'inventory', icon: '🎒', key: 'I', title: 'Inventario' },
  { id: 'upgrades', icon: '🛠️', key: 'U', title: 'Mejoras' },
  { id: 'missions', icon: '🎯', key: 'M', title: 'Misiones' },
  { id: 'factory', icon: '🏭', key: 'F', title: 'Fábrica' },
  { id: 'character', icon: '👷', key: 'C', title: 'Personaje' },
  { id: 'ranking', icon: '🏆', key: 'R', title: 'Ranking' },
];

export function SideRail() {
  const panel = useUiStore((s) => s.panel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const setPanel = useUiStore((s) => s.setPanel);
  const player = useSessionStore((s) => s.player);

  useEffect(() => onPanelHotkey((p) => togglePanel(p)), [togglePanel]);

  const missionsReady = player?.missions.filter(isMissionComplete).length ?? 0;

  return (
    <nav className="rail">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className={`rail-btn bevel-sm${panel === it.id ? ' active' : ''}`}
          title={`${it.title} (${it.key})`}
          aria-label={it.title}
          onClick={() => {
            playSfx('click');
            togglePanel(it.id);
          }}
        >
          <span>{it.icon}</span>
          <span className="key">{it.key}</span>
          {it.id === 'missions' && missionsReady > 0 && (
            <span className="badge">{missionsReady}</span>
          )}
        </button>
      ))}
      <button
        className={`rail-btn bevel-sm${panel === 'settings' ? ' active' : ''}`}
        title="Ajustes"
        aria-label="Ajustes"
        onClick={() => {
          playSfx('click');
          togglePanel('settings');
        }}
      >
        ⚙️
      </button>
      {DEBUG_ENABLED && (
        <button
          className={`rail-btn bevel-sm${panel === 'debug' ? ' active' : ''}`}
          title="Debug"
          aria-label="Debug"
          onClick={() => setPanel(panel === 'debug' ? null : 'debug')}
        >
          🧪
        </button>
      )}
    </nav>
  );
}
