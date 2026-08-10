import { useUiStore } from '../../state/useUiStore';

/** Sugerencia de girar el móvil: el juego está pensado para landscape. */
export function OrientationHint() {
  const show = useUiStore((s) => s.landscapeHint);
  const setLandscapeHint = useUiStore((s) => s.setLandscapeHint);
  if (!show) return null;

  return (
    <div className="orientation">
      <div>
        <div className="phone" style={{ margin: '0 auto 22px' }} />
        <div className="logo" style={{ fontSize: 30 }}>
          GIRA EL MÓVIL
        </div>
        <p className="tagline" style={{ marginTop: 12 }}>
          IRONLOOP está diseñado para jugarse en horizontal. Gira el dispositivo para
          ver la fábrica completa y tener el joystick a mano.
        </p>
        <button
          className="btn btn-ghost"
          style={{ marginTop: 18 }}
          onClick={() => setLandscapeHint(false)}
        >
          Continuar en vertical
        </button>
      </div>
    </div>
  );
}
