import { useEffect, useRef } from 'react';
import { BALANCE, deriveStats } from '../config/balance';
import { DEBUG_ENABLED } from '../config/env';
import { MACHINE_LIST } from '../config/machines';
import { SPAWN, STATIONS, TILE, isOffworld } from '../config/world';
import { factoryProgress, currentStamina } from './logic/progression';
import { SprintDrain } from './logic/stamina';
import { settleFactory } from './logic/robots';
import { Camera } from './engine/camera';
import { Fx } from './engine/fx';
import {
  attachInput,
  consumeActions,
  consumeEmote,
  input,
  pollInput,
} from './engine/input';
import { getEmote } from '../config/emotes';
import {
  conveyorAccepts,
  conveyorUnder,
  findNearestInteractable,
  isInsideSellArea,
  machineFrontPoint,
  moveWithCollision,
  type Interactable,
} from './world/geometry';
import { CONVEYORS, conveyorLoadPoint } from '../config/world';
import { beltCount } from './logic/belts';
import { getMachine } from '../config/machines';
import { ROBOTS as ROBOT_LIST } from '../config/robots';
import { RobotBrain } from './systems/robotBrain';
import { PetBrain, RemotePet } from './systems/petBrain';
import { drawPet } from './render/pet';
import {
  derivePet,
  deriveDrones,
  dogTarget,
  petUsed,
  PET_FLUSH_MS,
} from '../config/pets';
import { DroneBrain } from './systems/droneBrain';
import { drawDrone } from './render/drone';
import { dropOffFor, heaviestItem } from './logic/pet';
import {
  drawConveyors,
  drawGroundItems,
  drawLighting,
  drawPostFx,
  drawProps,
  drawStations,
  getStaticLayer,
} from './render/world';
import { getItem, itemGlyph } from '../config/items';
import { inventoryFree } from './logic/progression';
import { computeMachineVisuals, drawMachine, drawRobots } from './render/machines';
import { drawCharacter, drawEmoteBubble, drawNameTag } from './render/character';
import { resolveActions, idleHint, type ActionOption } from './systems/interaction';
import { useSessionStore, applyLocalStamina } from '../state/useSessionStore';
import { useGameplayStore } from '../state/useGameplayStore';
import { useUiStore } from '../state/useUiStore';
import { emit, on } from '../services/bus';
import type { ActivityKind, FacingDir, PresenceState } from '../types';

interface RemoteEntity {
  uid: string;
  name: string;
  level: number;
  appearance: PresenceState['appearance'];
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  lerpStart: number;
  dir: FacingDir;
  act: ActivityKind;
  animTime: number;
  lastAt: number;
  emote: string | null;
  emoteAt: number;
  pet: PresenceState['pet'];
}

export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    /* ── estado local del bucle ── */
    const cam = new Camera();
    const fx = new Fx();
    const me = {
      x: SPAWN.x,
      y: SPAWN.y,
      dir: 'down' as FacingDir,
      act: 'idle' as ActivityKind,
      animTime: 0,
      emote: null as string | null,
      emoteAt: 0,
    };
    const remotes = new Map<string, RemoteEntity>();
    let lastPresenceRef: PresenceState[] | null = null;

    let running = true;
    let last = performance.now();
    let viewW = 0;
    let viewH = 0;
    let dpr = 1;
    /* Estamina gastada esprintando y aún no consolidada por el servidor.
       Se lleva aparte porque contarla dos veces dejaba al jugador clavado
       a 0 de estamina para el resto de la partida (ver logic/stamina.ts). */
    const sprintDrain = new SprintDrain();
    let staminaFlushAt = 0;
    let actionUntil = 0;
    let actionStart = 0;
    let actionKind: ActionOption['kind'] | null = null;
    let uiAccumulator = 0;
    let fpsAccumulator = 0;
    let frames = 0;
    let fps = 0;
    let target: Interactable | null = null;
    let actions: ActionOption[] = [];
    let pendingOp = false;

    /* Modo automático: mantener pulsada la acción principal durante
       AUTO_HOLD_MS la deja "enganchada" y se sigue repitiendo sola aunque
       sueltes el botón. Se corta al volver a pulsar, al alejarse o cuando
       la acción deja de ser posible. */
    const AUTO_HOLD_MS = 3000;
    let primaryDownAt = 0;
    let prevPrimaryHeld = false;
    let holdProgress = 0;
    let autoAction: { kind: ActionOption['kind']; targetId: string; label: string } | null = null;
    let lastPublishAt = 0;

    /* Extracción automática: basta con quedarse quieto medio segundo junto a
       un yacimiento. Sólo aplica a extraer; máquinas y venta siguen siendo
       manuales a propósito, porque ahí sí interesa que decidas tú. */
    const AUTO_GATHER_MS = 500;
    let nearGatherSince = 0;
    /** Si lo cancelas a mano, no vuelve a engancharse hasta que te alejes. */
    let gatherSuppressed = false;
    /** Veta que hay que retomar en cuanto vuelva a haber sitio en la mochila. */
    let resumeGather: string | null = null;

    /* Recogida del suelo: una petición a la vez y sin reintentar el mismo
       montón en bucle mientras la transacción viaja. */
    let pendingPickup = false;
    const recentlyPicked = new Set<string>();

    /* Cintas: el material se traspasa solo, en tandas y con pausa entre ellas. */
    let pendingBelt = false;
    let beltCooldownUntil = 0;

    /* Cerebros de los robots: comportamiento visible con recuperación. */
    const brains = new Map<string, RobotBrain>();

    /* La foto viva de la fábrica y las acciones disponibles se recalculan a
       8 Hz, no por fotograma: son cálculos que copian estructuras enteras y
       cuyo resultado no cambia entre dos frames seguidos. */
    const LIVE_REFRESH_MS = 125;
    const ACTIONS_REFRESH_MS = 125;
    let live: ReturnType<typeof settleFactory> | null = null;
    let liveSource: unknown = null;
    let liveAt = 0;
    let actionsAt = 0;
    let lastTargetId: string | null = null;
    /* Destino de la carga de CADA perro: se refresca a ritmo lento. */
    const petDrops: (ReturnType<typeof dropOffFor> | null)[] = [];
    const petDropAt: number[] = [];
    const petDropItem: (string | null)[] = [];

    /*
     * JAURÍA. Un cerebro por perro: cada uno con su material encargado, su
     * veta y su ruta. La mochila, en cambio, es común, así que todos miran lo
     * que llevan los demás antes de seguir picando.
     */
    const pets: PetBrain[] = [new PetBrain(0)];
    const remotePets = new Map<string, RemotePet>();
    const petFlushAt: number[] = [];
    const petBusy: boolean[] = [];

    /* Escuadrilla de drones: uno por perro, más tu escolta. Van en dúo. */
    const drones: DroneBrain[] = [];

    /* ── canvas / DPR ── */
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      viewW = Math.max(1, Math.round(rect.width));
      viewH = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      cam.resize(viewW, viewH, TILE);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const detachInput = attachInput();

    /* ── feedback visual desde el bus ── */
    const offs = [
      on('float', ({ text, color, kind, group, amount, pre, post }) => {
        const palette: Record<string, string> = {
          money: '#fbbf24',
          xp: '#a78bfa',
          item: '#7dd3fc',
          bad: '#f87171',
        };
        // Sin desplazamiento aleatorio: los avisos salen alineados sobre la
        // cabeza y, si se repiten, se suman o se ordenan en columna.
        fx.float(
          me.x,
          me.y - 52,
          text,
          color ?? palette[kind ?? 'item'] ?? '#e2e8f0',
          kind === 'money' ? 15 : 13,
          group && amount !== undefined
            ? {
                key: group,
                amount,
                render: (total) =>
                  `${pre ?? ''}${Math.round(total).toLocaleString('es')}${post ?? ''}`,
              }
            : undefined,
        );
      }),
      on('burst', ({ x, y, color, count, power, kind }) =>
        fx.burst(x, y, color, count, power, kind),
      ),
      on('shake', ({ power }) => cam.shake(power)),
      on('levelUp', () => {
        fx.ring(me.x, me.y, '#a78bfa', 12);
        fx.burst(me.x, me.y - 6, '#c4b5fd', 26, 150, 'spark');
      }),
      on('factoryLevelUp', () => {
        cam.shake(14);
        fx.burst(me.x, me.y - 10, '#22d3ee', 40, 200, 'spark');
      }),
    ];

    /* ── ejecución de acciones ── */
    const runAction = async (opt: ActionOption) => {
      if (pendingOp || opt.disabled) return;
      const session = useSessionStore.getState();
      const ui = useUiStore.getState();

      switch (opt.kind) {
        case 'openFactory':
          ui.setPanel('factory');
          return;
        case 'openUpgrades':
          ui.setPanel('upgrades');
          return;
        case 'openMachine':
          ui.setPanel('factory');
          return;
        case 'teleport': {
          /*
           * LA NAVE. Es un salto puramente local: la posición ya viaja en la
           * presencia y el servidor valida cada acción por coordenadas, así
           * que no hace falta escribir nada para cambiar de mundo.
           *
           * Se lleva a la jauría y a la escuadrilla: son tuyos y no pueden
           * cruzar el vacío por su cuenta.
           */
          const pad = STATIONS.find((s) => s.id === opt.targetId);
          if (!pad?.to) return;
          const vuelve = isOffworld(pad.to.y) === false;
          fx.burst(me.x, me.y - 10, '#38bdf8', 26, 150, 'spark');
          fx.ring(me.x, me.y, '#38bdf8', 14);
          me.x = pad.to.x;
          me.y = pad.to.y;
          for (const p of pets) p.reset(me.x, me.y);
          for (const d of drones) d.reset(me.x, me.y);
          cam.snapTo(me.x, me.y);
          fx.burst(me.x, me.y - 10, '#38bdf8', 26, 150, 'spark');
          fx.ring(me.x, me.y, '#38bdf8', 16);
          emit('sfx', { name: 'mission' });
          emit('toast', {
            title: vuelve ? 'DE VUELTA EN LA ESTACIÓN' : 'HAS LLEGADO AL PLANETA',
            body: vuelve
              ? 'La lanzadera sigue mandando lo que se refine allí.'
              : 'Aquí sólo hay Mineral de Vacío y Gas Estelar. Lo refinado se manda solo.',
            icon: vuelve ? '🛰️' : '🚀',
            tone: 'good',
          });
          return;
        }
      }

      const player = session.player;
      if (!player) return;
      const stats = deriveStats(player.upgrades);
      const durations: Record<string, number> = {
        gather: BALANCE.actions.gather.durationMs,
        deposit: BALANCE.actions.deposit.durationMs,
        collect: BALANCE.actions.collect.durationMs,
        sell: BALANCE.actions.sell.durationMs,
      };
      const duration = (durations[opt.kind] ?? 300) * stats.actionSpeedMult;
      actionStart = performance.now();
      actionUntil = actionStart + duration;
      actionKind = opt.kind;
      me.act = opt.kind === 'gather' ? 'gather' : 'work';

      pendingOp = true;
      try {
        // La posición viaja SIEMPRE: el servidor comprueba que de verdad
        // estabas delante de la máquina, la cinta o el muelle.
        const at = { x: me.x, y: me.y };
        const args: Record<string, unknown> =
          opt.kind === 'gather'
            ? { stationId: opt.targetId, at }
            : opt.kind === 'sell'
              ? { at }
              : opt.beltId
                ? { machineId: opt.targetId, beltId: opt.beltId, at }
                : { machineId: opt.targetId, at };
        const out = await session.op(opt.kind, args);
        if (out.ok && target) {
          const color = opt.color;
          fx.burst(target.x, target.y - 10, color, 10, 90, 'spark');
          fx.ring(target.x, target.y - 10, color, 6);
        }
      } finally {
        pendingOp = false;
      }
    };

    /* ── sincronización de jugadores remotos ── */
    const syncRemotes = (list: PresenceState[], now: number) => {
      const seen = new Set<string>();
      for (const p of list) {
        seen.add(p.uid);
        const e = remotes.get(p.uid);
        if (!e) {
          remotes.set(p.uid, {
            uid: p.uid,
            name: p.name,
            level: p.level,
            appearance: p.appearance,
            x: p.x,
            y: p.y,
            fromX: p.x,
            fromY: p.y,
            toX: p.x,
            toY: p.y,
            lerpStart: now,
            dir: p.dir,
            act: p.act,
            animTime: Math.random() * 10,
            lastAt: now,
            emote: p.emote ?? null,
            emoteAt: p.emoteAt ?? 0,
            pet: p.pet ?? null,
          });
        } else {
          e.fromX = e.x;
          e.fromY = e.y;
          e.toX = p.x;
          e.toY = p.y;
          e.lerpStart = now;
          e.dir = p.dir;
          e.act = p.act;
          e.name = p.name;
          e.level = p.level;
          e.appearance = p.appearance;
          e.pet = p.pet ?? null;
          e.lastAt = now;
          // Un emote nuevo dispara sus partículas también en remoto.
          if (p.emote && (p.emoteAt ?? 0) > e.emoteAt) {
            const def = getEmote(p.emote);
            if (def?.particle) fx.burst(e.x, e.y - 20, def.particle, 12, 70, 'spark');
          }
          e.emote = p.emote ?? null;
          e.emoteAt = p.emoteAt ?? 0;
        }
      }
      for (const [uid, e] of remotes) {
        if (!seen.has(uid) && now - e.lastAt > BALANCE.net.staleAfterMs) {
          remotes.delete(uid);
          remotePets.delete(uid);
        }
      }
    };

    /* ── bucle principal ── */
    const frame = (nowMs: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const now = Date.now();

      const session = useSessionStore.getState();
      const player = session.player;
      const factory = session.factory;

      pollInput();

      /* — movimiento — */
      const stats = player
        ? deriveStats(player.upgrades)
        : deriveStats({});
      // En cuanto el servidor fija una línea base nueva, el acumulador local
      // se vacía: lo que ya está persistido no se vuelve a restar.
      if (player) sprintDrain.sync(player.staminaAt);
      const staminaNow = player
        ? sprintDrain.apply(currentStamina(player, now), stats.maxStamina)
        : 100;

      const busyAction = nowMs < actionUntil;
      const canSprint = input.sprint && staminaNow > 1 && !busyAction;
      // Sin fuelle se camina notablemente más lento: la estamina se nota.
      const exhausted = staminaNow <= 0.5;
      const speed =
        stats.speed *
        (canSprint ? BALANCE.player.sprintMultiplier : 1) *
        (busyAction ? 0.15 : 1) *
        (exhausted ? BALANCE.player.exhaustedSpeedMult : 1);

      if (input.x !== 0 || input.y !== 0) {
        const res = moveWithCollision(me.x, me.y, input.x * speed * dt, input.y * speed * dt, {
          human: true,
        });
        me.x = res.x;
        me.y = res.y;
        if (Math.abs(input.x) > Math.abs(input.y)) me.dir = input.x > 0 ? 'right' : 'left';
        else me.dir = input.y > 0 ? 'down' : 'up';
        if (!busyAction) me.act = canSprint ? 'run' : 'walk';
        if (canSprint) {
          sprintDrain.add(BALANCE.player.sprintStaminaCost * dt);
          if (Math.random() < dt * 8) {
            fx.burst(me.x, me.y + 14, 'rgba(148,163,184,0.9)', 1, 26, 'smoke');
          }
        }
      } else if (!busyAction) {
        me.act = staminaNow < 6 ? 'tired' : 'idle';
      }
      me.animTime += dt * (me.act === 'run' ? 1.3 : 1);

      if (busyAction) {
        me.act = actionKind === 'gather' ? 'gather' : 'work';
      } else if (actionKind) {
        actionKind = null;
      }

      // La estamina gastada al esprintar se consolida en el tick de sesión.
      // El gasto se consolida en memoria cada segundo: el jugador ve bajar y
      // subir la estamina al momento aunque el guardado real vaya al ritmo
      // lento del latido de sesión. Sin esto, tras esprintar te quedabas a 0
      // hasta el siguiente latido (y podía tardar un minuto).
      if (sprintDrain.pending > 0 && nowMs >= staminaFlushAt) {
        staminaFlushAt = nowMs + 1000;
        applyLocalStamina(staminaNow, now);
      }

      /* — emotes — */
      const emoteId = consumeEmote();
      let emoteJustStarted = false;
      if (emoteId) {
        const def = getEmote(emoteId);
        if (def) {
          me.emote = emoteId;
          me.emoteAt = now;
          emoteJustStarted = true;
          if (def.particle) fx.burst(me.x, me.y - 20, def.particle, 16, 85, 'spark');
          emit('sfx', { name: 'pickup' });
        }
      }
      const emoteDef = getEmote(me.emote);
      const emoteElapsed = me.emote ? (now - me.emoteAt) / 1000 : 0;
      if (emoteDef && emoteElapsed > emoteDef.durationMs / 1000) me.emote = null;
      // Chispas periódicas mientras dura un emote vistoso.
      if (emoteDef?.particle && me.emote && Math.random() < dt * 6) {
        fx.burst(me.x + (Math.random() - 0.5) * 20, me.y - 10, emoteDef.particle, 1, 40, 'spark');
      }

      /* — presencia — */
      // Sólo se emite a ritmo alto si hay algo que ver; parado basta un latido.
      const movingNow = input.x !== 0 || input.y !== 0;
      const publishNow =
        movingNow ||
        emoteJustStarted ||
        !!me.emote ||
        busyAction ||
        now - lastPublishAt >= BALANCE.net.idleHeartbeatMs;
      if (player && factory && publishNow) {
        lastPublishAt = now;
        session.publishPresence({
          uid: player.uid,
          name: player.name,
          level: player.level,
          x: Math.round(me.x),
          y: Math.round(me.y),
          dir: me.dir,
          act: me.act,
          appearance: player.appearance,
          // Sólo el aspecto: la posición de la mascota la simula cada cliente.
          pet:
            player.pet?.mode === 'off'
              ? null
              : {
                  chassis: player.pet?.chassis ?? 'spot',
                  color: player.pet?.color ?? '#f2c015',
                  accent: player.pet?.accent ?? '#22d3ee',
                },
          emote: me.emote,
          emoteAt: me.emoteAt,
          t: now,
        });
      }

      const presence = session.presence;
      if (presence !== lastPresenceRef) {
        lastPresenceRef = presence;
        syncRemotes(presence, nowMs);
      }
      for (const e of remotes.values()) {
        const k = Math.min(1, (nowMs - e.lerpStart) / BALANCE.net.interpolationMs);
        e.x = e.fromX + (e.toX - e.fromX) * k;
        e.y = e.fromY + (e.toY - e.fromY) * k;
        e.animTime += dt;
      }

      /* — recogida automática de objetos del suelo — */
      if (factory && !pendingPickup && player) {
        const ground = Object.values(factory.ground ?? {});
        for (const g of ground) {
          if (g.qty <= 0) continue;
          if (Math.hypot(g.x - me.x, g.y - me.y) > BALANCE.actions.pickupRange) continue;
          if (inventoryFree(player) <= 0) break; // mochila llena: se queda en el suelo
          if (recentlyPicked.has(g.id)) continue;
          pendingPickup = true;
          recentlyPicked.add(g.id);
          void session
            .op('pickupGround', { groundId: g.id, at: { x: me.x, y: me.y } })
            .then((out) => {
              if (out.ok) {
                fx.burst(g.x, g.y, getItem(g.item).color, 8, 60, 'spark');
                emit('sfx', { name: 'pickup' });
              }
            })
            .finally(() => {
              pendingPickup = false;
              // Se olvida enseguida: si quedó resto, se vuelve a intentar.
              window.setTimeout(() => recentlyPicked.delete(g.id), 700);
            });
          break;
        }
      }

      /* — cintas: traspaso automático al pasar por encima — */
      if (factory && player && !pendingBelt && nowMs >= beltCooldownUntil) {
        const belt = conveyorUnder(me.x, me.y, (c) => {
          if (factory.level < c.fromLevel) return false;
          const def = getMachine(c.feeds!);
          if (factory.level < def.unlockFactoryLevel) return false;
          return conveyorAccepts(c).some((i) => (player.inventory[i] ?? 0) > 0);
        });
        if (belt) {
          const item = conveyorAccepts(belt).find((i) => (player.inventory[i] ?? 0) > 0)!;
          const batch = Math.min(
            BALANCE.conveyor.autoTransferBatch,
            player.inventory[item] ?? 0,
          );
          pendingBelt = true;
          void session
            .op('deposit', {
              machineId: belt.feeds,
              beltId: belt.id,
              item,
              qty: batch,
              at: { x: me.x, y: me.y },
            })
            .then((out) => {
              if (out.ok) {
                const p = conveyorLoadPoint(belt);
                fx.burst(me.x, me.y - 6, getItem(item).color, 7, 55, 'spark');
                fx.ring(p.x, p.y, '#38bdf8', 8);
                emit('sfx', { name: 'machine', volume: 0.5 });
              }
            })
            .finally(() => {
              pendingBelt = false;
              beltCooldownUntil = performance.now() + BALANCE.conveyor.autoTransferCooldownMs;
            });
        }
      }

      /* — interacción — */
      // También a 8 Hz: `resolveActions` liquida máquinas para saber qué se
      // puede hacer, y eso no cambia entre dos fotogramas seguidos.
      target = findNearestInteractable(me.x, me.y, BALANCE.actions.range);
      if (player && factory) {
        if (nowMs >= actionsAt || target?.id !== lastTargetId) {
          actionsAt = nowMs + ACTIONS_REFRESH_MS;
          lastTargetId = target?.id ?? null;
          actions = resolveActions({ player, factory, target, now });
        }
      } else {
        actions = [];
        lastTargetId = null;
      }

      /* — pulsaciones y modo automático — */
      if (input.primaryHeld && !prevPrimaryHeld) primaryDownAt = nowMs;
      if (!input.primaryHeld) primaryDownAt = 0;
      prevPrimaryHeld = input.primaryHeld;

      const queued = consumeActions();
      for (const slot of queued) {
        // Con el modo automático activo, volver a pulsar lo cancela.
        if (slot === 'primary' && autoAction) {
          if (autoAction.kind === 'gather') gatherSuppressed = true;
          autoAction = null;
          primaryDownAt = 0;
          emit('toast', { title: 'AUTOMÁTICO DETENIDO', icon: '⏹️', tone: 'info' });
          emit('sfx', { name: 'click' });
          continue;
        }
        const opt = actions[slot === 'primary' ? 0 : 1];
        if (opt) void runAction(opt);
      }

      // Activación: 3 s manteniendo pulsada una acción repetible.
      const primary = actions[0];
      holdProgress =
        !autoAction && input.primaryHeld && primaryDownAt > 0 && primary?.holdable
          ? Math.min(1, (nowMs - primaryDownAt) / AUTO_HOLD_MS)
          : 0;

      if (!autoAction && holdProgress >= 1 && primary) {
        autoAction = { kind: primary.kind, targetId: primary.targetId, label: primary.label };
        holdProgress = 0;
        primaryDownAt = 0;
        emit('toast', {
          title: `AUTOMÁTICO: ${primary.label}`,
          body: 'Se repetirá solo. Pulsa de nuevo para parar.',
          icon: '♾️',
          tone: 'good',
        });
        emit('sfx', { name: 'mission' });
      }

      /* Enganche automático al quedarse quieto junto a un yacimiento. */
      const gatherOpt = actions.find((a) => a.kind === 'gather');
      const standingStill = input.x === 0 && input.y === 0;
      if (!gatherOpt) {
        nearGatherSince = 0;
        gatherSuppressed = false; // al alejarse se rearma
        resumeGather = null;
      } else if (!standingStill) {
        nearGatherSince = 0;
      } else if (nearGatherSince === 0) {
        nearGatherSince = nowMs;
      }

      /*
       * REANUDACIÓN AUTOMÁTICA. Si la extracción se paró SÓLO porque tenías la
       * mochila llena, en cuanto un dron te vacíe (o sueltes algo) se retoma
       * sola. Antes había que volver a pulsar, y con drones trabajando eso era
       * estar todo el rato pendiente del botón.
       */
      if (
        resumeGather &&
        !autoAction &&
        gatherOpt &&
        gatherOpt.targetId === resumeGather &&
        !gatherOpt.disabled
      ) {
        autoAction = { kind: 'gather', targetId: gatherOpt.targetId, label: gatherOpt.label };
        resumeGather = null;
        emit('toast', { title: 'EXTRACCIÓN REANUDADA', icon: '⛏️', tone: 'good' });
      }

      if (
        gatherOpt &&
        !gatherOpt.disabled &&
        !gatherSuppressed &&
        !autoAction &&
        nearGatherSince > 0 &&
        nowMs - nearGatherSince >= AUTO_GATHER_MS
      ) {
        autoAction = { kind: 'gather', targetId: gatherOpt.targetId, label: gatherOpt.label };
        emit('toast', {
          title: 'EXTRACCIÓN AUTOMÁTICA',
          body: 'Aléjate o pulsa la acción para parar.',
          icon: '⛏️',
          tone: 'good',
        });
      }

      if (autoAction) {
        const opt = actions.find(
          (a) => a.kind === autoAction!.kind && a.targetId === autoAction!.targetId,
        );
        if (!opt) {
          // Te has alejado o la acción ya no existe.
          autoAction = null;
        } else if (opt.disabled) {
          const reason = opt.disabled;
          const wasGather = autoAction.kind === 'gather';
          const porLleno = /llen[oa]/i.test(reason);
          autoAction = null;
          if (wasGather && porLleno) {
            // No es un fallo, es una pausa: alguien hará sitio enseguida.
            resumeGather = opt.targetId;
            emit('toast', {
              title: 'MOCHILA LLENA',
              body: 'Sigue sola en cuanto haya hueco.',
              icon: '🎒',
              tone: 'info',
            });
          } else {
            // Evita repetir el aviso mientras sigas plantado en la veta.
            if (wasGather) gatherSuppressed = true;
            emit('toast', { title: 'AUTOMÁTICO DETENIDO', body: reason, icon: '⏹️', tone: 'bad' });
          }
        } else if (!busyAction && !pendingOp) {
          void runAction(opt);
        }
      } else if (input.primaryHeld && !busyAction && !pendingOp && primary?.holdable) {
        // Mantener pulsado repite la acción principal aunque no llegue a 3 s.
        void runAction(primary);
      }

      /* — cámara y efectos — */
      /* — la fábrica al día: cintas entregan, máquinas producen, robots reparten.
           Es lo mismo que persiste `runOp`, así que lo que se ve coincide.

           NO se recalcula cada fotograma: liquidar la fábrica entera copia
           todas las máquinas, robots y cintas, y hacerlo 60 veces por segundo
           era la principal fuente de basura para el recolector (y de tirones).
           A 8 Hz el ojo no nota la diferencia: lo que se mueve suave son las
           animaciones, que interpolan por tiempo. — */
      if (factory && (factory !== liveSource || nowMs >= liveAt)) {
        liveSource = factory;
        liveAt = nowMs + LIVE_REFRESH_MS;
        live = settleFactory(factory, now);
      } else if (!factory) {
        live = null;
        liveSource = null;
      }

      /* — robots: máquina de estados con detección de bloqueo — */
      if (live) {
        const positions: { x: number; y: number }[] = [];
        for (const def of ROBOT_LIST) {
          const owned = (live.factory.robots?.[def.id]?.level ?? 0) > 0;
          if (!owned) {
            brains.delete(def.id);
            continue;
          }
          let brain = brains.get(def.id);
          if (!brain) {
            brain = new RobotBrain(def);
            brains.set(def.id, brain);
          }
          positions.push({ x: brain.x, y: brain.y });
        }
        for (const [id, brain] of brains) {
          const lvl = live.factory.robots?.[id]?.level ?? 0;
          const others = positions.filter((p) => p.x !== brain.x || p.y !== brain.y);
          brain.update(dt, live.working[id] ?? false, lvl, others);
        }
      }

      /* — jauría: cada perro a lo suyo, y deja el material donde sirve — */
      let petDerived = derivePet(undefined);
      let petStored = 0;
      let petPending = 0;
      let petTop: string | null = null;
      if (player && session.phase === 'ready') {
        petDerived = derivePet(player.pet);
        petStored = petUsed(player.pet);
        const packInv = player.pet?.inventory ?? {};
        petTop = heaviestItem(packInv);

        // Un cerebro por perro: se crean y se retiran según la jauría.
        while (pets.length < petDerived.dogs) pets.push(new PetBrain(pets.length));
        pets.length = Math.max(1, petDerived.dogs);

        const modo = player.pet?.mode ?? 'gather';
        const hayDrones = (player.pet?.drones ?? 0) > 0;
        const conHueco = inventoryFree(player) > 0;
        // La mochila es común: lo que uno lleva picado sin liquidar le quita
        // sitio a los demás, así que todos necesitan el total.
        petPending = pets.reduce((a, p) => a + p.pending, 0);

        for (let i = 0; i < pets.length; i++) {
          const dog = pets[i];
          const encargo = dogTarget(player.pet, i);
          /*
           * A dónde lleva lo que carga: primero SU material —el que le has
           * encargado— y si no lleva de ese, lo que más pese de la mochila
           * común. Recorre cintas y máquinas, así que se recalcula sólo al
           * cambiar de material o cada medio segundo.
           */
          const suyo = encargo && (packInv[encargo] ?? 0) > 0 ? encargo : petTop;
          if (!suyo || !factory) {
            petDrops[i] = null;
            petDropItem[i] = null;
          } else if (suyo !== petDropItem[i] || nowMs >= (petDropAt[i] ?? 0)) {
            petDropItem[i] = suyo;
            petDropAt[i] = nowMs + 500;
            petDrops[i] = dropOffFor(suyo, factory.level, { x: dog.x, y: dog.y });
          }

          const ev = dog.update(now, {
            dt,
            ownerX: me.x,
            ownerY: me.y,
            derived: petDerived,
            storedUnits: petStored,
            otherPending: petPending - dog.pending,
            mode: modo,
            target: encargo,
            hasDrones: hayDrones,
            ownerHasRoom: conHueco,
            dropOff: petDrops[i] ?? null,
          });

          if (ev.strike) {
            fx.burst(ev.strike.x, ev.strike.y, ev.strike.color, 2, 45, 'spark');
          }

          // Lo minado se liquida por tandas: una escritura cada 5 s como
          // mucho, o antes si la mochila ya está a tope.
          if (
            ev.mined &&
            !petBusy[i] &&
            (nowMs >= (petFlushAt[i] ?? 0) || petStored + petPending >= petDerived.capacity)
          ) {
            petFlushAt[i] = nowMs + PET_FLUSH_MS;
            petBusy[i] = true;
            const qty = ev.mined.qty;
            void session
              .op('petMine', { stationId: ev.mined.stationId, qty })
              .then((out) => {
                // Confirmado o rechazado, deja de contarse como pendiente: el
                // servidor es quien manda sobre lo que hay en la mochila.
                if (out.ok) dog.confirmMined(qty);
                else dog.dropPending();
              })
              .finally(() => {
                petBusy[i] = false;
              });
          }

          if (ev.deposit && !petBusy[i]) {
            petBusy[i] = true;
            const bay = ev.deposit;
            void session
              .op('petDeposit', { machineId: bay.machineId, beltId: bay.beltId })
              .then((out) => {
                if (out.ok) {
                  fx.burst(dog.x, dog.y - 12, '#38bdf8', 10, 70, 'spark');
                  fx.ring(bay.x, bay.y, '#38bdf8', 8);
                  emit('sfx', { name: 'machine', volume: 0.5 });
                }
              })
              .finally(() => {
                petBusy[i] = false;
              });
          }

          if (ev.unload && !petBusy[i]) {
            petBusy[i] = true;
            void session
              .op('petUnload', {})
              .then((out) => {
                if (out.ok) {
                  fx.burst(dog.x, dog.y - 12, '#a78bfa', 10, 70, 'spark');
                  fx.ring(me.x, me.y, '#a78bfa', 7);
                  emit('sfx', { name: 'pickup', volume: 0.5 });
                }
              })
              .finally(() => {
                petBusy[i] = false;
              });
          }
        }

        /*
         * ESCUADRILLA. Van en DÚO: el dron 0 es tu escolta y cada uno de los
         * demás trabaja con su perro. En cada viaje se llevan de TODO lo que
         * haya —al menos una unidad de cada material— y reparten por varias
         * paradas si hace falta, así que nada se queda criando polvo.
         */
        const squad = deriveDrones(player.pet);
        while (drones.length < squad.count) drones.push(new DroneBrain(drones.length));
        drones.length = squad.count;

        const sinReservar = (
          inv: Record<string, number>,
          fuente: 'pet' | 'player',
          salvo: DroneBrain,
        ) => {
          const out: Record<string, number> = {};
          for (const [item, qty] of Object.entries(inv)) {
            let libre = Math.floor(qty);
            for (const o of drones) {
              if (o === salvo || o.source !== fuente) continue;
              libre -= o.cargo[item] ?? 0;
            }
            if (libre > 0) out[item] = libre;
          }
          return out;
        };

        for (let i = 0; i < drones.length; i++) {
          const d = drones[i];
          // Su pareja: el dron 0 va contigo, el resto con su perro.
          const pareja = pets[Math.min(pets.length - 1, Math.max(0, i - 1))];
          const dev = d.update({
            dt,
            dogX: pareja.x,
            dogY: pareja.y,
            dogItems: sinReservar(packInv, 'pet', d),
            playerItems:
              player.pet?.droneTakesPlayer === false
                ? {}
                : sinReservar(player.inventory, 'player', d),
            prefer: i === 0 ? 'player' : 'pet',
            carry: squad.carry,
            speed: squad.speed,
            ownerX: me.x,
            ownerY: me.y,
            factoryLevel: factory?.level ?? 1,
            now,
          });
          if (dev.deliver) {
            const { bay, items, units, source } = dev.deliver;
            void session
              .op(source === 'pet' ? 'petDeposit' : 'droneHaul', {
                machineId: bay.machineId,
                beltId: bay.beltId,
                items,
                limit: units,
              })
              .then((out) => {
                if (out.ok) {
                  fx.burst(d.x, d.y + 12, '#38bdf8', 8, 60, 'spark');
                  fx.ring(bay.x, bay.y, '#38bdf8', 7);
                  emit('sfx', { name: 'machine', volume: 0.4 });
                }
              });
          }
        }
      }

      /* Mascotas ajenas: sólo siguen a su dueño, no se sincroniza su posición. */
      for (const e of remotes.values()) {
        if (!e.pet) {
          remotePets.delete(e.uid);
          continue;
        }
        let rp = remotePets.get(e.uid);
        if (!rp) {
          rp = new RemotePet();
          remotePets.set(e.uid, rp);
        }
        rp.update(dt, e.x, e.y);
      }

      cam.follow(me.x, me.y - 10, dt, viewW, viewH);
      fx.update(dt);

      /* — render — */
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, viewW, viewH);
      cam.apply(ctx, viewW, viewH);

      const view = cam.visibleRect(viewW, viewH);
      const level = factory?.level ?? 1;
      const time = nowMs / 1000;

      // Suelo estático pre-rasterizado.
      // Sólo se copia el trozo VISIBLE: el mapa entero son 1920×1360 píxeles y
      // volcarlo completo en cada fotograma es un blit de 2,6 millones de
      // píxeles que no se ve — en móvil se notaba muchísimo.
      const staticLayer = getStaticLayer(level);
      const sx = Math.max(0, Math.floor(view.x));
      const sy = Math.max(0, Math.floor(view.y));
      const sw = Math.min(staticLayer.width - sx, Math.ceil(view.w) + 2);
      const sh = Math.min(staticLayer.height - sy, Math.ceil(view.h) + 2);
      ctx.imageSmoothingEnabled = false;
      if (sw > 0 && sh > 0) ctx.drawImage(staticLayer, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.imageSmoothingEnabled = true;

      if (live) drawConveyors(ctx, live.factory, time, now);

      const ratio = factory ? factoryProgress(factory).ratio : 0;
      drawStations(ctx, time, level, ratio);
      if (factory) drawGroundItems(ctx, factory.ground ?? {}, time);

      // Ordenación por profundidad: máquinas, props y personajes
      const sortables: { y: number; draw: () => void }[] = [];

      if (live) {
        const liveFactory = live.factory;
        for (const v of computeMachineVisuals(liveFactory.machines, level, now)) {
          sortables.push({
            y: (v.def.ty + v.def.th - 1) * TILE,
            draw: () => drawMachine(ctx, v, time, fx),
          });
        }
        sortables.push({
          y: 1e8,
          draw: () => drawRobots(ctx, liveFactory, brains, time),
        });
      }
      sortables.push({ y: -1e9, draw: () => drawProps(ctx, time) });

      for (const e of remotes.values()) {
        const rp = remotePets.get(e.uid);
        if (rp && e.pet) {
          const look = e.pet;
          sortables.push({
            y: rp.y,
            draw: () =>
              drawPet(ctx, {
                x: rp.x,
                y: rp.y,
                facing: rp.facing,
                gait: rp.gait,
                t: time,
                state: 'SEGUIR',
                chassis: look.chassis,
                color: look.color,
                accent: look.accent,
                carried: 0,
                capacity: 1,
                alpha: 0.96,
              }),
          });
        }
        sortables.push({
          y: e.y,
          draw: () =>
            drawCharacter(ctx, {
              x: e.x,
              y: e.y,
              dir: e.dir,
              act: e.act,
              t: e.animTime,
              appearance: e.appearance,
              name: e.name,
              level: e.level,
              isLocal: false,
              alpha: 0.98,
              emote: e.emote,
              emoteElapsed: e.emote ? (now - e.emoteAt) / 1000 : 0,
            }),
        });
      }
      if (player && player.pet?.mode !== 'off') {
        // Carga de la jauría: confirmada más lo picado sin liquidar.
        const carried = petStored + Math.floor(petPending);
        /*
         * Cada perro se dibuja donde de verdad está: van cada uno a su veta,
         * así que no hay formación calcada. El contador de la mochila lo
         * enseña sólo el primero, porque la mochila es una y es de todos.
         */
        for (let i = 0; i < pets.length; i++) {
          const dog = pets[i];
          // Lo que enseña en la espalda: su material encargado si lleva, y
          // si no, lo que más pese de la mochila común.
          const encargo = dogTarget(player.pet, i);
          const suyo =
            encargo && (player.pet?.inventory?.[encargo] ?? 0) > 0 ? encargo : petTop;
          sortables.push({
            y: dog.y,
            draw: () =>
              drawPet(ctx, {
                x: dog.x,
                y: dog.y,
                facing: dog.facing,
                gait: dog.gait,
                t: time + i * 0.9,
                state: dog.state,
                chassis: player.pet?.chassis ?? 'spot',
                color: player.pet?.color ?? '#f2c015',
                accent: player.pet?.accent ?? '#22d3ee',
                carried: i === 0 ? carried : 0,
                capacity: petDerived.capacity,
                carryIcon: suyo ? itemGlyph(suyo) : null,
                carryColor: suyo ? getItem(suyo).color : null,
              }),
          });
        }
      }
      if (player) {
        sortables.push({
          y: me.y,
          draw: () =>
            drawCharacter(ctx, {
              x: me.x,
              y: me.y,
              dir: me.dir,
              act: me.act,
              t: me.animTime,
              appearance: player.appearance,
              name: player.name,
              level: player.level,
              isLocal: true,
              actionProgress: busyAction
                ? (nowMs - actionStart) / Math.max(1, actionUntil - actionStart)
                : undefined,
              emote: me.emote,
              emoteElapsed,
            }),
        });
      }
      // Los drones vuelan: siempre por encima del resto de la escena.
      if (player && player.pet?.mode !== 'off') {
        for (const d of drones) {
          sortables.push({
            y: 1e9,
            draw: () =>
              drawDrone(ctx, {
                x: d.x,
                y: d.y,
                facing: d.facing,
                bob: d.bob,
                t: time,
                state: d.state,
                color: player.pet?.color ?? '#c7ced8',
                accent: player.pet?.accent ?? '#22d3ee',
                tilt: d.tilt,
                load: d.load,
                loadIcon: d.item ? itemGlyph(d.item) : null,
                loadColor: d.item ? getItem(d.item).color : null,
              }),
          });
        }
      }

      sortables.sort((a, b) => a.y - b.y);
      for (const s of sortables) s.draw();

      // Aro de interacción sobre el objetivo
      if (target && actions.length > 0) {
        const pulse = 0.55 + Math.sin(time * 5) * 0.25;
        ctx.save();
        ctx.strokeStyle = actions[0].color;
        ctx.globalAlpha = pulse;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([7, 6]);
        ctx.lineDashOffset = -time * 22;
        ctx.beginPath();
        ctx.ellipse(target.x, target.y + 6, 30, 14, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      fx.draw(ctx);

      // Luces (incluye un foco suave sobre el jugador local)
      drawLighting(ctx, view, level, time, [
        { x: me.x, y: me.y, radius: 150, color: '160,200,255' },
      ]);

      // Etiquetas y números por encima de la iluminación
      for (const e of remotes.values()) {
        drawNameTag(ctx, e.x, e.y, e.name, e.level, false);
        if (e.emote) drawEmoteBubble(ctx, e.x, e.y, e.emote, (now - e.emoteAt) / 1000);
      }
      if (player) {
        drawNameTag(ctx, me.x, me.y, player.name, player.level, true);
        if (me.emote) drawEmoteBubble(ctx, me.x, me.y, me.emote, emoteElapsed);
      }
      fx.drawTexts(ctx);

      ctx.restore();

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPostFx(ctx, viewW, viewH);
      ctx.restore();

      /* — publicación hacia la UI (8 Hz) — */
      frames++;
      fpsAccumulator += dt;
      if (fpsAccumulator >= 0.5) {
        fps = Math.round(frames / fpsAccumulator);
        frames = 0;
        fpsAccumulator = 0;
      }
      uiAccumulator += dt;
      if (uiAccumulator >= 0.12) {
        uiAccumulator = 0;
        useGameplayStore.getState().publish({
          actions,
          targetLabel: target?.label ?? null,
          hint: player ? idleHint(player) : '',
          stamina: staminaNow,
          staminaMax: stats.maxStamina,
          fps,
          onlineCount: remotes.size + 1,
          actionProgress: busyAction
            ? (nowMs - actionStart) / Math.max(1, actionUntil - actionStart)
            : 0,
          holdProgress,
          autoAction: autoAction?.label ?? null,
          x: me.x,
          y: me.y,
          inSellArea: isInsideSellArea(me.x, me.y),
          // La instantánea de depuración sólo se calcula si va a mirarse.
          debug: DEBUG_ENABLED
            ? {
                robots: [...brains.values()].map((b) => b.debug()),
                pet: pets[0].debug(petDerived.capacity, petStored),
                belts: CONVEYORS.filter((c) => c.feeds).map((c) => ({
                  id: c.id,
                  count: beltCount(live?.factory.belts?.[c.id], c.id, now),
                })),
              }
            : useGameplayStore.getState().debug,
        });
      }

      requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);

    // Handle de desarrollo: teleport y estado del jugador desde la consola.
    // Sólo existe con DEBUG_ENABLED (dev local o VITE_ENABLE_DEBUG=true).
    if (DEBUG_ENABLED) {
      (window as unknown as { __ironloop?: unknown }).__ironloop = {
        teleport: (x: number, y: number) => {
          me.x = x;
          me.y = y;
        },
        goto: (id: string) => {
          const s = STATIONS.find((st) => st.id === id);
          if (s) {
            me.x = (s.tx + s.tw / 2) * TILE;
            me.y = (s.ty + s.th + 0.6) * TILE;
            return true;
          }
          const m = MACHINE_LIST.find((mm) => mm.id === id);
          if (m) {
            const p = machineFrontPoint(m);
            me.x = p.x;
            me.y = p.y + 10;
            return true;
          }
          return false;
        },
        where: () => ({ x: Math.round(me.x), y: Math.round(me.y) }),
        stamina: () => ({
          /** Gasto de sprint aún sin consolidar. Debe volver a 0 al persistir. */
          pendiente: +sprintDrain.pending.toFixed(2),
        }),
        petState: () =>
          pets.map((p, i) => ({
            perro: i + 1,
            x: Math.round(p.x),
            y: Math.round(p.y),
            state: p.state,
            pending: p.pending,
            station: p.station?.id ?? null,
          })),
        droneState: () =>
          drones.map((d, i) => ({
            dron: i + 1,
            state: d.state,
            source: d.source,
            cargo: { ...d.cargo },
          })),
        emoteState: () => ({
          id: me.emote,
          elapsed: me.emote ? (Date.now() - me.emoteAt) / 1000 : 0,
        }),
        remotes: () =>
          [...remotes.values()].map((r) => ({ name: r.name, emote: r.emote })),
      };
    }

    return () => {
      running = false;
      ro.disconnect();
      detachInput();
      offs.forEach((off) => off());
    };
  }, []);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Fábrica" />;
}
