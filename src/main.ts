import './ui/styles.css';
import { QualityLevel } from './core/Config';
import { Game } from './core/Game';
import { Physics } from './engine/Physics';
import { TouchControls } from './engine/TouchControls';
import { SaveSystem } from './gameplay/SaveSystem';
import { WorldData } from './world/WorldData';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const QKEY = 'calamuchita.quality';
const params = new URLSearchParams(location.search);
const save = SaveSystem.load();
let vehicle: 'car' | 'plane' = params.get('vehicle') === 'plane' ? 'plane' : params.get('vehicle') === 'car' ? 'car' : save?.vehicle ?? 'car';
let quality: QualityLevel = TouchControls.isTouch() ? 'baja' : 'media';
try {
  const q = localStorage.getItem(QKEY) as QualityLevel | null;
  if (q === 'baja' || q === 'media' || q === 'alta') quality = q;
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
    <div class="credits">Geografía real: © colaboradores de OpenStreetMap · Relieve: Terrarium / AWS Open Data</div>
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

const markVehicle = () => vButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vehicle === vehicle)));
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
          label.textContent = 'Pintando el valle…';
          await game.warmup();
          game.start();
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
