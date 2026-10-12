/**
 * Controles táctiles para celular: joystick a la izquierda (dirección / caminar),
 * botones a la derecha (acelerar, frenar, acción, mapa, cámara, música).
 * El botón de la esquina inferior derecha oculta todo lo que no sea esencial
 * (queda la cruceta y acelerar/frenar, o saltar a pie).
 * Arrastrar sobre el resto de la pantalla mueve la cámara (lo maneja Input).
 */
export class TouchControls {
  readonly root: HTMLElement;
  stickX = 0;
  stickY = 0;
  gas = false;
  brake = false;
  jump = false;
  /** Modo mínimo: solo los controles esenciales. */
  minimal = false;
  private flying = false;
  private driving = true;
  private pressed = new Set<string>();
  private action: HTMLButtonElement;
  private knob: HTMLElement;

  static isTouch(): boolean {
    return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  constructor(parent: HTMLElement) {
    document.body.classList.add('touch');
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    this.root.innerHTML = `
      <div class="stick" aria-label="Dirección"><div class="stick-knob"></div></div>
      <div class="tbtns">
        <div class="tb-extras">
          <button class="tb tb-small tb-flight hidden" data-k="reset" aria-label="Volver al aeroclub">Aeroclub</button>
          <button class="tb tb-small" data-k="map" aria-label="Mapa">Mapa</button>
          <button class="tb tb-small" data-k="cam" aria-label="Cambiar cámara">Cámara</button>
          <button class="tb tb-small" data-k="music" aria-label="Cambiar música">Música</button>
        </div>
        <button class="tb tb-action hidden" data-k="act">Bajar</button>
        <div class="tb-pedals">
          <button class="tb tb-brake" data-k="brake" aria-label="Frenar o marcha atrás">Freno</button>
          <button class="tb tb-gas" data-k="gas" aria-label="Acelerar o saltar">Acelerar</button>
        </div>
      </div>
      <button class="tb-toggle" aria-pressed="false" aria-label="Ocultar botones">▾ Ocultar</button>`;
    parent.appendChild(this.root);
    const stick = this.root.querySelector('.stick') as HTMLElement;
    this.knob = this.root.querySelector('.stick-knob') as HTMLElement;
    this.action = this.root.querySelector('[data-k="act"]') as HTMLButtonElement;

    let sid = -1, cx = 0, cy = 0;
    const R = 52;
    const move = (e: PointerEvent) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      this.stickX = dx / R;
      this.stickY = -dy / R;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      stick.setPointerCapture(sid);
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      move(e);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) move(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== sid) return;
      sid = -1;
      this.stickX = this.stickY = 0;
      this.knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    stick.addEventListener('lostpointercapture', end);

    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tb')) {
      const k = b.dataset.k!;
      const set = (v: boolean) => {
        if (k === 'gas') { this.gas = v; this.jump = v; }
        else if (k === 'brake') this.brake = v;
        else if (v) this.pressed.add(k);
        b.classList.toggle('down', v);
      };
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); set(true); e.preventDefault(); });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
      b.addEventListener('lostpointercapture', () => set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        e.stopPropagation();
        if (!e.repeat) set(true);
      });
      b.addEventListener('keyup', (e) => {
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        e.stopPropagation();
        set(false);
      });
      b.addEventListener('blur', () => set(false));
    }

    const toggle = this.root.querySelector('.tb-toggle') as HTMLButtonElement;
    toggle.addEventListener('click', () => this.setMinimal(!this.minimal));
    let saved = false;
    try { saved = localStorage.getItem('calamuchita.touchMin') === '1'; } catch { /* sin almacenamiento */ }
    this.setMinimal(saved);
  }

  /** Oculta (o vuelve a mostrar) todo lo que no es esencial para manejar, volar o caminar. */
  setMinimal(on: boolean): void {
    this.minimal = on;
    this.root.classList.toggle('minimal', on);
    document.body.classList.toggle('touch-min', on);
    const toggle = this.root.querySelector('.tb-toggle') as HTMLButtonElement;
    toggle.textContent = on ? '▴ Mostrar' : '▾ Ocultar';
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', on ? 'Mostrar todos los botones' : 'Ocultar botones');
    try { localStorage.setItem('calamuchita.touchMin', on ? '1' : '0'); } catch { /* sin almacenamiento */ }
  }

  consume(k: string): boolean {
    const had = this.pressed.has(k);
    this.pressed.delete(k);
    return had;
  }

  /** Muestra el botón de acción con el texto que corresponda ("Bajar" / "Subir"), o lo oculta. */
  setAction(label: string | null): void {
    this.action.classList.toggle('hidden', this.flying || !label);
    if (label && this.action.textContent !== label) this.action.textContent = label;
  }

  setDriving(driving: boolean): void {
    if (this.driving === driving) return;
    this.driving = driving;
    this.updateMode();
  }

  setFlying(flying: boolean): void {
    if (this.flying === flying) return;
    this.flying = flying;
    this.gas = this.brake = this.jump = false;
    this.pressed.clear();
    this.root.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
    this.updateMode();
  }

  private updateMode(): void {
    this.root.classList.toggle('flying', this.flying);
    this.root.classList.toggle('onfoot', !this.driving && !this.flying);
    for (const b of this.root.querySelectorAll('.tb-flight')) b.classList.toggle('hidden', !this.flying);
    if (this.flying) this.setAction(null);
    const gas = this.root.querySelector('[data-k="gas"]') as HTMLButtonElement;
    gas.textContent = this.flying || this.driving ? 'Acelerar' : 'Saltar';
    gas.setAttribute('aria-label', gas.textContent);
    const brake = this.root.querySelector('[data-k="brake"]') as HTMLButtonElement;
    brake.textContent = this.flying ? 'Desacel.' : 'Freno';
    brake.setAttribute('aria-label', this.flying ? 'Desacelerar la avioneta' : 'Frenar o marcha atrás');
  }
}
