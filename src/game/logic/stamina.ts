/**
 * ESTAMINA GASTADA EN CLIENTE, PENDIENTE DE CONSOLIDAR.
 *
 * El sprint se gasta fotograma a fotograma, pero escribir en el servidor 60
 * veces por segundo sería absurdo: se acumula en local y el latido de sesión
 * lo consolida de vez en cuando.
 *
 * Lo delicado es NO contar dos veces. Mientras el gasto sigue sólo en local
 * hay que restarlo de la estamina derivada; en cuanto el servidor lo persiste,
 * `currentStamina()` ya lo incluye y el acumulador local tiene que volver a
 * cero. Si no, cada segundo esprintando resta estamina para siempre y el
 * jugador se queda clavado en 0 sin poder recolectar nunca más. Pasó de
 * verdad, y por eso esto vive aparte y con pruebas.
 *
 * La señal de que el servidor ya lo ha absorbido es que `staminaAt` avanza:
 * es el instante de la última liquidación de estamina del jugador.
 */
export class SprintDrain {
  private amount = 0;
  private baseAt = -1;

  /** Gasto local todavía no reflejado en el estado persistido. */
  get pending(): number {
    return this.amount;
  }

  /** Suma consumo (por ejemplo, un fotograma de sprint). */
  add(cost: number): void {
    if (cost > 0) this.amount += cost;
  }

  /**
   * Sincroniza con el estado del jugador. Si `staminaAt` ha cambiado, el
   * servidor ya ha fijado una línea base nueva que incluye lo gastado.
   */
  sync(staminaAt: number): void {
    if (staminaAt === this.baseAt) return;
    this.baseAt = staminaAt;
    this.amount = 0;
  }

  /** Estamina visible: la derivada del estado menos lo aún no consolidado. */
  apply(derived: number, max: number): number {
    return Math.max(0, Math.min(max, derived - this.amount));
  }
}
