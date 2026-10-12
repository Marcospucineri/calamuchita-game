import { FIXED_DT } from './Config';

/**
 * Loop con paso fijo para la física y render variable.
 * `fixed` corre a 60 Hz; `frame` recibe dt real y alpha de interpolación.
 */
export class GameLoop {
  private acc = 0;
  private last = 0;
  private running = false;

  constructor(
    private fixed: (dt: number) => void,
    private frame: (dt: number, alpha: number) => void,
  ) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25; // pestaña en segundo plano
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 5) {
        this.fixed(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      this.frame(dt, this.acc / FIXED_DT);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }
}
