/**
 * Hojas que se abren encima del juego o de la pantalla de inicio: álbum de postales,
 * créditos, opciones, controles y el menú de pausa. Se apilan; Esc o ✕ cierra la de arriba.
 */
import { kindLabel } from '../gameplay/POI';
import { postcardFor, postcardImage } from '../gameplay/Postcards';
import type { POI, Town } from '../world/WorldData';

const BASE = (): string => import.meta.env?.BASE_URL ?? './';
export const asset = (p: string): string => `${BASE()}${p}`;

export const SITE_URL = 'https://vallecito.ar';
export const VALLE_VISUAL_URL = 'https://vallevisual.com';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Sheet { el: HTMLElement; onClose?: () => void; restore: Element | null }

export interface SheetOptions {
  narrow?: boolean;
  /** Texto chico al lado del título (por ejemplo "4 de 26"). */
  count?: string;
  onClose?: () => void;
  /** Clase extra para la tarjeta. */
  className?: string;
}

export class Overlays {
  private stack: Sheet[] = [];
  /** Con el juego andando, Esc lo maneja el juego (para no reabrir la pausa en el mismo cuadro). */
  escByGame = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.escByGame || e.key !== 'Escape' || !this.stack.length) return;
      e.preventDefault();
      this.closeTop();
    });
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  open(title: string, body: HTMLElement | string, o: SheetOptions = {}): { el: HTMLElement; body: HTMLElement; close: () => void } {
    const el = document.createElement('div');
    el.className = 'sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title);
    el.innerHTML = `
      <div class="sheet-card${o.narrow ? ' narrow' : ''}${o.className ? ' ' + o.className : ''}">
        <div class="sheet-head"><h2></h2>${o.count ? `<span class="label count">${esc(o.count)}</span>` : ''}<button class="sheet-close" aria-label="Cerrar">✕</button></div>
        <div class="sheet-body"></div>
      </div>`;
    el.querySelector('h2')!.textContent = title;
    const bodyEl = el.querySelector('.sheet-body') as HTMLElement;
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.appendChild(body);
    const sheet: Sheet = { el, onClose: o.onClose, restore: document.activeElement };
    const close = () => this.close(sheet);
    el.querySelector('.sheet-close')!.addEventListener('click', close);
    // tocar el fondo oscuro cierra
    el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
    // las teclas de la hoja no llegan al juego (Espacio en un botón no frena el auto)
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    document.body.appendChild(el);
    this.stack.push(sheet);
    (el.querySelector('.sheet-close') as HTMLElement).focus({ preventScroll: true });
    return { el, body: bodyEl, close };
  }

  private close(sheet: Sheet): void {
    const i = this.stack.indexOf(sheet);
    if (i < 0) return;
    this.stack.splice(i, 1);
    sheet.el.remove();
    sheet.onClose?.();
    if (sheet.restore instanceof HTMLElement && document.contains(sheet.restore)) sheet.restore.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur?.();
  }

  closeTop(): void {
    const s = this.stack[this.stack.length - 1];
    if (s) this.close(s);
  }

  closeAll(): void {
    while (this.stack.length) this.closeTop();
  }

  // ---------------------------------------------------------------- créditos

  openCredits(): void {
    const body = `
      <div class="credits-hero">
        <img src="${asset('brand/logo.webp')}" alt="Vallecito" width="220" height="110">
        <div class="by">Un juego creado por <a href="${VALLE_VISUAL_URL}" target="_blank" rel="noopener">Marcos Pucineri</a><br>Arte y desarrollo con IA en <a href="${VALLE_VISUAL_URL}" target="_blank" rel="noopener">Valle Visual</a></div>
      </div>
      <dl class="credit-list">
        <dt>Creación</dt><dd><a href="${VALLE_VISUAL_URL}" target="_blank" rel="noopener">Marcos Pucineri · Valle Visual</a></dd>
        <dt>Ilustraciones</dt><dd>Postales, arte de tapa, logo e íconos: Valle Visual, generados con Magnific.</dd>
        <dt>Modelos 3D</dt><dd>Deck y locales de Las Magnolias: <a href="https://www.instagram.com/antooaleman/" target="_blank" rel="noopener">@antooaleman</a></dd>
        <dt>Mapa del valle</dt><dd>Calles, ríos, edificios y lugares: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a> (ODbL).<br>Relieve: Terrain Tiles de Mapzen en AWS Open Data (SRTM, GMTED y otros).</dd>
        <dt>Tipografías</dt><dd>Berkshire Swash, Josefin Sans y Overpass Mono (SIL Open Font License).</dd>
        <dt>Tecnología</dt><dd>three.js, Rapier y Vite.</dd>
      </dl>
      <div class="credits-foot">Hecho en el Valle de Calamuchita, Córdoba · <a href="${SITE_URL}" target="_blank" rel="noopener">vallecito.ar</a></div>`;
    this.open('Créditos', body, { narrow: false, className: 'credits-card' });
  }

  // ---------------------------------------------------------------- controles

  openControls(touch: boolean): void {
    const body = touch ? `
      <div class="opt"><h4>En el celular</h4><ul class="keys">
        <li><span class="k">Joystick</span> girar, caminar o inclinar la avioneta</li>
        <li><span class="k">Acelerar · Freno</span> los pedales de la derecha (a pie, saltar)</li>
        <li><span class="k">Bajar · Subir</span> aparece cuando estás cerca del auto</li>
        <li><span class="k">Arrastrar</span> en la pantalla para mirar alrededor</li>
        <li><span class="k">Ocultar</span> deja solo lo esencial para manejar</li>
      </ul></div>
      <div class="opt"><h4>Avioneta</h4><p>Acelerá por la pista y tirá el joystick hacia abajo para despegar. Joystick arriba baja la trompa.</p></div>` : `
      <div class="opt"><h4>Auto y a pie</h4><ul class="keys">
        <li><span class="k"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span> manejar o caminar</li>
        <li><span class="k"><kbd>Espacio</kbd></span> freno de mano o saltar</li>
        <li><span class="k"><kbd>E</kbd></span> bajarse o subirse al auto</li>
        <li><span class="k"><kbd>Shift</kbd></span> correr</li>
        <li><span class="k"><kbd>R</kbd></span> enderezar el auto</li>
      </ul></div>
      <div class="opt"><h4>Avioneta</h4><ul class="keys">
        <li><span class="k"><kbd>W</kbd> <kbd>S</kbd></span> acelerar y desacelerar</li>
        <li><span class="k"><kbd>A</kbd><kbd>D</kbd></span> girar</li>
        <li><span class="k"><kbd>↑</kbd> <kbd>↓</kbd></span> bajar o subir la trompa (↓ para despegar)</li>
        <li><span class="k"><kbd>R</kbd></span> volver al aeroclub</li>
      </ul></div>
      <div class="opt"><h4>Siempre</h4><ul class="keys">
        <li><span class="k"><kbd>M</kbd></span> mapa y viaje rápido</li>
        <li><span class="k"><kbd>C</kbd></span> cambiar la cámara</li>
        <li><span class="k"><kbd>N</kbd></span> cambiar la música</li>
        <li><span class="k"><kbd>Esc</kbd></span> menú</li>
        <li><span class="k">Mouse</span> arrastrar para mirar, rueda para acercar</li>
        <li><span class="k">Gamepad</span> RT/LT acelerar y frenar, stick izquierdo para dirigir</li>
      </ul></div>`;
    this.open('Controles', body, { narrow: true });
  }

  // ---------------------------------------------------------------- opciones

  openOptions(o: OptionsContext): void {
    const box = document.createElement('div');
    const seg = (name: string, items: { id: string; label: string }[], current: string, three = false) => `
      <div class="seg${three ? ' three' : ''}" role="group" data-name="${name}">
        ${items.map((it) => `<button data-id="${esc(it.id)}" aria-pressed="${it.id === current}">${esc(it.label)}</button>`).join('')}
      </div>`;
    box.innerHTML = `
      <div class="opt"><h4>Calidad gráfica</h4>
        ${seg('quality', [{ id: 'baja', label: 'Baja' }, { id: 'media', label: 'Media' }, { id: 'alta', label: 'Alta' }], o.quality, true)}
        <p class="q-note">${o.inGame ? 'Se aplica al volver a cargar el juego.' : 'Baja anda mejor en celulares y compus viejas.'}</p>
        ${o.inGame ? '<button class="btn btn-light q-apply hidden">Aplicar y recargar</button>' : ''}
      </div>
      <div class="opt"><h4>Música</h4>
        ${seg('music', o.music.options.map((l, i) => ({ id: String(i), label: l })), String(o.music.index))}
      </div>
      ${o.camera ? `<div class="opt"><h4>Cámara</h4>${seg('camera', o.camera.views, o.camera.current)}</div>` : ''}
      ${o.onRestart ? `<div class="opt"><h4>Partida</h4><p>Borra las postales y la posición guardadas en este navegador.</p><button class="btn btn-light restart">Empezar de cero</button></div>` : ''}`;
    // la música en dos columnas: 4 opciones
    const segMusic = box.querySelector('[data-name="music"]') as HTMLElement;
    segMusic.style.gridTemplateColumns = '1fr 1fr';
    const segCam = box.querySelector('[data-name="camera"]') as HTMLElement | null;
    if (segCam) segCam.style.gridTemplateColumns = '1fr 1fr';
    const initialQ = o.quality;
    for (const g of box.querySelectorAll<HTMLElement>('.seg')) {
      for (const b of g.querySelectorAll<HTMLButtonElement>('button')) {
        b.addEventListener('click', () => {
          g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          const id = b.dataset.id!;
          if (g.dataset.name === 'quality') {
            o.setQuality(id);
            box.querySelector('.q-apply')?.classList.toggle('hidden', id === initialQ);
          } else if (g.dataset.name === 'music') o.music.set(Number(id));
          else if (g.dataset.name === 'camera') o.camera?.set(id);
        });
      }
    }
    box.querySelector('.q-apply')?.addEventListener('click', () => o.onReload?.());
    const restart = box.querySelector('.restart') as HTMLButtonElement | null;
    if (restart) {
      let armed = false;
      restart.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          restart.textContent = '¿Seguro? Tocá de nuevo para borrar';
          restart.style.borderColor = 'var(--teja)';
          restart.style.color = 'var(--teja)';
          return;
        }
        this.closeAll();
        o.onRestart?.();
      });
    }
    this.open('Opciones', box, { narrow: true });
  }

  // ---------------------------------------------------------------- álbum

  openAlbum(a: AlbumContext): void {
    const total = a.pois.length;
    const found = a.pois.filter((p) => a.discovered.has(p.id)).length;
    const box = document.createElement('div');
    const sheet = this.open('Postales', box, { count: `${found} de ${total}` });
    const townName = (id: string | null) => a.towns.find((t) => t.id === id)?.name ?? 'En el valle';
    const groups: { id: string; label: string }[] = [
      { id: 'all', label: 'Todas' },
      ...a.towns.filter((t) => a.pois.some((p) => p.town === t.id)).map((t) => ({ id: t.id, label: t.name })),
    ];
    if (a.pois.some((p) => !p.town)) groups.push({ id: 'none', label: 'En el valle' });
    let filter = 'all';
    const order = (p: POI) => (a.discovered.has(p.id) ? 0 : 1);
    const list = [...a.pois].sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name, 'es'));

    const showGrid = () => {
      const items = list.filter((p) => filter === 'all' || (filter === 'none' ? !p.town : p.town === filter));
      box.innerHTML = `
        <div class="album-progress"><div class="bar"><i style="width:${total ? (found / total) * 100 : 0}%"></i></div>
          <span class="label">${found === total ? '¡Completaste el álbum!' : found ? `Te faltan ${total - found} postales` : 'Acercate a los lugares marcados con una postal para sumarlas'}</span></div>
        <div class="filters" role="group" aria-label="Filtrar por pueblo">${groups.map((g) => `<button data-f="${g.id}" aria-pressed="${g.id === filter}">${esc(g.label)}</button>`).join('')}</div>
        <div class="album-grid"></div>`;
      const grid = box.querySelector('.album-grid') as HTMLElement;
      for (const p of items) {
        const got = a.discovered.has(p.id);
        const info = postcardFor(p.id);
        const card = document.createElement(got ? 'button' : 'div');
        card.className = 'pcard' + (got ? '' : ' locked');
        card.innerHTML = `<div class="pcard-img"><img loading="lazy" alt="" src="${postcardImage(p.id, true)}"></div><b></b><small></small>`;
        card.querySelector('b')!.textContent = got ? p.name : 'Postal sin descubrir';
        card.querySelector('small')!.textContent = got ? `${kindLabel(p.kind)} · ${townName(p.town)}` : info.hint;
        if (got) card.addEventListener('click', () => showPostal(p));
        grid.appendChild(card);
      }
      for (const b of box.querySelectorAll<HTMLButtonElement>('.filters button')) {
        b.addEventListener('click', () => { filter = b.dataset.f!; showGrid(); });
      }
    };

    const showPostal = (p: POI) => {
      const info = postcardFor(p.id);
      box.innerHTML = `
        <div class="postal-view">
          <div class="postal-frame"><img alt="" src="${postcardImage(p.id)}"></div>
          <div class="postal-text">
            <span class="label"></span>
            <h3></h3>
            <p></p>
            <div class="actions">
              ${a.onTravel ? '<button class="btn btn-primary go">Viajar acá</button>' : ''}
              <button class="btn btn-light back">Ver todas</button>
            </div>
          </div>
        </div>`;
      box.querySelector('.postal-text .label')!.textContent = `${kindLabel(p.kind)} · ${townName(p.town)}`;
      box.querySelector('h3')!.textContent = p.name;
      box.querySelector('.postal-text p')!.textContent = info.blurb;
      (box.querySelector('img') as HTMLImageElement).alt = `Postal ilustrada de ${p.name}`;
      box.querySelector('.back')!.addEventListener('click', () => { showGrid(); sheet.body.scrollTop = 0; });
      box.querySelector('.go')?.addEventListener('click', () => { sheet.close(); a.onTravel?.(p); });
      sheet.body.scrollTop = 0;
      (box.querySelector('.back') as HTMLElement).focus({ preventScroll: true });
    };

    const first = a.focus ? a.pois.find((p) => p.id === a.focus && a.discovered.has(p.id)) : undefined;
    if (first) showPostal(first);
    else showGrid();
  }

  // ---------------------------------------------------------------- pausa

  openPause(items: { id: string; label: string; icon?: string; primary?: boolean }[], pick: (id: string) => void): void {
    const box = document.createElement('div');
    box.className = 'menu-list';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = `btn btn-wide ${it.primary ? 'btn-primary' : 'btn-light'}`;
      b.innerHTML = `${it.icon ? `<img alt="" src="${asset(`brand/iconos/${it.icon}.webp`)}">` : ''}<span></span>`;
      b.querySelector('span')!.textContent = it.label;
      b.addEventListener('click', () => pick(it.id));
      box.appendChild(b);
    }
    const s = this.open('Vallecito', box, { narrow: true, className: 'pause-card' });
    (box.querySelector('button') as HTMLElement)?.focus({ preventScroll: true });
    void s;
  }
}

export interface OptionsContext {
  inGame: boolean;
  quality: string;
  setQuality(q: string): void;
  music: { options: string[]; index: number; set(i: number): void };
  camera?: { views: { id: string; label: string }[]; current: string; set(id: string): void };
  onReload?: () => void;
  onRestart?: () => void;
}

export interface AlbumContext {
  pois: POI[];
  towns: Town[];
  discovered: Set<string>;
  /** Solo dentro del juego: viajar a la postal. */
  onTravel?: (p: POI) => void;
  /** Abrir directamente esta postal. */
  focus?: string;
}

export const overlays = new Overlays();
