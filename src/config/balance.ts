/**
 * CONSTANTES DE BALANCE.
 * Un único sitio para tocar la economía sin buscar números por el código.
 */

/**
 * TECHO DE DINERO POR ESCRITURA.
 *
 * Las reglas de seguridad de Firestore rechazan cualquier escritura que suba
 * el dinero del jugador más de esto de golpe: es lo que impide que un cliente
 * manipulado se teletransporte a mil millones. La consecuencia es que NINGUNA
 * recompensa legítima puede pasarse de aquí, o el servidor rechazaría la
 * partida entera y el jugador se quedaría sin poder hacer nada.
 *
 * Por eso todas las fuentes grandes de dinero llevan techo:
 *   · la recompensa por subir de nivel (`moneyPerLevel`)
 *   · el cobro de lo que venden los robots (`SALE_CLAIM_CAP`)
 *   · la recompensa por producción offline
 *
 * Si cambias este valor, cámbialo también en `firestore.rules`.
 */
export const MAX_MONEY_PER_WRITE = 5_000_000;

/** Margen de seguridad: ninguna recompensa se acerca al techo duro. */
const LEVEL_MONEY_CAP = 250_000;

/** Techo del dinero total repartido por subir de nivel en una sola acción,
 *  aunque se encadenen muchos niveles de golpe. */
export const LEVELUP_TOTAL_MONEY_CAP = 1_000_000;

/** Máximo que se cobra de una vez de las ventas de los robots. El resto
 *  queda pendiente y se cobra en la siguiente acción. */
export const SALE_CLAIM_CAP = 1_000_000;

/** Máximo de la recompensa por producción offline, en dinero y en XP. */
export const OFFLINE_MONEY_CAP = 1_000_000;
export const OFFLINE_XP_CAP = 100_000;

export const BALANCE = {
  player: {
    startingMoney: 500,
    startingStamina: 100,
    baseMaxStamina: 100,
    baseStaminaRegen: 1.6, // por segundo, parado o caminando
    sprintStaminaCost: 11, // por segundo
    baseInventorySlots: 10,
    baseSpeed: 132, // px/s
    sprintMultiplier: 1.62,
    /** Penalización de velocidad al quedarse sin estamina. */
    exhaustedSpeedMult: 0.55,
  },

  actions: {
    gather: { durationMs: 900, stamina: 4, xp: 5 },
    deposit: { durationMs: 260, stamina: 0.6 },
    collect: { durationMs: 260, stamina: 0.6 },
    sell: { durationMs: 320, stamina: 0 },
    /** Radio de interacción con estaciones/máquinas, en px. */
    range: 78,
    /** Radio en el que se recogen automáticamente los objetos del suelo. */
    pickupRange: 42,
    /** Radio máximo aceptado por el servidor para vender o recoger del suelo. */
    validationSlack: 40,
  },

  conveyor: {
    /** Unidades que se traspasan en cada tanda al pasar por encima. */
    autoTransferBatch: 50,
    /** Pausa entre tandas: el material se va yendo poco a poco, no de golpe. */
    autoTransferCooldownMs: 700,
    /** Margen alrededor de la cinta para considerar que estás encima. */
    range: 34,
  },

  ground: {
    /** Objetos tirados como máximo por fábrica (evita saturar el documento). */
    maxItems: 60,
    /** Distancia a la que aparece el objeto delante del jugador. */
    dropOffset: 26,
    /** Los objetos muy viejos se limpian al interactuar con la fábrica. */
    expireMs: 24 * 3600 * 1000,
  },

  leveling: {
    /** XP necesaria para pasar del nivel n al n+1. */
    xpForLevel: (level: number) => Math.round(100 * Math.pow(level, 1.42)),
    /**
     * Recompensa de dinero al subir de nivel.
     *
     * La curva crece rápido a propósito, pero con TECHO: sin él, a partir del
     * nivel ~45 una sola subida repartía más dinero del que las reglas de
     * seguridad admiten en una escritura, y el juego se quedaba clavado
     * rechazando todas las acciones. Ver `MAX_MONEY_PER_WRITE`.
     */
    moneyPerLevel: (level: number) =>
      Math.min(LEVEL_MONEY_CAP, Math.round(120 * Math.pow(1.28, level - 1))),
    staminaRefillOnLevelUp: true,
  },

  luck: {
    /** Probabilidad base de hallazgo raro al extraer. */
    baseRareChance: 0.03,
    perLuckLevel: 0.018,
    /** Tabla de hallazgos raros. */
    table: [
      { item: 'crystal', weight: 1, amount: 1 },
      { item: 'scrap', weight: 3, amount: 2 },
    ],
  },

  factory: {
    maxPlayers: 10,
    /** Puntos de contribución por cada $1 donado en el núcleo. */
    contribPerMoney: 0.9,
    /** Contribución generada automáticamente al vender (por $1 de venta). */
    contribPerSale: 0.22,
    /** Contribución generada al recoger producto de una máquina. */
    contribPerProduced: 1.4,
    /** Presupuesto mínimo del donativo en el núcleo. */
    minMoneyDonation: 50,
  },

  offline: {
    /** Segundos máximos acumulables de producción offline. */
    capSeconds: 8 * 3600,
    /** Segundos mínimos para que se muestre el resumen. */
    minSeconds: 90,
    /** Dinero por punto de producción offline. */
    moneyPerUnit: 1.15,
    /** XP por punto de producción offline. */
    xpPerUnit: 0.22,
    /** La producción offline se reparte: cada jugador recibe su parte
     *  completa (no se divide entre jugadores) pero escala con su nivel. */
    playerLevelScale: (level: number) => 1 + (level - 1) * 0.06,
  },

  net: {
    /** ms entre escrituras de posición mientras el jugador se mueve. */
    positionThrottleMs: 110,
    /** ms de latido cuando está quieto (mantiene la presencia fresca). */
    idleHeartbeatMs: 4000,
    /** ms de interpolación de jugadores remotos. */
    interpolationMs: 130,
    /** ms sin señal tras los que un jugador remoto se considera ausente. */
    staleAfterMs: 20000,
    /** ms entre autoguardados del estado persistente del jugador. */
    autosaveMs: 12000,
  },

  ui: {
    toastMs: 3200,
    floatingTextMs: 1100,
  },
} as const;

/** Estadísticas derivadas del jugador a partir de sus mejoras. */
export interface DerivedStats {
  speed: number;
  maxStamina: number;
  staminaRegen: number;
  inventorySlots: number;
  gatherAmount: number;
  actionSpeedMult: number;
  actionCostMult: number;
  sellMultiplier: number;
  rareChance: number;
}

export function deriveStats(upgrades: Partial<Record<string, number>>): DerivedStats {
  const lvl = (k: string) => upgrades[k] ?? 0;
  const eff = Math.pow(0.93, lvl('efficiency'));
  return {
    speed: BALANCE.player.baseSpeed * (1 + lvl('speed') * 0.07),
    maxStamina: BALANCE.player.baseMaxStamina + lvl('stamina') * 25,
    staminaRegen: BALANCE.player.baseStaminaRegen + lvl('regen') * 0.65,
    inventorySlots: BALANCE.player.baseInventorySlots + lvl('capacity') * 5,
    gatherAmount: 1 + lvl('strength'),
    actionSpeedMult: eff,
    actionCostMult: eff,
    sellMultiplier: 1 + lvl('trading') * 0.06,
    rareChance:
      BALANCE.luck.baseRareChance + lvl('luck') * BALANCE.luck.perLuckLevel,
  };
}
