import { useEffect } from 'react';
import { GameCanvas } from '../game/GameCanvas';
import { TopHud } from './hud/TopHud';
import { SideRail } from './hud/SideRail';
import { ActionBar } from './hud/ActionBar';
import { Joystick } from './hud/Joystick';
import { EmoteWheel } from './hud/EmoteWheel';
import { Toasts } from './hud/Toasts';
import { InventoryPanel } from './panels/InventoryPanel';
import { UpgradesPanel } from './panels/UpgradesPanel';
import { MissionsPanel } from './panels/MissionsPanel';
import { FactoryPanel } from './panels/FactoryPanel';
import { CharacterPanel } from './panels/CharacterPanel';
import { RankingPanel } from './panels/RankingPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { DebugPanel } from './panels/DebugPanel';
import { OfflineReport } from './overlays/OfflineReport';
import { FactoryCelebration } from './overlays/FactoryCelebration';
import { useUiStore } from '../state/useUiStore';
import { useGameplayStore } from '../state/useGameplayStore';
import { on } from '../services/bus';
import { playSfx } from '../services/audio';

export function GameScreen() {
  const panel = useUiStore((s) => s.panel);
  const isTouch = useUiStore((s) => s.isTouch);
  const showFps = useUiStore((s) => s.showFps);
  const fps = useGameplayStore((s) => s.fps);
  const writes = useGameplayStore((s) => s.writes);
  const pushToast = useUiStore((s) => s.pushToast);

  // Puente bus → audio y toasts globales.
  useEffect(() => {
    const offs = [
      on('sfx', ({ name, volume }) => playSfx(name as never, volume)),
      on('toast', (t) => pushToast({ ...t, tone: t.tone ?? 'info' })),
    ];
    return () => offs.forEach((o) => o());
  }, [pushToast]);

  return (
    <>
      <GameCanvas />
      <TopHud />
      <SideRail />
      <ActionBar />
      <EmoteWheel />
      {isTouch && <Joystick />}
      <Toasts />
      {showFps && (
        <div className="fps-badge">
          <span>{fps} FPS</span>
          {/*
            Lo que queda del plan gratuito antes de que la partida se muera con
            un «Quota exceeded». Según dónde viva el estado se agota una cosa u
            otra: escrituras al día en Firestore, datos al mes en la Realtime
            Database. El medidor enseña la que toca.
          */}
          <span
            className="quota"
            data-level={writes.ratio > 0.9 ? 'alto' : writes.ratio > 0.6 ? 'medio' : 'bajo'}
            title={writes.detail}
          >
            {writes.mode === 'data' ? '📡' : '✍'} {writes.left}
            {Number.isFinite(writes.minutesLeft) && writes.minutesLeft < 6000 && (
              <b> · {Math.floor(writes.minutesLeft)} min</b>
            )}
          </span>
        </div>
      )}

      {panel === 'inventory' && <InventoryPanel />}
      {panel === 'upgrades' && <UpgradesPanel />}
      {panel === 'missions' && <MissionsPanel />}
      {panel === 'factory' && <FactoryPanel />}
      {panel === 'character' && <CharacterPanel />}
      {panel === 'ranking' && <RankingPanel />}
      {panel === 'settings' && <SettingsPanel />}
      {panel === 'debug' && <DebugPanel />}

      <OfflineReport />
      <FactoryCelebration />
    </>
  );
}
