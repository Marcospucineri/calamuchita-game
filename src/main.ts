import './ui/styles.css';
import './ui/chrome.css';
import { QualityLevel } from './core/Config';
import { Game } from './core/Game';
import { Physics } from './engine/Physics';
import { TouchControls } from './engine/TouchControls';
import { guardBrowserGestures } from './engine/BrowserGuard';
import { SaveSystem } from './gameplay/SaveSystem';
import { CAR_PAINTS, CarPaint } from './player/Vehicle';
import { WorldData } from './world/WorldData';
import { overlays } from './ui/Overlays';
import { accounts } from './services/Accounts';
import { analytics } from './services/Analytics';
import { newProgress, normalizeProfile, postalRewards, tripReward } from './gameplay/Progress';
import { icon as lineIcon } from './ui/Icons';
import { openProfile } from './ui/Profile';
import routes from './gameplay/routes.json';
import { MUSIC_KEY, MUSIC_OPTIONS, readMusicIndex } from './engine/Music';

guardBrowserGestures();
analytics.init();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

const QKEY = 'calamuchita.quality';
const PKEY = 'calamuchita.carPaint';
const params = new URLSearchParams(location.search);
let save = SaveSystem.load();
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
      <p class="title-tag">Recorré el valle.</p>
    </header>
    <div class="title-dock">
    <section class="title-panel" aria-label="Empezar">
      <div class="title-place">${lineIcon('pin')}<span class="label edition">Valle de Calamuchita · Córdoba</span></div>
      <button class="profile-entry" type="button" disabled>${lineIcon('person')}<span class="profile-entry-copy"><strong>Tu personaje</strong><span class="profile-entry-detail">Nombre, aspecto y cuenta</span></span><span class="profile-entry-arrow" aria-hidden="true">›</span></button>
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
      <div class="load">
        <div class="load-bar"><i></i></div>
        <div class="departure-summary">${lineIcon('road')}<div><div class="load-label" role="status">Preparando el valle…</div><div class="load-detail"></div></div></div>
      </div>
      <div class="title-actions">
        <button class="btn btn-primary play" disabled><span>Cargando…</span></button>
      </div>
    </section>
      <nav class="title-links" aria-label="Más">
        <button data-l="album" disabled>${lineIcon('postal')}<span>Postales</span></button>
        <button data-l="options">${lineIcon('options')}<span>Opciones</span></button>
        <button data-l="controls">${lineIcon('controls')}<span>Controles</span></button>
        <button data-l="credits">${lineIcon('star')}<span>Créditos</span></button>
      </nav>
    </div>
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
      const musicIndex = readMusicIndex();
      overlays.openOptions({
        inGame: false,
        quality,
        setQuality: (q) => { quality = q as QualityLevel; try { localStorage.setItem(QKEY, quality); } catch { /* nada */ } },
        music: { options: MUSIC_OPTIONS, index: musicIndex, set: (i) => { try { localStorage.setItem(MUSIC_KEY, String(i)); } catch { /* nada */ } } },
        onRestart: save && !accounts.user ? () => startGame?.(true) : undefined,
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
      accounts.init(),
      // los carteles del mundo se pintan con la tipografía: tiene que estar cargada antes
      document.fonts?.load('700 32px "Josefin Sans"').catch(() => null),
      document.fonts?.load('400 32px "Berkshire Swash"').catch(() => null),
    ]);
    worldReady = world;
    save = SaveSystem.load();
    if (!params.has('vehicle')) vehicle = save?.vehicle ?? vehicle;
    if (CAR_PAINTS.some((p) => p.id === save?.paint)) { paint = save!.paint as CarPaint; markPaint(); }
    const profileButton = title.querySelector<HTMLButtonElement>('.profile-entry')!;
    const updateProfileButton = () => { profileButton.querySelector('.profile-entry-detail')!.textContent = save?.progress?.profile.name ? `${save.progress.profile.name} · Editar aspecto y cuenta` : 'Nombre, aspecto y cuenta'; };
    const editProfile = () => {
      const progress = save?.progress ?? newProgress();
      const balance = accounts.balance ?? postalRewards(world.pois, save?.discovered ?? []) + progress.trips.reduce((sum, t) => sum + tripReward(routes.find((r) => r.id === t.routeId)?.distance ?? 0), 0) + new Set(progress.photos ?? []).size * 10;
      openProfile(normalizeProfile(progress.profile), balance, (profile) => {
        progress.profile = profile;
        const st = world.meta.start;
        save = { version: 1, mode: 'driving', car: { ...st }, player: { x: st.x, n: st.n }, discovered: [], ...save, savedAt: Date.now(), vehicle, paint, progress };
        SaveSystem.save(save); void accounts.sync(save); updateProfileButton();
      });
    };
    profileButton.disabled = false;
    profileButton.addEventListener('click', editProfile);
    updateProfileButton();
    if (accounts.recovery || accounts.authError) editProfile();
    accounts.onChange(() => { if (accounts.recovery && !overlays.isOpen) editProfile(); });
    bar.style.width = '100%';
    title.classList.add('is-ready');
    const found = save?.discovered.length ?? 0;
    const refreshDeparture = () => {
      markVehicle();
      label.textContent = vehicle === 'plane' ? 'La avioneta te espera en la pista del aeroclub.'
        : save ? 'Tu auto te espera donde lo dejaste' : 'El valle te espera';
      title.querySelector('.load-detail')!.textContent = `${found} de ${world.pois.length} postales`;
      play.innerHTML = `<span>${vehicle === 'plane' ? 'Ir a la pista' : save ? 'Seguir paseando' : 'Arrancar'}</span>${lineIcon('arrow')}`;
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
          const game = new Game(world, canvas, ui, quality, fresh ? null : SaveSystem.load(), vehicle);
          game.player.car.setPaint(paint);
          label.textContent = 'Pintando el valle…';
          await game.warmup();
          game.start();
          analytics.event('game_start', { vehicle, quality });
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
