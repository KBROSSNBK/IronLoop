import { useGameplayStore } from '../../state/useGameplayStore';
import { useUiStore } from '../../state/useUiStore';
import { pressAction, releaseAction } from '../../game/engine/input';
import { playSfx } from '../../services/audio';
import type { ActionOption } from '../../game/systems/interaction';

const HOTKEYS = ['E', 'Q', ''];

export function ActionBar() {
  const actions = useGameplayStore((s) => s.actions);
  const progress = useGameplayStore((s) => s.actionProgress);
  const holdProgress = useGameplayStore((s) => s.holdProgress);
  const autoAction = useGameplayStore((s) => s.autoAction);
  const hint = useGameplayStore((s) => s.hint);
  const isTouch = useUiStore((s) => s.isTouch);
  const setPanel = useUiStore((s) => s.setPanel);

  const trigger = (opt: ActionOption, index: number) => {
    if (opt.disabled) {
      playSfx('error');
      return;
    }
    if (opt.kind === 'openFactory' || opt.kind === 'openMachine') {
      setPanel('factory');
      return;
    }
    if (opt.kind === 'openUpgrades') {
      setPanel('upgrades');
      return;
    }
    pressAction(index === 0 ? 'primary' : 'secondary');
  };

  if (actions.length === 0) {
    return hint ? <div className="hint-bubble">{hint}</div> : null;
  }

  return (
    <div className="action-bar">
      {actions.slice(0, 3).map((opt, i) => (
        <button
          key={`${opt.kind}-${opt.targetId}`}
          className="action-btn bevel-sm"
          style={{ ['--btn-accent' as string]: opt.color }}
          data-disabled={opt.disabled ? 'true' : 'false'}
          onPointerDown={(e) => {
            e.preventDefault();
            trigger(opt, i);
          }}
          onPointerUp={() => releaseAction(i === 0 ? 'primary' : 'secondary')}
          onPointerLeave={() => releaseAction(i === 0 ? 'primary' : 'secondary')}
          title={opt.disabled ?? opt.label}
        >
          <span className="glyph">{opt.icon}</span>
          <span className="txt">
            <span className="label">{opt.label}</span>
            <span className="sub">{opt.disabled ?? opt.sub}</span>
          </span>
          {!isTouch && HOTKEYS[i] && <span className="hotkey">{HOTKEYS[i]}</span>}
          {i === 0 && autoAction === opt.label && <span className="auto-badge">♾️ AUTO</span>}
          {i === 0 && progress > 0 && progress < 1 && (
            <span className="progress" style={{ width: `${progress * 100}%` }} />
          )}
          {/* Aro de carga hacia el modo automático al mantener pulsado */}
          {i === 0 && holdProgress > 0 && (
            <span className="hold-fill" style={{ width: `${holdProgress * 100}%` }} />
          )}
        </button>
      ))}

      {actions[0]?.holdable && !autoAction && (
        <span className="auto-tip">Mantén pulsado 3 s para automático</span>
      )}
    </div>
  );
}
