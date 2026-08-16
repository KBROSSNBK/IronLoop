import { useState } from 'react';
import { Panel } from './Panel';
import { useSessionStore } from '../../state/useSessionStore';
import { UPGRADE_LIST, isUnlimited, upgradeCost } from '../../config/upgrades';
import {
  ROBOT_CONTRIB_RATIO,
  ROBOT_MODES,
  robotCarry,
  robotCost,
  robotRate,
} from '../../config/robots';
import { getMachine } from '../../config/machines';
import { getItem } from '../../config/items';
import { robotStatuses } from '../../game/logic/robots';
import { PET_TARGETS } from '../../game/logic/pet';
import {
  DEFAULT_PET,
  PET_ACCENTS,
  PET_CHASSIS,
  PET_COLORS,
  PET_MODES,
  PET_STATS,
  PACK,
  derivePet,
  deriveDrones,
  dogCost,
  dogTarget,
  droneCost,
  droneSlots,
  droneUpgradeCost,
  isPetStatUnlimited,
  getChassis,
  petStatCost,
  petUsed,
} from '../../config/pets';
import { compact, moneyExact } from '../../utils/format';

type Tab = 'mejoras' | 'mascota' | 'robots';

/**
 * TALLER: mejoras personales y flota de robots. Es el único sitio donde se
 * compra automatización, para que el jugador sepa siempre dónde mirar.
 */
export function UpgradesPanel() {
  const player = useSessionStore((s) => s.player);
  const factory = useSessionStore((s) => s.factory);
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);
  const [tab, setTab] = useState<Tab>('mejoras');

  if (!player || !factory) return null;

  return (
    <Panel
      icon="🛠️"
      title="TALLER"
      footer={
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Tu dinero</span>
          <span className="mono-num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--amber-soft)' }}>
            {moneyExact(player.money)}
          </span>
        </div>
      }
    >
      <div className="rank-tabs">
        <button className="rank-tab bevel-sm" data-on={tab === 'mejoras'} onClick={() => setTab('mejoras')}>
          🧰 Personaje
        </button>
        <button className="rank-tab bevel-sm" data-on={tab === 'mascota'} onClick={() => setTab('mascota')}>
          🐕 Mascota
        </button>
        <button className="rank-tab bevel-sm" data-on={tab === 'robots'} onClick={() => setTab('robots')}>
          🤖 Robots
        </button>
      </div>

      {tab === 'mejoras' ? (
        <>
          <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Estas mejoras son <b>sólo tuyas</b>. Además, un <b>35%</b> de lo que gastas
            alimenta el progreso de la fábrica compartida.
          </div>

          {UPGRADE_LIST.map((def) => {
            const level = player.upgrades[def.id] ?? 0;
            // Las mejoras sin tope nunca llegan a "MÁX": siempre hay siguiente.
            const maxed = !isUnlimited(def) && level >= def.maxLevel;
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
                    {Array.from({ length: 15 }, (_, i) => (
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
        </>
      ) : tab === 'mascota' ? (
        <PetTab />
      ) : (
        <>
          <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Los robots <b>no extraen</b>: eso sigue siendo cosa vuestra. Lo que hacen es
            el paseo aburrido, moviendo material de una máquina a la siguiente por las
            cintas, incluso con la fábrica vacía. Son <b>compartidos</b>: quien los paga
            beneficia a todos, y el <b>{Math.round(ROBOT_CONTRIB_RATIO * 100)}%</b> del
            coste va al núcleo.
          </div>

          {robotStatuses(factory).map(({ def, state, owned, available, status }) => {
            const cost = robotCost(def, state.level);
            const maxed = state.level >= def.maxLevel;
            const afford = player.money >= cost;
            const from = getMachine(def.from);
            const to = def.to ? getMachine(def.to) : null;
            const item = getItem(def.item);
            const mode = state.mode ?? (def.to ? 'belt' : 'sell');

            const statusText: Record<typeof status, string> = {
              locked: `🔒 Requiere fábrica nivel ${def.unlockFactoryLevel}`,
              idle: 'Sin desplegar',
              working: mode === 'sell' ? '💰 Vendiendo' : '🟢 Transportando',
              'no-source': '⏸ Esperando material en origen',
              off: '⏸️ Detenido por el operario',
            };

            return (
              <div
                className="machine-card"
                key={def.id}
                style={{ ['--m-color' as string]: def.accent }}
              >
                <div className="head">
                  <span style={{ fontSize: 18 }}>{def.icon}</span>
                  <span className="nm">{def.name}</span>
                  {owned && <span className="chip">Nv.{state.level}</span>}
                </div>

                <div className="recipe">
                  {from.icon} {from.short} → {item.icon} →{' '}
                  {to ? `${to.icon} ${to.short}` : '💰 VENTA'}
                </div>
                <div className="stat">{def.desc}</div>
                <div className="stat">{statusText[status]}</div>

                {owned && (
                  <>
                    <div className="stat">
                      Lleva <b className="mono-num">{robotCarry(def, state.level)}</b> {item.name} por
                      viaje · <b className="mono-num">{robotRate(def, state.level)}</b>/min
                    </div>
                    <div className="stat">
                      Transportado: <b className="mono-num">{compact(state.moved)}</b>
                      {(state.sold ?? 0) > 0 && (
                        <>
                          {' '}
                          · Vendido: <b className="mono-num">{moneyExact(state.sold ?? 0)}</b>
                        </>
                      )}
                    </div>

                    {/* Control de operación: repartir, vender o parar. */}
                    <div className="robot-modes">
                      {ROBOT_MODES.map((m) => {
                        const disabled = m.id === 'belt' && !def.to;
                        return (
                          <button
                            key={m.id}
                            className="mode-btn"
                            data-on={mode === m.id}
                            disabled={busy || disabled}
                            title={disabled ? 'Este robot no tiene máquina de destino' : m.desc}
                            onClick={() => void op('setRobotMode', { robotId: def.id, mode: m.id })}
                          >
                            {m.icon} {m.label}
                          </button>
                        );
                      })}
                    </div>
                    {mode === 'sell' && (
                      <div className="stat" style={{ color: 'var(--amber-soft)' }}>
                        Lo que venda se reparte a partes iguales entre los operarios
                        conectados en ese momento.
                      </div>
                    )}
                  </>
                )}

                <button
                  className={`upg-buy${maxed ? ' max' : ''}`}
                  style={{ alignSelf: 'flex-start' }}
                  disabled={busy || !available || maxed || !afford}
                  onClick={() => void op('buyRobot', { robotId: def.id })}
                >
                  {!available
                    ? '🔒'
                    : maxed
                      ? 'NIVEL MÁX'
                      : `${owned ? 'MEJORAR' : 'DESPLEGAR'} · ${moneyExact(cost)}`}
                </button>

                {available && !maxed && (
                  <div className="stat" style={{ marginTop: -2 }}>
                    Al mejorar pasa a llevar{' '}
                    <b className="mono-num">{robotCarry(def, state.level + 1)}</b> por viaje (
                    {robotRate(def, state.level + 1)}/min) · aporta{' '}
                    {compact(Math.round(cost * ROBOT_CONTRIB_RATIO))} al núcleo
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </Panel>
  );
}

/**
 * MASCOTA: chasis, color y mejoras. Es individual —el chucho es tuyo— y todo
 * se compra aquí, igual que el resto de la progresión personal.
 */
function PetTab() {
  const player = useSessionStore((s) => s.player)!;
  const factory = useSessionStore((s) => s.factory)!;
  const op = useSessionStore((s) => s.op);
  const busy = useSessionStore((s) => s.busy);

  const pet = { ...DEFAULT_PET, ...(player.pet ?? {}) };
  const derived = derivePet(pet);
  const carried = petUsed(pet);
  const squad = deriveDrones(pet);
  const slots = droneSlots(pet);
  const owned = new Set([...DEFAULT_PET.owned, ...(pet.owned ?? [])]);
  const mode = pet.mode ?? 'gather';

  return (
    <>
      <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        En <b>Extraer</b> busca la zona más cercana, pica hasta llenar su mochila y deja
        el material en <b>su cinta o su máquina</b>, así que nunca se queda con carga
        muerta. En <b>Seguir</b> sólo te acompaña y te entrega lo que llevara encima. Es
        tuya: ni el material ni las mejoras se comparten.
      </div>

      <div className="pet-hero bevel-sm">
        <div className="ico">{getChassis(pet.chassis).icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nm">{getChassis(pet.chassis).name}</div>
          <div className="stat">{getChassis(pet.chassis).desc}</div>
        </div>
      </div>

      {/* Orden de trabajo: es lo que más se toca, así que va lo primero. */}
      <div className="robot-modes">
        {PET_MODES.map((m) => (
          <button
            key={m.id}
            className="mode-btn"
            data-on={mode === m.id}
            disabled={busy}
            title={m.desc}
            onClick={() => void op('setPetLook', { mode: m.id })}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>
      <div className="stat" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
        {PET_MODES.find((m) => m.id === mode)?.desc}
      </div>
      {/* La jauría: más perros = más ritmo y más mochila. */}
      <div className="section-title">JAURÍA</div>
      <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Cada perro va <b>a su mineral</b>: uno al cobre, otro al titanio, otro a la
        chatarra. Comparten mochila, así que sumar perros multiplica el ritmo y la carga.
        Cada uno lleva su dron, más otro que se queda contigo.
      </div>
      <div className="pet-stats">
        <Metric label="Perros" value={`${derived.dogs}/${PACK.max}`} accent="var(--amber-soft)" />
        <Metric
          label="Drones ideales"
          value={`${derived.dogs + 1}`}
          accent={squad.count >= derived.dogs + 1 ? 'var(--green)' : 'var(--red)'}
        />
        <Metric label="Mochila total" value={`${derived.capacity}`} accent="var(--blue)" />
      </div>
      <div className="robot-modes">
        <button
          className="mode-btn"
          disabled={busy || derived.dogs >= PACK.max || player.money < dogCost(derived.dogs)}
          onClick={() => void op('buyDog', {})}
        >
          {derived.dogs >= PACK.max
            ? '✅ Jauría completa'
            : `🐕 Sumar perro · ${moneyExact(dogCost(derived.dogs))}`}
        </button>
      </div>

      {/* Drones: el complemento del perro, no un sustituto. */}
      <div className="section-title">ESCUADRILLA DE DRONES</div>
      <div className="card accent" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        Van en <b>dúo</b>: uno por perro y uno para ti, ni más ni menos. No extraen — te
        quitan la carga <b>donde estés</b> y la reparten por las cintas y máquinas, de
        TODO lo que lleves y al menos una unidad de cada material, así que no se queda
        nada atrás. Subir su nivel les da <b>más carga y más velocidad</b>.
      </div>
      <div className="pet-stats">
        <Metric label="Drones" value={`${squad.count}/${slots}`} accent="var(--blue)" />
        <Metric label="Carga" value={`${squad.carry}/viaje`} accent="var(--amber-soft)" />
        <Metric label="Vuelo" value={`${squad.speed} px/s`} accent="var(--green)" />
      </div>
      <div className="robot-modes">
        <button
          className="mode-btn"
          disabled={busy || squad.count >= slots || player.money < droneCost(squad.count)}
          onClick={() => void op('buyDrone', {})}
        >
          {squad.count >= slots
            ? derived.dogs >= PACK.max
              ? '✅ Escuadrilla completa'
              : '🐕 Suma otro perro para otro dron'
            : `🛸 Comprar dron · ${moneyExact(droneCost(squad.count))}`}
        </button>
        <button
          className="mode-btn"
          disabled={
            busy || squad.count === 0 || player.money < droneUpgradeCost(squad.level)
          }
          title="Sube la carga y la velocidad de TODOS los drones"
          onClick={() => void op('buyDrone', { upgrade: true })}
        >
          {squad.count === 0
            ? '🔒 Necesitas un dron'
            : `⬆️ Nivel ${squad.level + 1} · ${moneyExact(droneUpgradeCost(squad.level))}`}
        </button>
      </div>
      {squad.count > 0 && (
        <>
          <div className="robot-modes">
            <button
              className="mode-btn"
              data-on={pet.droneTakesPlayer !== false}
              disabled={busy}
              title="Si lo apagas, sólo cogerán de la mascota"
              onClick={() =>
                void op('setPetLook', { droneTakesPlayer: pet.droneTakesPlayer === false })
              }
            >
              🎒 {pet.droneTakesPlayer === false ? 'No me vacían' : 'Me vacían a mí también'}
            </button>
          </div>
          <div className="stat" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
            {pet.droneTakesPlayer === false
              ? 'Sólo recogen de la mascota. Tu mochila es tuya.'
              : 'Te quitan de la mochila lo que alguna máquina consuma y lo llevan por ti.'}
          </div>
        </>
      )}


      {/* QUÉ extrae CADA PERRO. Se elige el material, no el sitio: importa
          qué te falta para la cadena, no dónde está la veta. */}
      <div className="section-title">QUÉ EXTRAE CADA PERRO</div>
      {Array.from({ length: derived.dogs }, (_, i) => {
        const actual = dogTarget(pet, i);
        const def = actual ? PET_TARGETS.find((t) => t.item === actual) : null;
        return (
          <div className="dog-row" key={i}>
            <div className="dog-head">
              <span className="dog-tag">🐕 Perro {i + 1}</span>
              <span className="dog-now">
                {def
                  ? `${getItem(def.item).icon} ${getItem(def.item).name}`
                  : '🎯 Lo que falte en la fábrica'}
              </span>
            </div>
            <div className="dog-picks">
              <button
                className="pick"
                data-on={!actual}
                disabled={busy || mode !== 'gather'}
                title="Automático: mira qué le falta a las máquinas y va a por ello"
                onClick={() => void op('setPetLook', { dog: i, target: null })}
              >
                🎯
              </button>
              {PET_TARGETS.map((t) => {
                const locked = factory.level < t.fromLevel;
                const it = getItem(t.item);
                return (
                  <button
                    key={t.item}
                    className="pick"
                    data-on={actual === t.item}
                    data-locked={locked}
                    disabled={busy || locked || mode !== 'gather'}
                    style={{ ['--z' as string]: it.color }}
                    title={
                      locked
                        ? `🔒 Fábrica nivel ${t.fromLevel}`
                        : t.onlyRobots
                          ? `${it.name} · ☢️ zona prohibida para personas`
                          : `${it.name} · ${t.stations.length} veta${t.stations.length === 1 ? '' : 's'}`
                    }
                    onClick={() => void op('setPetLook', { dog: i, target: t.item })}
                  >
                    {locked ? '🔒' : it.icon}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="stat" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
        🎯 <b>Automático</b> no es «lo que pille cerca»: mira <b>qué le falta a las
        máquinas</b> para arrancar y va a buscarlo, y si hay varios perros en
        automático cada uno coge una cosa distinta. Con un material fijo cruza el mapa
        hasta su veta. El ☢️ titanio del filón inestable sólo lo saca un robot: ahí no
        puedes entrar.
      </div>

      <div className="pet-stats">
        <Metric label="Mochila" value={`${carried}/${derived.capacity}`} accent="var(--blue)" />
        <Metric
          label="Extracción"
          value={`${(derived.minePerSec * 60).toFixed(0)}/min`}
          accent="var(--amber-soft)"
        />
        <Metric label="Velocidad" value={`${derived.speed} px/s`} accent="var(--green)" />
        <Metric label="Sensor" value={`${derived.radius} px`} accent="var(--violet)" />
        <Metric label="Extraído" value={compact(pet.mined ?? 0)} accent="var(--cyan)" />
        <Metric label="Chasis" value={String(owned.size)} accent="var(--pink)" />
      </div>

      <div className="section-title">COLOR</div>
      <div className="swatch-row">
        {PET_COLORS.map((c) => (
          <button
            key={c.id}
            className="swatch"
            data-on={pet.color === c.id}
            style={{ background: c.id }}
            title={c.name}
            disabled={busy}
            onClick={() => void op('setPetLook', { color: c.id })}
          />
        ))}
      </div>

      <div className="section-title">DETALLES</div>
      <div className="swatch-row">
        {PET_ACCENTS.map((c) => (
          <button
            key={c.id}
            className="swatch"
            data-on={pet.accent === c.id}
            style={{ background: c.id }}
            title={c.name}
            disabled={busy}
            onClick={() => void op('setPetLook', { accent: c.id })}
          />
        ))}
      </div>

      <div className="section-title">MEJORAS DE LA MASCOTA</div>
      {PET_STATS.map((def) => {
        const level = pet.stats?.[def.id] ?? 0;
        // Las mejoras sin tope nunca llegan a "MÁX": siempre hay siguiente.
        const maxed = !isPetStatUnlimited(def) && level >= def.maxLevel;
        const cost = petStatCost(def, level);
        const afford = player.money >= cost;
        return (
          <div className="upg-card" key={def.id} style={{ ['--upg-color' as string]: def.accent }}>
            <div className="upg-icon">{def.icon}</div>
            <div className="upg-main">
              <div className="upg-name">
                {def.name} <span style={{ color: 'var(--text-mute)' }}>Nv.{level}</span>
              </div>
              <div className="upg-effect">{level > 0 ? def.effect(level) : def.desc}</div>
              <div className="upg-pips">
                {Array.from({ length: Math.min(def.maxLevel, 15) }, (_, i) => (
                  <i key={i} className={i < Math.min(level, 15) ? 'on' : ''} />
                ))}
              </div>
            </div>
            <button
              className={`upg-buy${maxed ? ' max' : ''}`}
              disabled={busy || maxed || !afford}
              onClick={() => void op('buyPetStat', { stat: def.id })}
            >
              {maxed ? 'MÁX' : moneyExact(cost)}
            </button>
          </div>
        );
      })}


      <div className="section-title">CHASIS</div>
      {PET_CHASSIS.map((c) => {
        const has = owned.has(c.id);
        const equipped = pet.chassis === c.id;
        const locked = player.level < c.unlockLevel;
        const afford = player.money >= c.cost;
        return (
          <div
            className="upg-card"
            key={c.id}
            data-locked={locked && !has}
            style={{ ['--upg-color' as string]: c.color }}
          >
            <div className="upg-icon">{c.icon}</div>
            <div className="upg-main">
              <div className="upg-name">
                {c.name}
                {equipped && <span style={{ color: 'var(--green)' }}> · EQUIPADO</span>}
              </div>
              <div className="upg-effect">{c.desc}</div>
              <div className="upg-effect" style={{ color: 'var(--text-mute)' }}>
                ×{c.bonus.mining.toFixed(2)} extracción · ×{c.bonus.speed.toFixed(2)} velocidad
                · ×{c.bonus.capacity.toFixed(2)} carga
              </div>
            </div>
            <button
              className={`upg-buy${equipped ? ' max' : ''}`}
              disabled={busy || equipped || (!has && (locked || !afford))}
              onClick={() => void op('buyPetChassis', { chassis: c.id })}
            >
              {equipped
                ? 'EN USO'
                : has
                  ? 'EQUIPAR'
                  : locked
                    ? `🔒 Nv.${c.unlockLevel}`
                    : moneyExact(c.cost)}
            </button>
          </div>
        );
      })}
    </>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="pet-metric" style={{ ['--m' as string]: accent }}>
      <span className="l">{label}</span>
      <span className="v mono-num">{value}</span>
    </div>
  );
}
