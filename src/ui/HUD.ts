import { bus } from '../core/EventBus';
import { kindLabel } from '../gameplay/POI';
import { getAirfield } from '../world/Airfield';
import { WorldData } from '../world/WorldData';
import { MapRenderer, Minimap } from './Minimap';
import { BigMapView } from './BigMap';
import { isTyping } from '../engine/Input';

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
  private bigView!: BigMapView;
  readonly minimap: Minimap;
  readonly map: MapRenderer;
  private lastPlace = '';
  private vehicle: 'car' | 'plane' = 'car';
  private carHelp = '';
  private flightInfo!: HTMLElement;
  /** Lo define el juego: viajar a un punto (coordenadas del pipeline). */
  onTravel: ((x: number, n: number, label: string) => void) | null = null;
  onClose: (() => void) | null = null;
  onVehicleChange: ((vehicle: 'car' | 'plane') => void) | null = null;
  onReturnToAirfield: (() => void) | null = null;
  private mapOpen = false;
  private pick: { x: number; n: number; label: string } | null = null;
  /** Modo debug: si devuelve true, el toque en el mapa no se usa para viajar. */
  mapPickHandler: ((x: number, n: number) => boolean) | null = null;

  get mapView(): BigMapView { return this.bigView; }

  constructor(private w: WorldData, parent: HTMLElement) {
    this.map = new MapRenderer(w);
    this.minimap = new Minimap(this.map, w);
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="place"><div class="place-name"></div><div class="place-sub"></div></div>
      <div class="postales" title="Postales descubiertas"><span class="postal-ico"></span><b>0</b>/<span>0</span></div>
      <div class="vehicle-switch" role="group" aria-label="Elegí tu vehículo">
        <button data-vehicle="car" aria-pressed="true">Auto</button>
        <button data-vehicle="plane" aria-pressed="false">Avioneta</button>
      </div>
      <div class="flight-info hidden"><b>En pista</b><span>0 m sobre el terreno</span></div>
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
          <li><kbd>N</kbd> música (3 temas o silencio)</li>
          <li>Arrastrá el mouse para mirar · rueda para zoom</li>
          <li><kbd>H</kbd> ocultar esta ayuda</li>
        </ul>
      </div>
      <div class="bigmap hidden"><div class="bigmap-card"><div class="bigmap-head"><div><h2>Valle de Calamuchita</h2><span>Arrastrá para moverte, acercá con la rueda o dos dedos y tocá un punto para viajar</span></div><button class="bigmap-close" aria-label="Cerrar mapa">✕</button></div><div class="trips" aria-label="Viaje rápido"></div><div class="bigmap-body"><canvas aria-label="Mapa del valle"></canvas><div class="map-zoom"><button data-z="in" aria-label="Acercar">+</button><button data-z="out" aria-label="Alejar">−</button><button data-z="me" aria-label="Centrar en tu posición">◎</button></div><div class="map-confirm hidden" role="group" aria-label="Confirmar viaje"><span></span><button class="go">Viajar</button><button class="cancel" aria-label="Cancelar">✕</button></div></div><div class="bigmap-foot">Datos: © colaboradores de OpenStreetMap · Relieve: Terrarium / AWS Open Data · <kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>M</kbd> para cerrar</div></div></div>
    `;
    parent.appendChild(this.root);
    // La activación por teclado de los botones no debe accionar el vehículo.
    // Después de elegir con mouse/touch, Espacio vuelve a controlar el vehículo.
    // Una activación por teclado conserva el foco para seguir navegando los botones.
    this.root.addEventListener('click', (e) => {
      if (e.detail > 0 && e.target instanceof Element) e.target.closest('button')?.blur();
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) e.stopPropagation();
    });
    this.root.addEventListener('click', (e) => {
      // Un botón pulsado con el mouse no debe quedarse con Espacio y bloquear el ascenso.
      if (e.detail > 0 && e.target instanceof HTMLButtonElement) e.target.blur();
    });
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.place = q('.place-name');
    this.placeSub = q('.place-sub');
    this.speed = q('.speedo b');
    this.speedUnit = q('.speedo');
    this.prompt = q('.prompt');
    this.toastBox = q('.toasts');
    this.postales = q('.postales');
    this.help = q('.help');
    this.carHelp = this.help.innerHTML;
    this.flightInfo = q('.flight-info');
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.vehicle-switch button')) {
      b.addEventListener('click', () => this.onVehicleChange?.(b.dataset.vehicle as 'car' | 'plane'));
    }
    this.bigMap = q('.bigmap');
    this.bigCanvas = q('.bigmap canvas');
    this.setupTravel();
    q('.mini-wrap').appendChild(this.minimap.el);
    this.postales.querySelector('span:last-child')!.textContent = String(w.pois.length);

    window.addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !isTyping(e)) this.help.classList.toggle('hidden'); });
    setTimeout(() => this.help.classList.add('faded'), 14000);

    bus.on('poi:discovered', (e) => {
      const p = w.pois.find((x) => x.id === e.id);
      this.toast(`Postal: ${e.name}`, `${p ? kindLabel(p.kind) : 'Lugar'} · ${e.found} de ${e.total}`, true);
      this.setFound(e.found);
    });
    bus.on('toast', (e) => this.toast(e.text, e.sub));
  }

  setVehicle(vehicle: 'car' | 'plane'): void {
    if (this.vehicle === vehicle && this.root.dataset.vehicle === vehicle) return;
    this.vehicle = vehicle;
    this.root.dataset.vehicle = vehicle;
    const flying = vehicle === 'plane';
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.vehicle-switch button')) {
      b.setAttribute('aria-pressed', String(b.dataset.vehicle === vehicle));
    }
    this.flightInfo.classList.toggle('hidden', !flying);
    this.help.innerHTML = flying ? `
      <h3>Avioneta</h3>
      <ul>
        <li><kbd>W</kbd> acelerar · <kbd>S</kbd> desacelerar</li>
        <li><kbd>A</kbd><kbd>D</kbd> o <kbd>←</kbd><kbd>→</kbd> girar (planea inclinando las alas)</li>
        <li><kbd>↑</kbd> baja la trompa · <kbd>↓</kbd> sube la trompa</li>
        <li>Acelerá por la pista y tirá <kbd>↓</kbd> para despegar</li>
        <li><kbd>R</kbd> volver al aeroclub</li>
        <li><kbd>M</kbd> mapa · <kbd>C</kbd> cámara (5 vistas) · <kbd>N</kbd> música · <kbd>H</kbd> ayuda</li>
        <li>Gamepad: RT/LT motor · stick izquierdo giro y trompa (adelante baja) · LB volver</li>
      </ul>` : this.carHelp;
    this.help.classList.remove('faded');
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.ground-trip')) {
      b.classList.toggle('hidden', flying);
      b.disabled = flying;
    }
    this.root.querySelector('.airfield-return')!.classList.toggle('hidden', !flying);
    this.root.querySelector('.bigmap-head span')!.textContent = flying
      ? 'La avioneta siempre parte del Aeroclub de Villa General Belgrano. Para viajar por tierra, elegí Auto.'
      : 'Arrastrá para moverte, acercá con la rueda o dos dedos y tocá un punto para viajar';
    this.cancelPick();
  }

  setFlight(altitude: number, grounded: boolean): void {
    this.flightInfo.querySelector('b')!.textContent = grounded ? 'En tierra' : 'En vuelo';
    this.flightInfo.querySelector('span')!.textContent = `${Math.max(0, Math.round(altitude))} m sobre el terreno`;
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
    this.cancelPick();
    if (this.mapOpen) this.bigView.show(x, n, discovered);
    else this.bigView.hide();
  }

  private cancelPick(): void {
    this.pick = null;
    this.bigView?.clearPin();
    this.root.querySelector('.map-confirm')?.classList.add('hidden');
  }

  private setupTravel(): void {
    const w = this.w;
    const trips: { label: string; x: number; n: number }[] = [];
    const lm = (type: string) => w.meta.landmarks?.find((l) => l.type === type);
    const add = (label: string, l?: { x: number; n: number }) => { if (l) trips.push({ label, x: l.x, n: l.n }); };
    add('Arco de VGB', lm('arcoVGB'));
    add('Centro de VGB', lm('barril'));
    add('Aeroclub de VGB', getAirfield(w));
    add('La botella', lm('botella'));
    const lr = w.meta.towns.find((t) => t.id === 'lr');
    const capilla = w.pois.find((p) => /Inmaculada/.test(p.name));
    add('Los Reartes', capilla ?? lr);
    add('Arco de Villa Ciudad Parque', lm('arcoVCP'));
    for (const pz of w.meta.landmarks?.filter((l) => l.type === 'plaza') ?? []) add(pz.name, { x: pz.x, n: pz.n - (pz.r ?? 40) - 6 });
    const box = this.root.querySelector('.trips') as HTMLElement;
    for (const t of trips) {
      const b = document.createElement('button');
      b.className = 'trip ground-trip';
      b.textContent = t.label;
      b.addEventListener('click', () => { if (this.vehicle === 'car') this.onTravel?.(t.x, t.n, t.label); });
      box.appendChild(b);
    }
    const back = document.createElement('button');
    back.className = 'trip airfield-return hidden';
    back.textContent = 'Volver al aeroclub';
    back.addEventListener('click', () => this.onReturnToAirfield?.());
    box.appendChild(back);
    // mapa con zoom propio: tocar un punto deja un pin y se confirma el viaje
    this.bigView = new BigMapView(w, this.map, this.bigCanvas);
    const confirm = this.root.querySelector('.map-confirm') as HTMLElement;
    this.bigView.onPick = (x, n) => {
      if (this.mapPickHandler?.(x, n)) return;
      if (this.vehicle === 'plane') return;
      const pa = w.meta.playArea;
      if (x < pa.x0 || x > pa.x1 || n < pa.n0 || n > pa.n1) { this.toast('Fuera del área de juego', 'Elegí un punto dentro del valle'); return; }
      const town = w.townAt(x, n);
      this.pick = { x, n, label: town ? town.town.name : 'el valle' };
      this.bigView.pin = { x, n };
      this.bigView.zoom(1); // redibuja
      confirm.querySelector('span')!.textContent = town ? `Viajar a ${town.town.name}` : 'Viajar a este punto';
      confirm.classList.remove('hidden');
    };
    const go = () => {
      const p = this.pick;
      if (!p || this.vehicle !== 'car') return;
      this.cancelPick();
      this.onTravel?.(p.x, p.n, p.label);
    };
    confirm.querySelector('.go')!.addEventListener('click', go);
    confirm.querySelector('.cancel')!.addEventListener('click', () => this.cancelPick());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.map-zoom button')) {
      b.addEventListener('click', () => {
        if (b.dataset.z === 'in') this.bigView.zoom(1.6);
        else if (b.dataset.z === 'out') this.bigView.zoom(1 / 1.6);
        else this.bigView.centerOnPlayer();
      });
    }
    window.addEventListener('keydown', (e) => {
      if (!this.mapOpen || e.ctrlKey || e.metaKey || isTyping(e)) return;
      if (e.key === '+' || e.key === '=') this.bigView.zoom(1.6);
      else if (e.key === '-' || e.key === '_') this.bigView.zoom(1 / 1.6);
      else if (e.key === 'Enter' && this.pick && !(e.target instanceof HTMLButtonElement)) go();
      else if (e.key === 'Escape' && this.pick) this.cancelPick();
    });
    (this.root.querySelector('.bigmap-close') as HTMLElement).addEventListener('click', () => this.onClose?.());
  }

  hideHelp(): void {
    this.help.classList.add('hidden');
  }
}
