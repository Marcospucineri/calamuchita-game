import './ui/styles.css';
import { QualityLevel } from './core/Config';
import { Game } from './core/Game';
import { Physics } from './engine/Physics';
import { TouchControls } from './engine/TouchControls';
import { guardBrowserGestures } from './engine/BrowserGuard';
import { SaveSystem } from './gameplay/SaveSystem';
import { CAR_PAINTS, CarPaint } from './player/Vehicle';
import { WorldData } from './world/WorldData';
import { overlays } from './ui/Overlays';
import { MUSIC_KEY, MUSIC_OPTIONS } from './engine/Music';

guardBrowserGestures();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const QKEY = 'calamuchita.quality';
const PKEY = 'calamuchita.carPaint';
const params = new URLSearchParams(location.search);
const save = SaveSystem.load();
let vehicle: 'car' | 'plane' = params.get('vehicle') === 'plane' ? 'plane' : params.get('vehicle') === 'car' ? 'car' : save?.vehicle ?? 'car';
let quality: QualityLevel = TouchControls.isTouch() ? 'baja' : 'media';
try {
  const q = localStorage.getItem(QKEY) as QualityLevel | null;
  if (q === 'baja' || q === 'media' || q === 'alta') quality = q;
} catch { /* sin almacenamiento */ }
let paint: CarPaint = 'arena';
try {
  const v = localStorage.getItem(PKEY);
  if (CAR_PAINTS.some((p) => p.id === v)) paint = v as CarPaint;
} catch { /* sin almacenamiento */ }

const icon = (n: string) => `${import.meta.env.BASE_URL}brand/iconos/${n}.webp`;
const title = document.createElement('div');
title.className = 'title';
title.innerHTML = `
  <img class="title-bg" alt="" src="${import.meta.env.BASE_URL}brand/key-art.webp" fetchpriority="high">
  <div class="title-layout">
    <header class="title-brand">
      <h1 style="margin:0"><img class="title-logo" src="${import.meta.env.BASE_URL}brand/logo.webp" alt="Vallecito" width="1000" height="442"></h1>
      <p class="title-tag">Manejá el valle.</p>
    </header>
    <section class="title-panel" aria-label="Empezar">
      <span class="label edition">Valle de Calamuchita · Córdoba</span>
      <div class="choose">
        <div class="seg vehicle-choice" role="group" aria-label="Elegí tu vehículo">
          <button data-vehicle="car" aria-pressed="true" disabled><img alt="" src="${icon('auto')}">Auto</button>
          <button data-vehicle="plane" aria-pressed="false" disabled><img alt="" src="${icon('avioneta')}">Avioneta</button>
        </div>
        <div class="paint" role="radiogroup" aria-label="Color del auto">
          <span>Color del auto</span>
          ${CAR_PAINTS.map((p) => `<button role="radio" data-paint="${p.id}" aria-checked="false" aria-label="${p.label}" title="${p.label}" style="--sw:${p.swatch}"></button>`).join('')}
        </div>
        <div class="departure-note hidden">La avioneta sale siempre del Aeroclub de Villa General Belgrano.</div>
      </div>
      <div class="load"><div class="load-bar"><i></i></div><div class="load-label">Preparando el valle…</div></div>
      <div class="title-actions">
        <button class="btn btn-primary play" disabled>Cargando…</button>
      </div>
      <nav class="title-links" aria-label="Más">
        <button data-l="album" disabled>Postales</button>
        <button data-l="options">Opciones</button>
        <button data-l="controls">Controles</button>
        <button data-l="credits">Créditos</button>
      </nav>
    </section>
  </div>`;
document.body.appendChild(title);
const bar = title.querySelector('.load-bar i') as HTMLElement;
const label = title.querySelector('.load-label') as HTMLElement;
const play = title.querySelector('.play') as HTMLButtonElement;
const vButtons = [...title.querySelectorAll<HTMLButtonElement>('.vehicle-choice button')];
const albumLink = title.querySelector('[data-l="album"]') as HTMLButtonElement;
let worldReady: WorldData | null = null;
let startGame: ((fresh: boolean) => void) | null = null;

for (const b of title.querySelectorAll<HTMLButtonElement>('.title-links button')) {
  b.addEventListener('click', () => {
    const l = b.dataset.l;
    if (l === 'credits') overlays.openCredits();
    else if (l === 'controls') overlays.openControls(TouchControls.isTouch());
    else if (l === 'album' && worldReady) overlays.openAlbum({ pois: worldReady.pois, towns: worldReady.meta.towns, discovered: new Set(save?.discovered ?? []) });
    else if (l === 'options') {
      let musicIndex = 0;
      try { musicIndex = Number(localStorage.getItem(MUSIC_KEY)) || 0; } catch { /* sin almacenamiento */ }
      overlays.openOptions({
        inGame: false,
        quality,
        setQuality: (q) => { quality = q as QualityLevel; try { localStorage.setItem(QKEY, quality); } catch { /* nada */ } },
        music: { options: MUSIC_OPTIONS, index: musicIndex, set: (i) => { try { localStorage.setItem(MUSIC_KEY, String(i)); } catch { /* nada */ } } },
        onRestart: save ? () => startGame?.(true) : undefined,
      });
    }
  });
}

const paintBox = title.querySelector('.paint') as HTMLElement;
const departure = title.querySelector('.departure-note') as HTMLElement;
const pButtons = [...paintBox.querySelectorAll<HTMLButtonElement>('button')];
const markPaint = () => pButtons.forEach((b) => { const on = b.dataset.paint === paint; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
markPaint();
pButtons.forEach((b, i) => {
  b.addEventListener('click', () => {
    paint = b.dataset.paint as CarPaint;
    try { localStorage.setItem(PKEY, paint); } catch { /* nada */ }
    markPaint();
  });
  // flechas para moverse entre colores (grupo de opciones)
  b.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const nb = pButtons[(i + d + pButtons.length) % pButtons.length];
    nb.click();
    nb.focus();
  });
});
const markVehicle = () => {
  vButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vehicle === vehicle)));
  paintBox.classList.toggle('hidden', vehicle !== 'car');
  departure.classList.toggle('hidden', vehicle !== 'plane');
};
markVehicle();

async function boot(): Promise<void> {
  try {
    const [world] = await Promise.all([
      WorldData.load('./world/', (p, l) => { bar.style.width = `${Math.round(p * 85)}%`; label.textContent = l + '…'; }),
      Physics.init(),
      // los carteles del mundo se pintan con la tipografía: tiene que estar cargada antes
      document.fonts?.load('700 32px "Josefin Sans"').catch(() => null),
      document.fonts?.load('400 32px "Berkshire Swash"').catch(() => null),
    ]);
    worldReady = world;
    bar.style.width = '100%';
    const found = save?.discovered.length ?? 0;
    const refreshDeparture = () => {
      markVehicle();
      label.textContent = vehicle === 'plane' ? 'La avioneta te espera en la pista del aeroclub.'
        : save ? `Tu auto te espera donde lo dejaste · ${found} de ${world.pois.length} postales`
        : `Listo. ${world.pois.length} postales te esperan en el valle.`;
      play.textContent = vehicle === 'plane' ? 'Ir a la pista' : save ? 'Seguir paseando' : 'Arrancar';
    };
    vButtons.forEach((b) => b.addEventListener('click', () => {
      vehicle = b.dataset.vehicle as 'car' | 'plane';
      refreshDeparture();
    }));
    [...vButtons, play, albumLink].forEach((b) => { b.disabled = false; });
    refreshDeparture();
    let starting = false;

    startGame = (fresh: boolean) => {
      if (starting) return;
      starting = true;
      overlays.closeAll();
      [...vButtons, play, albumLink].forEach((b) => { b.disabled = true; });
      play.textContent = 'Cargando…';
      label.textContent = 'Armando el paisaje…';
      // dejar que se pinte el mensaje antes del trabajo pesado
      setTimeout(async () => {
        try {
          if (fresh) SaveSystem.clear();
          const game = new Game(world, canvas, ui, quality, fresh ? null : save, vehicle);
          game.player.car.setPaint(paint);
          label.textContent = 'Pintando el valle…';
          await game.warmup();
          game.start();
          // ?debug: modo dios y anotaciones (se baja aparte; no pesa en el juego normal)
          if (params.has('debug')) import('./debug/Debug').then((m) => m.installDebug(game)).catch((e) => console.error('No se pudo cargar el modo debug', e));
          title.classList.add('out');
          setTimeout(() => title.remove(), 900);
        } catch (e) {
          console.error(e);
          label.textContent = 'No se pudo iniciar el paseo. Recargá la página para volver a intentar.';
        }
      }, 30);
    };
    play.addEventListener('click', () => startGame?.(false));
    // ?auto=1 arranca solo (útil para pruebas)
    if (params.has('auto')) startGame(params.has('fresh'));
  } catch (e) {
    console.error(e);
    label.innerHTML = `<span class="error">No se pudo cargar el mundo.</span> ${(e as Error).message}. ¿Corriste <kbd>npm run world</kbd>?`;
  }
}

boot();
