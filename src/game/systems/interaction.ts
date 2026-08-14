/**
 * Resolución de acciones contextuales.
 * Decide qué hace el botón principal y el secundario según lo que el jugador
 * tenga delante y lo que lleve encima. La UI sólo pinta lo que aquí se decide.
 */

import { getMachine } from '../../config/machines';
import { getItem } from '../../config/items';
import type { FactoryState, PlayerState } from '../../types';
import type { Interactable } from '../world/geometry';
import { inputRoom, settleMachine } from '../logic/production';
import { inventoryFree, sellableItems } from '../logic/progression';

export type ActionKind =
  | 'gather'
  | 'deposit'
  | 'collect'
  | 'sell'
  | 'openFactory'
  | 'openUpgrades'
  | 'openMachine';

export interface ActionOption {
  kind: ActionKind;
  targetId: string;
  label: string;
  sub?: string;
  icon: string;
  color: string;
  /** Se puede mantener pulsado para repetir. */
  holdable: boolean;
  /** Motivo por el que no está disponible (se muestra en gris). */
  disabled?: string;
}

export interface ActionContext {
  player: PlayerState;
  factory: FactoryState;
  target: Interactable | null;
  now: number;
}

export function resolveActions(ctx: ActionContext): ActionOption[] {
  const { target, player, factory } = ctx;
  if (!target) return [];
  const options: ActionOption[] = [];

  if (target.kind === 'station' && target.station) {
    const s = target.station;
    switch (s.type) {
      case 'oreVein':
      case 'salvage': {
        // Misma mecánica y mismo sistema de items; cambia lo que rinde.
        const full = inventoryFree(player) <= 0;
        const yieldItem = s.yields?.[0]?.item ?? 'ore';
        options.push({
          kind: 'gather',
          targetId: s.id,
          label: s.type === 'salvage' ? 'RECOLECTAR' : 'EXTRAER',
          sub: getItem(yieldItem).name,
          icon: s.type === 'salvage' ? '♻️' : '⛏️',
          color: s.accent,
          holdable: true,
          disabled: full ? 'Inventario lleno' : undefined,
        });
        break;
      }
      case 'sell': {
        // La opción sólo existe estando junto al muelle; la operación además
        // vuelve a comprobar la posición, así que no basta con forzar la UI.
        const items = sellableItems(player.inventory);
        const units = Object.values(items).reduce((a, b) => a + b, 0);
        options.push({
          kind: 'sell',
          targetId: s.id,
          label: 'VENDER',
          sub: units > 0 ? `${units} unidad${units === 1 ? '' : 'es'}` : 'Nada que vender',
          icon: '💰',
          color: s.accent,
          holdable: false,
          disabled: units === 0 ? 'No llevas nada vendible' : undefined,
        });
        break;
      }
      case 'core':
        options.push({
          kind: 'openFactory',
          targetId: s.id,
          label: 'CONTRIBUIR',
          sub: `Fábrica nivel ${factory.level}`,
          icon: '🏭',
          color: s.accent,
          holdable: false,
        });
        break;
      case 'shop':
        options.push({
          kind: 'openUpgrades',
          targetId: s.id,
          label: 'MEJORAS',
          sub: 'Progresión personal',
          icon: '🛠️',
          color: s.accent,
          holdable: false,
        });
        break;
    }
    return options;
  }

  if (target.kind === 'conveyor' && target.conveyor) {
    const belt = target.conveyor;
    const machineId = belt.feeds!;
    const def = getMachine(machineId);
    const state = factory.machines[machineId];
    const beltOn = factory.level >= belt.fromLevel;
    const machineOn = factory.level >= def.unlockFactoryLevel;

    if (!beltOn || !machineOn || !state) {
      const need = Math.max(belt.fromLevel, def.unlockFactoryLevel);
      options.push({
        kind: 'deposit',
        targetId: machineId,
        label: 'CINTA PARADA',
        sub: `Requiere fábrica nivel ${need}`,
        icon: '🔌',
        color: '#64748b',
        holdable: false,
        disabled: 'Cinta sin energía',
      });
      return options;
    }

    const settled = settleMachine(state, machineId, factory.level, ctx.now);
    const loadable = Object.keys(def.input).filter(
      (item) => (player.inventory[item] ?? 0) > 0 && inputRoom(settled.state, machineId, item) > 0,
    );
    const carried = loadable.reduce((a, i) => a + (player.inventory[i] ?? 0), 0);

    options.push({
      kind: 'deposit',
      targetId: machineId,
      label: 'PONER EN CINTA',
      sub:
        loadable.length > 0
          ? `${loadable.map((i) => getItem(i).icon).join('')} ×${carried} → ${def.short}`
          : `Acepta ${Object.keys(def.input).map((i) => getItem(i).name).join(', ')}`,
      icon: '🛒',
      color: '#38bdf8',
      holdable: true,
      disabled:
        loadable.length === 0
          ? 'No llevas material para esta cinta'
          : undefined,
    });
    return options;
  }

  if (target.kind === 'machine' && target.machine) {
    const def = getMachine(target.id);
    const state = factory.machines[target.id];
    if (!state) return options;
    const locked = factory.level < def.unlockFactoryLevel;
    const settled = settleMachine(state, target.id, factory.level, ctx.now);

    if (locked) {
      options.push({
        kind: 'openMachine',
        targetId: target.id,
        label: 'BLOQUEADA',
        sub: `Requiere fábrica nivel ${def.unlockFactoryLevel}`,
        icon: '🔒',
        color: '#64748b',
        holdable: false,
        disabled: 'Bloqueada',
      });
      return options;
    }

    // ¿Puede cargar material?
    const loadable = Object.keys(def.input).filter(
      (item) =>
        (player.inventory[item] ?? 0) > 0 && inputRoom(settled.state, target.id, item) > 0,
    );
    const readyOutput = Object.entries(settled.state.output).filter(([, n]) => n > 0);

    if (loadable.length > 0) {
      const carried = loadable.reduce((a, i) => a + (player.inventory[i] ?? 0), 0);
      options.push({
        kind: 'deposit',
        targetId: target.id,
        label: 'CARGAR',
        sub: `${loadable.map((i) => getItem(i).icon).join('')} ×${carried}`,
        icon: '📥',
        color: '#38bdf8',
        holdable: true,
      });
    }

    if (readyOutput.length > 0) {
      const units = readyOutput.reduce((a, [, n]) => a + n, 0);
      options.push({
        kind: 'collect',
        targetId: target.id,
        label: 'RECOGER',
        sub: `${readyOutput.map(([i]) => getItem(i).icon).join('')} ×${units}`,
        icon: '📦',
        color: '#4ade80',
        holdable: true,
        disabled: inventoryFree(player) <= 0 ? 'Inventario lleno' : undefined,
      });
    }

    options.push({
      kind: 'openMachine',
      targetId: target.id,
      label: 'PANEL',
      sub: def.name,
      icon: '⚙️',
      color: def.accent,
      holdable: false,
    });

    // Máximo 2 acciones directas + panel: prioriza cargar/recoger.
    return options.slice(0, 3);
  }

  return options;
}

/** Texto de ayuda cuando no hay nada cerca. */
export function idleHint(player: PlayerState): string {
  const carrying = Object.values(player.inventory).reduce((a, b) => a + b, 0);
  if (carrying === 0) return 'Ve al YACIMIENTO o a RECOLECCIÓN y consigue material';
  if (player.inventory.ore) return 'Lleva el mineral a la FUNDIDORA';
  return 'Vende en el MUELLE DE CARGA';
}
