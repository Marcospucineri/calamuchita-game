import './ui/styles.css';
import { QualityLevel } from './core/Config';
import { Game } from './core/Game';
import { Physics } from './engine/Physics';
import { TouchControls } from './engine/TouchControls';
import { guardBrowserGestures } from './engine/BrowserGuard';
import { SaveSystem } from './gameplay/SaveSystem';
import { CAR_PAINTS, CarPaint } from './player/Vehicle';
import { WorldData } from './world/WorldData';

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
let paint: CarPaint = 'gris';
try {
  const v = localStorage.getItem(PKEY);
  if (CAR_PAINTS.some((p) => p.id === v)) paint = v as CarPaint;
} catch { /* sin almacenamiento */ }

const title = document.createElement('div');
title.className = 'title';
title.innerHTML = `
  <div class="title-card">
    <div class="eyebrow">Córdoba · Argentina</div>
    <h1>Calamuchita</h1>
    <p>Recorré el valle en auto o avioneta y descubrí las postales de cada lugar.</p>
    <div class="towns"><span>Villa General Belgrano</span><span>Los Reartes</span><span>Villa Ciudad Parque</span></div>
    <div class="vehicle-choice" role="group" aria-label="Elegí tu vehículo">
      <button data-vehicle="car" aria-pressed="true" disabled>Auto</button>
      <button data-vehicle="plane" aria-pressed="false" disabled>Avioneta</button>
    </div>
    <div class="paint-choice" role="radiogroup" aria-label="Color del Fiat">
      <span>Color del Fiat</span>
      ${CAR_PAINTS.map((p) => `<button role="radio" data-paint="${p.id}" aria-checked="false" aria-label="${p.label}" title="${p.label}" style="--sw:${p.swatch}"></button>`).join('')}
    </div>
    <div class="departure-note">La avioneta siempre sale del Aeroclub de Villa General Belgrano.</div>
    <div class="bar"><i></i></div>
    <div class="load-label">Preparando el valle…</div>
    <div class="title-actions">
      <button class="play" disabled>Cargando…</button>
      <button class="linkish restart hidden" disabled>Empezar de nuevo desde el portal</button>
    </div>
    <div class="quality">Calidad:
      <button disabled data-q="baja">Baja</button><button disabled data-q="media">Media</button><button disabled data-q="alta">Alta</button>
    </div>
    <div class="credits">Geografía real: © colaboradores de OpenStreetMap · Relieve: Terrarium / AWS Open Data<br>Fiat Uno 3D: <a href="https://sketchfab.com/3d-models/psx-fiat-uno-5-door-7340fb8b784b4e799f40b2bd62b9afa1" target="_blank" rel="noopener noreferrer">Elite engineer</a> · CC BY 4.0 · Deck y locales de Las Magnolias: <a href="https://www.instagram.com/antooaleman/" target="_blank" rel="noopener noreferrer">@antooaleman</a></div>
  </div>`;
document.body.appendChild(title);
const bar = title.querySelector('.bar i') as HTMLElement;
const label = title.querySelector('.load-label') as HTMLElement;
const play = title.querySelector('.play') as HTMLButtonElement;
const restart = title.querySelector('.restart') as HTMLButtonElement;
const vButtons = [...title.querySelectorAll<HTMLButtonElement>('.vehicle-choice button')];
const qButtons = [...title.querySelectorAll<HTMLButtonElement>('.quality button')];
const markQ = () => qButtons.forEach((b) => b.classList.toggle('on', b.dataset.q === quality));
markQ();
qButtons.forEach((b) => b.addEventListener('click', () => {
  quality = b.dataset.q as QualityLevel;
  try { localStorage.setItem(QKEY, quality); } catch { /* nada */ }
  markQ();
}));

const paintBox = title.querySelector('.paint-choice') as HTMLElement;
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
};
markVehicle();

async function boot(): Promise<void> {
  try {
    const [world] = await Promise.all([
      WorldData.load('./world/', (p, l) => { bar.style.width = `${Math.round(p * 85)}%`; label.textContent = l + '…'; }),
      Physics.init(),
    ]);
    bar.style.width = '100%';
    const refreshDeparture = () => {
      markVehicle();
      label.textContent = vehicle === 'plane' ? 'Listo. La avioneta te espera en la pista del aeroclub.' : save ? 'Tu auto te espera donde lo dejaste.' : 'Listo. El auto está en la entrada de Villa General Belgrano.';
      play.textContent = vehicle === 'plane' ? 'Ir a la pista' : save ? 'Seguir paseando' : 'Arrancar';
      restart.textContent = vehicle === 'plane' ? 'Borrar la partida y empezar desde el aeroclub' : 'Borrar la partida y empezar desde el portal';
    };
    vButtons.forEach((b) => b.addEventListener('click', () => {
      vehicle = b.dataset.vehicle as 'car' | 'plane';
      refreshDeparture();
    }));
    if (save) restart.classList.remove('hidden');
    [...vButtons, ...qButtons, play, restart].forEach((b) => { b.disabled = false; });
    refreshDeparture();
    let starting = false;

    const startGame = (fresh: boolean) => {
      if (starting) return;
      starting = true;
      [...vButtons, ...qButtons, play, restart].forEach((b) => { b.disabled = true; });
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
    play.addEventListener('click', () => startGame(false));
    restart.addEventListener('click', () => startGame(true));
    // ?auto=1 arranca solo (útil para pruebas)
    if (params.has('auto')) startGame(params.has('fresh'));
  } catch (e) {
    console.error(e);
    label.innerHTML = `<span class="error">No se pudo cargar el mundo.</span> ${(e as Error).message}. ¿Corriste <kbd>npm run world</kbd>?`;
  }
}

boot();
