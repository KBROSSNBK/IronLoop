import { WORLD_H, WORLD_W } from '../../config/world';

/**
 * Cámara con seguimiento suave, límites de mundo y sacudida.
 * El zoom se calcula para que siempre se vea una cantidad cómoda de fábrica,
 * tanto en un viewport vertical (escritorio) como en landscape (móvil).
 */
export class Camera {
  x = WORLD_W / 2;
  y = WORLD_H / 2;
  zoom = 1;
  private shakePower = 0;
  private shakeTime = 0;
  private offsetX = 0;
  private offsetY = 0;

  /** Tiles visibles en el eje corto. Más bajo = más cerca. */
  private targetTilesShort = 10;

  resize(viewW: number, viewH: number, tile: number): void {
    const short = Math.min(viewW, viewH);
    const long = Math.max(viewW, viewH);
    const ratio = long / short;
    // En pantallas muy alargadas se aleja un poco para no ver sólo un pasillo.
    const tiles = this.targetTilesShort + Math.max(0, (ratio - 1.35) * 1.6);
    const zoom = short / (tiles * tile);
    this.zoom = Math.max(1.05, Math.min(3.2, zoom));
  }

  follow(tx: number, ty: number, dt: number, viewW: number, viewH: number): void {
    const k = 1 - Math.pow(0.0025, dt); // suavizado independiente del framerate
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;

    const halfW = viewW / (2 * this.zoom);
    const halfH = viewH / (2 * this.zoom);
    this.x = WORLD_W <= halfW * 2 ? WORLD_W / 2 : Math.max(halfW, Math.min(WORLD_W - halfW, this.x));
    this.y = WORLD_H <= halfH * 2 ? WORLD_H / 2 : Math.max(halfH, Math.min(WORLD_H - halfH, this.y));

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const decay = this.shakeTime / 0.4;
      this.offsetX = (Math.random() * 2 - 1) * this.shakePower * decay;
      this.offsetY = (Math.random() * 2 - 1) * this.shakePower * decay;
    } else {
      this.offsetX *= 0.8;
      this.offsetY *= 0.8;
    }
  }

  /**
   * Salto instantáneo. Lo usa el teletransporte: sin esto la cámara viajaría
   * suavemente por el vacío hasta el otro planeta, que dura un mundo y no se
   * entiende nada por el camino.
   */
  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  shake(power: number): void {
    this.shakePower = Math.max(this.shakePower, power);
    this.shakeTime = 0.4;
  }

  /** Aplica la transformación mundo→pantalla al contexto. */
  apply(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + this.offsetX, -this.y + this.offsetY);
  }

  worldToScreen(wx: number, wy: number, viewW: number, viewH: number) {
    return {
      x: (wx - this.x + this.offsetX) * this.zoom + viewW / 2,
      y: (wy - this.y + this.offsetY) * this.zoom + viewH / 2,
    };
  }

  /** Rectángulo visible en coordenadas de mundo (para culling). */
  visibleRect(viewW: number, viewH: number) {
    const halfW = viewW / (2 * this.zoom);
    const halfH = viewH / (2 * this.zoom);
    return {
      x: this.x - halfW,
      y: this.y - halfH,
      w: halfW * 2,
      h: halfH * 2,
    };
  }
}
