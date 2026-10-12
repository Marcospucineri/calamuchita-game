import { TouchControls } from './TouchControls';

/** Acciones abstractas: el resto del juego no sabe de teclas ni de gamepads. */
export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (izq) .. 1 (der)
  pitch: number; // avioneta: -1 baja la trompa (↑) .. 1 sube la trompa (↓)
  planeThrottle: number; // avioneta: acelerar (W)
  planeBrake: number; // avioneta: desacelerar (S)
  moveX: number; // a pie: -1..1 (derecha +)
  moveY: number; // a pie: -1..1 (adelante +)
  run: boolean;
  jump: boolean;
  handbrake: boolean;
  interactPressed: boolean;
  mapPressed: boolean;
  resetPressed: boolean;
  pausePressed: boolean;
  cameraPressed: boolean;
  musicPressed: boolean;
  lookX: number; // delta de mouse/stick
  lookY: number;
  zoom: number;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private wheel = 0;
  private prevPad: boolean[] = [];
  private last = new Map<number, [number, number]>();
  readonly touch: TouchControls | null;

  constructor(el: HTMLElement, uiRoot?: HTMLElement) {
    this.touch = uiRoot && TouchControls.isTouch() ? new TouchControls(uiRoot) : null;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // arrastrar (mouse o dedo) para mirar; el delta se calcula a mano porque
    // movementX no es confiable en pantallas táctiles
    el.addEventListener('pointerdown', (e) => {
      this.last.set(e.pointerId, [e.clientX, e.clientY]);
      el.setPointerCapture(e.pointerId);
    });
    const up = (e: PointerEvent) => {
      this.last.delete(e.pointerId);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointermove', (e) => {
      const l = this.last.get(e.pointerId);
      if (!l) return;
      const k = e.pointerType === 'touch' ? 1.6 : 1;
      this.lookDX += (e.clientX - l[0]) * k;
      this.lookDY += (e.clientY - l[1]) * k;
      l[0] = e.clientX;
      l[1] = e.clientY;
    });
    el.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  private k(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private p(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  read(): InputState {
    const s: InputState = {
      throttle: this.k('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.k('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0),
      // avioneta, como en un simulador: ↑ baja la trompa, ↓ la sube
      pitch: (this.k('ArrowDown') ? 1 : 0) - (this.k('ArrowUp') ? 1 : 0),
      planeThrottle: this.k('KeyW') ? 1 : 0,
      planeBrake: this.k('KeyS') ? 1 : 0,
      moveX: (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0),
      moveY: (this.k('KeyW', 'ArrowUp') ? 1 : 0) - (this.k('KeyS', 'ArrowDown') ? 1 : 0),
      run: this.k('ShiftLeft', 'ShiftRight'),
      jump: this.k('Space'),
      handbrake: this.k('Space'),
      interactPressed: this.p('KeyE', 'KeyF', 'Enter'),
      mapPressed: this.p('KeyM'),
      resetPressed: this.p('KeyR'),
      pausePressed: this.p('Escape', 'KeyP'),
      cameraPressed: this.p('KeyC'),
      musicPressed: this.p('KeyN'),
      lookX: this.lookDX,
      lookY: this.lookDY,
      zoom: this.wheel,
    };

    // Gamepad (layout estándar)
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => btn(i) && !this.prevPad[i];
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      s.throttle = Math.max(s.throttle, rt);
      s.brake = Math.max(s.brake, lt);
      s.planeThrottle = Math.max(s.planeThrottle, rt);
      s.planeBrake = Math.max(s.planeBrake, lt);
      s.steer = Math.abs(dz(pad.axes[0])) > Math.abs(s.steer) ? dz(pad.axes[0]) : s.steer;
      s.moveX = dz(pad.axes[0]) || s.moveX;
      s.moveY = -dz(pad.axes[1]) || s.moveY;
      // stick hacia adelante baja la trompa, hacia atrás la sube
      s.pitch = s.pitch || dz(pad.axes[1] ?? 0);
      s.lookX += dz(pad.axes[2] ?? 0) * 12;
      s.lookY += dz(pad.axes[3] ?? 0) * 8;
      s.run = s.run || btn(10) || btn(1);
      s.jump = s.jump || btn(0);
      s.handbrake = s.handbrake || btn(0);
      s.interactPressed = s.interactPressed || edge(3) || edge(2);
      s.mapPressed = s.mapPressed || edge(8);
      s.pausePressed = s.pausePressed || edge(9);
      s.resetPressed = s.resetPressed || edge(4);
      s.cameraPressed = s.cameraPressed || edge(5);
      s.musicPressed = s.musicPressed || edge(12); // cruceta arriba
      this.prevPad = pad.buttons.map((b) => b.pressed);
    }

    const t = this.touch;
    if (t) {
      const sx = Math.abs(t.stickX) > 0.08 ? t.stickX : 0, sy = Math.abs(t.stickY) > 0.08 ? t.stickY : 0;
      if (t.gas) { s.throttle = 1; s.planeThrottle = 1; }
      if (t.brake) { s.brake = 1; s.planeBrake = 1; }
      if (sx) s.steer = sx;
      if (sx || sy) { s.moveX = sx; s.moveY = sy; s.run = Math.hypot(sx, sy) > 0.85; }
      s.jump = s.jump || t.jump;
      // joystick arriba = trompa abajo (igual que la flecha ↑)
      s.pitch = s.pitch || -sy;
      s.interactPressed = s.interactPressed || t.consume('act');
      s.mapPressed = s.mapPressed || t.consume('map');
      s.cameraPressed = s.cameraPressed || t.consume('cam');
      s.musicPressed = s.musicPressed || t.consume('music');
      s.resetPressed = s.resetPressed || t.consume('reset');
    }

    this.pressed.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    return s;
  }
}
