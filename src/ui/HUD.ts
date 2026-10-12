import { bus } from '../core/EventBus';
import { kindLabel } from '../gameplay/POI';
import { WorldData } from '../world/WorldData';
import { MapRenderer, Minimap } from './Minimap';

const SURFACE_LABEL: Record<string, string> = {
  asphalt: 'asfalto', paving: 'adoquín', compacted: 'compactado', gravel: 'ripio', dirt: 'tierra', grass: 'campo', water: 'agua',
};

const REF_LABEL = (ref: string) => ref.replace(/^RP([A-Z]?)(\d+)/, (_, l, d) => `RP ${l ? l + '-' : ''}${d}`);

export class HUD {
  readonly root: HTMLElement;
  private place!: HTMLElement;
  private placeSub!: HTMLElement;
  private speed!: HTMLElement;
  private speedUnit!: HTMLElement;
  private prompt!: HTMLElement;
  private toastBox!: HTMLElement;
  private postales!: HTMLElement;
  private help!: HTMLElement;
  private bigMap!: HTMLElement;
  private bigCanvas!: HTMLCanvasElement;
  readonly minimap: Minimap;
  readonly map: MapRenderer;
  private lastPlace = '';
  /** Lo define el juego: viajar a un punto (coordenadas del pipeline). */
  onTravel: ((x: number, n: number, label: string) => void) | null = null;
  onClose: (() => void) | null = null;
  private mapOpen = false;

  constructor(private w: WorldData, parent: HTMLElement) {
    this.map = new MapRenderer(w);
    this.minimap = new Minimap(this.map, w);
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="place"><div class="place-name"></div><div class="place-sub"></div></div>
      <div class="postales" title="Postales descubiertas"><span class="postal-ico"></span><b>0</b>/<span>0</span></div>
      <div class="mini-wrap"></div>
      <div class="speedo"><b>0</b><span>km/h</span></div>
      <div class="prompt hidden"></div>
      <div class="toasts"></div>
      <div class="help">
        <h3>Controles</h3>
        <ul>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> manejar / caminar</li>
          <li><kbd>Espacio</kbd> freno de mano / saltar</li>
          <li><kbd>E</kbd> bajar o subir al auto</li>
          <li><kbd>Shift</kbd> correr</li>
          <li><kbd>M</kbd> mapa · <kbd>C</kbd> cámara (5 vistas) · <kbd>R</kbd> enderezar</li>
          <li>Arrastrá el mouse para mirar · rueda para zoom</li>
          <li><kbd>H</kbd> ocultar esta ayuda</li>
        </ul>
      </div>
      <div class="bigmap hidden"><div class="bigmap-card"><div class="bigmap-head"><div><h2>Valle de Calamuchita</h2><span>Tocá cualquier punto del mapa para viajar ahí</span></div><button class="bigmap-close" aria-label="Cerrar mapa">✕</button></div><div class="trips" aria-label="Viaje rápido"></div><div class="bigmap-body"><canvas></canvas><div class="travel-pin hidden"></div></div><div class="bigmap-foot">Datos: © colaboradores de OpenStreetMap · Relieve: Terrarium / AWS Open Data · <kbd>M</kbd> para cerrar</div></div></div>
    `;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.place = q('.place-name');
    this.placeSub = q('.place-sub');
    this.speed = q('.speedo b');
    this.speedUnit = q('.speedo');
    this.prompt = q('.prompt');
    this.toastBox = q('.toasts');
    this.postales = q('.postales');
    this.help = q('.help');
    this.bigMap = q('.bigmap');
    this.bigCanvas = q('.bigmap canvas');
    this.setupTravel();
    q('.mini-wrap').appendChild(this.minimap.el);
    this.postales.querySelector('span:last-child')!.textContent = String(w.pois.length);

    window.addEventListener('keydown', (e) => { if (e.code === 'KeyH') this.help.classList.toggle('hidden'); });
    setTimeout(() => this.help.classList.add('faded'), 14000);

    bus.on('poi:discovered', (e) => {
      const p = w.pois.find((x) => x.id === e.id);
      this.toast(`Postal: ${e.name}`, `${p ? kindLabel(p.kind) : 'Lugar'} · ${e.found} de ${e.total}`, true);
      this.setFound(e.found);
    });
    bus.on('toast', (e) => this.toast(e.text, e.sub));
  }

  setFound(n: number): void {
    this.postales.querySelector('b')!.textContent = String(n);
  }

  toast(text: string, sub?: string, postal = false): void {
    const el = document.createElement('div');
    el.className = 'toast' + (postal ? ' postal' : '');
    el.innerHTML = `<div class="t1"></div>${sub ? '<div class="t2"></div>' : ''}`;
    el.querySelector('.t1')!.textContent = text;
    if (sub) el.querySelector('.t2')!.textContent = sub;
    this.toastBox.appendChild(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 5000);
  }

  setPrompt(text: string | null): void {
    if (!text) { this.prompt.classList.add('hidden'); return; }
    this.prompt.classList.remove('hidden');
    if (this.prompt.innerHTML !== text) this.prompt.innerHTML = text;
  }

  update(x: number, n: number, speedKmh: number | null, surface: string | null): void {
    // ubicación: pueblo + calle/ruta
    const town = this.w.townAt(x, n);
    const nr = this.w.nearestRoad(x, n);
    let main: string, sub: string;
    const roadName = nr && nr.dist < nr.road.width / 2 + 12 ? (nr.road.name || (nr.road.ref ? REF_LABEL(nr.road.ref) : '')) : '';
    const roadRef = nr && nr.dist < nr.road.width / 2 + 12 && nr.road.ref ? REF_LABEL(nr.road.ref) : '';
    if (town && town.d < 0.75) {
      main = town.town.name;
      sub = roadName ? roadName + (roadRef && roadName !== roadRef ? ` · ${roadRef}` : '') : 'Valle de Calamuchita';
    } else {
      main = roadRef || roadName || 'Valle de Calamuchita';
      sub = roadRef && roadName && roadName !== roadRef ? roadName : town ? `cerca de ${town.town.name}` : 'Córdoba, Argentina';
    }
    if (surface) sub += ` · ${SURFACE_LABEL[surface] ?? surface}`;
    const key = main + '|' + sub;
    if (key !== this.lastPlace) {
      this.lastPlace = key;
      this.place.textContent = main;
      this.placeSub.textContent = sub;
    }
    if (speedKmh === null) this.speedUnit.classList.add('hidden');
    else {
      this.speedUnit.classList.remove('hidden');
      this.speed.textContent = String(Math.round(Math.abs(speedKmh)));
    }
  }

  get isMapOpen(): boolean {
    return this.mapOpen;
  }

  toggleMap(x: number, n: number, discovered: Set<string>): void {
    this.mapOpen = !this.mapOpen;
    this.bigMap.classList.toggle('hidden', !this.mapOpen);
    if (!this.mapOpen) return;
    const src = this.map.canvas;
    const c = this.bigCanvas;
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    // en el mapa grande las rutas se ven más gruesas para que se lean al achicar
    g.lineCap = g.lineJoin = 'round';
    for (const r of this.w.roads) {
      if (!r.major && r.surface !== 'asphalt') continue;
      g.strokeStyle = r.major ? '#e0a92e' : 'rgba(255,250,235,0.9)';
      g.lineWidth = r.major ? 6 : 2.7;
      g.beginPath();
      for (let k = 0; k < r.p.length; k += 3) { const [px, py] = this.map.toPx(r.p[k], r.p[k + 1]); k ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    }
    for (const rv of this.w.rivers) {
      if (rv.kind !== 'river') continue;
      g.strokeStyle = '#3f7fa6';
      g.lineWidth = 7;
      g.beginPath();
      for (let k = 0; k < rv.p.length; k += 3) { const [px, py] = this.map.toPx(rv.p[k], rv.p[k + 1]); k ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    }
    g.textAlign = 'center';
    for (const t of this.w.meta.towns) {
      const [px, py] = this.map.toPx(t.x, t.n);
      g.font = '800 80px Bitter, Georgia, serif';
      g.lineWidth = 15;
      g.strokeStyle = 'rgba(255,248,230,0.9)';
      g.strokeText(t.name, px, py - 60);
      g.fillStyle = '#5a2c18';
      g.fillText(t.name, px, py - 60);
    }
    for (const p of this.w.pois) {
      const [px, py] = this.map.toPx(p.x, p.n);
      const got = discovered.has(p.id);
      g.fillStyle = got ? '#3d7a46' : '#c8452c';
      g.strokeStyle = '#fff6e0';
      g.lineWidth = 5;
      g.beginPath(); g.arc(px, py, 17, 0, Math.PI * 2); g.fill(); g.stroke();
      if (got) {
        g.font = '700 36px Nunito, sans-serif';
        g.lineWidth = 9;
        g.strokeStyle = 'rgba(255,248,230,0.9)';
        g.strokeText(p.name, px, py - 27);
        g.fillStyle = '#2d2016';
        g.fillText(p.name, px, py - 27);
      }
    }
    const [mx, my] = this.map.toPx(x, n);
    g.fillStyle = '#2d2016';
    g.strokeStyle = '#fff6e0';
    g.lineWidth = 8;
    g.beginPath(); g.arc(mx, my, 30, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  private setupTravel(): void {
    const w = this.w;
    const trips: { label: string; x: number; n: number }[] = [];
    const lm = (type: string) => w.meta.landmarks?.find((l) => l.type === type);
    const add = (label: string, l?: { x: number; n: number }) => { if (l) trips.push({ label, x: l.x, n: l.n }); };
    add('Arco de VGB', lm('arcoVGB'));
    add('Centro de VGB', lm('barril'));
    add('La botella', lm('botella'));
    const lr = w.meta.towns.find((t) => t.id === 'lr');
    const capilla = w.pois.find((p) => /Inmaculada/.test(p.name));
    add('Los Reartes', capilla ?? lr);
    add('Arco de Villa Ciudad Parque', lm('arcoVCP'));
    for (const pz of w.meta.landmarks?.filter((l) => l.type === 'plaza') ?? []) add(pz.name, { x: pz.x, n: pz.n - (pz.r ?? 40) - 6 });
    const box = this.root.querySelector('.trips') as HTMLElement;
    for (const t of trips) {
      const b = document.createElement('button');
      b.className = 'trip';
      b.textContent = t.label;
      b.addEventListener('click', () => this.onTravel?.(t.x, t.n, t.label));
      box.appendChild(b);
    }
    const pin = this.root.querySelector('.travel-pin') as HTMLElement;
    const toWorld = (e: PointerEvent): [number, number] => {
      const r = this.bigCanvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * this.bigCanvas.width;
      const py = ((e.clientY - r.top) / r.height) * this.bigCanvas.height;
      return this.map.toWorld(px, py);
    };
    this.bigCanvas.addEventListener('pointerdown', (e) => {
      const [x, n] = toWorld(e);
      const pa = w.meta.playArea;
      if (x < pa.x0 || x > pa.x1 || n < pa.n0 || n > pa.n1) { this.toast('Fuera del área de juego', 'Elegí un punto dentro del valle'); return; }
      const r = this.bigCanvas.getBoundingClientRect(), br = (this.bigCanvas.parentElement as HTMLElement).getBoundingClientRect();
      pin.style.left = `${e.clientX - br.left}px`;
      pin.style.top = `${e.clientY - br.top}px`;
      pin.classList.remove('hidden');
      void r;
      const town = w.townAt(x, n);
      setTimeout(() => { pin.classList.add('hidden'); this.onTravel?.(x, n, town ? town.town.name : 'el valle'); }, 260);
    });
    (this.root.querySelector('.bigmap-close') as HTMLElement).addEventListener('click', () => this.onClose?.());
  }

  hideHelp(): void {
    this.help.classList.add('hidden');
  }
}
