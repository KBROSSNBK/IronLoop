import { useEffect, useRef } from 'react';
import { BALANCE, deriveStats } from '../config/balance';
import { DEBUG_ENABLED } from '../config/env';
import { MACHINE_LIST } from '../config/machines';
import { SPAWN, STATIONS, TILE } from '../config/world';
import { factoryProgress, currentStamina } from './logic/progression';
import { Camera } from './engine/camera';
import { Fx } from './engine/fx';
import {
  attachInput,
  consumeActions,
  input,
  pollInput,
} from './engine/input';
import {
  findNearestInteractable,
  machineFrontPoint,
  moveWithCollision,
  type Interactable,
} from './world/geometry';
import {
  drawConveyors,
  drawLighting,
  drawPostFx,
  drawProps,
  drawStations,
  getStaticLayer,
} from './render/world';
import { computeMachineVisuals, drawMachine, drawRobots } from './render/machines';
import { drawCharacter, drawNameTag } from './render/character';
import { resolveActions, idleHint, type ActionOption } from './systems/interaction';
import { useSessionStore, reportSprintStamina } from '../state/useSessionStore';
import { useGameplayStore } from '../state/useGameplayStore';
import { useUiStore } from '../state/useUiStore';
import { on } from '../services/bus';
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
    };
    const remotes = new Map<string, RemoteEntity>();
    let lastPresenceRef: PresenceState[] | null = null;

    let running = true;
    let last = performance.now();
    let viewW = 0;
    let viewH = 0;
    let dpr = 1;
    let sprintDrain = 0;
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
      on('float', ({ text, color, kind }) => {
        const palette: Record<string, string> = {
          money: '#fbbf24',
          xp: '#a78bfa',
          item: '#7dd3fc',
          bad: '#f87171',
        };
        fx.float(
          me.x + (Math.random() - 0.5) * 14,
          me.y - 50,
          text,
          color ?? palette[kind ?? 'item'] ?? '#e2e8f0',
          kind === 'money' ? 15 : 13,
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
        const args: Record<string, unknown> =
          opt.kind === 'gather'
            ? { stationId: opt.targetId }
            : opt.kind === 'sell'
              ? {}
              : { machineId: opt.targetId };
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
          e.lastAt = now;
        }
      }
      for (const [uid, e] of remotes) {
        if (!seen.has(uid) && now - e.lastAt > BALANCE.net.staleAfterMs) {
          remotes.delete(uid);
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
      let staminaNow = player ? currentStamina(player, now) - sprintDrain : 100;
      staminaNow = Math.max(0, Math.min(stats.maxStamina, staminaNow));

      const busyAction = nowMs < actionUntil;
      const canSprint = input.sprint && staminaNow > 1 && !busyAction;
      const speed =
        stats.speed * (canSprint ? BALANCE.player.sprintMultiplier : 1) * (busyAction ? 0.15 : 1);

      if (input.x !== 0 || input.y !== 0) {
        const res = moveWithCollision(me.x, me.y, input.x * speed * dt, input.y * speed * dt);
        me.x = res.x;
        me.y = res.y;
        if (Math.abs(input.x) > Math.abs(input.y)) me.dir = input.x > 0 ? 'right' : 'left';
        else me.dir = input.y > 0 ? 'down' : 'up';
        if (!busyAction) me.act = canSprint ? 'run' : 'walk';
        if (canSprint) {
          sprintDrain += BALANCE.player.sprintStaminaCost * dt;
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
      if (sprintDrain > 0) reportSprintStamina(staminaNow);

      /* — presencia — */
      if (player && factory) {
        session.publishPresence({
          uid: player.uid,
          name: player.name,
          level: player.level,
          x: Math.round(me.x),
          y: Math.round(me.y),
          dir: me.dir,
          act: me.act,
          appearance: player.appearance,
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

      /* — interacción — */
      target = findNearestInteractable(me.x, me.y, BALANCE.actions.range);
      if (player && factory) {
        actions = resolveActions({ player, factory, target, now });
      } else {
        actions = [];
      }

      const queued = consumeActions();
      for (const slot of queued) {
        const idx = slot === 'primary' ? 0 : 1;
        const opt = actions[idx];
        if (opt) void runAction(opt);
      }
      // Mantener pulsado repite la acción principal si es sostenible.
      if (input.primaryHeld && !busyAction && !pendingOp && actions[0]?.holdable) {
        void runAction(actions[0]);
      }

      /* — cámara y efectos — */
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

      // Suelo estático pre-rasterizado
      const staticLayer = getStaticLayer(level);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(staticLayer, 0, 0);
      ctx.imageSmoothingEnabled = true;

      drawConveyors(ctx, level, time);

      const ratio = factory ? factoryProgress(factory).ratio : 0;
      drawStations(ctx, time, level, ratio);

      // Ordenación por profundidad: máquinas, props y personajes
      const sortables: { y: number; draw: () => void }[] = [];

      if (factory) {
        for (const v of computeMachineVisuals(factory.machines, level, now)) {
          sortables.push({
            y: (v.def.ty + v.def.th - 1) * TILE,
            draw: () => drawMachine(ctx, v, time, fx),
          });
        }
      }
      sortables.push({ y: -1e9, draw: () => drawProps(ctx, time) });
      sortables.push({ y: 1e8, draw: () => drawRobots(ctx, level, time) });

      for (const e of remotes.values()) {
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
            }),
        });
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
            }),
        });
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
      }
      if (player) drawNameTag(ctx, me.x, me.y, player.name, player.level, true);
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
