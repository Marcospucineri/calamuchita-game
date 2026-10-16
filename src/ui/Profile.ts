import { openRanking } from './Ranking';
import * as THREE from 'three';
import { createAvatar } from '../player/Character';
import { DEFAULT_PROFILE, HAIRSTYLES, HAIR_COLORS, SHIRTS, SKINS, normalizeProfile, type Profile } from '../gameplay/Progress';
import { accounts } from '../services/Accounts';
import { analytics } from '../services/Analytics';
import { googleIcon, icon } from './Icons';
import { overlays } from './Overlays';

export const serranoIcon = `<svg class="serrano-icon" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#e0a83a" stroke="#805a1e" stroke-width="2"/><circle cx="20" cy="20" r="14" fill="none" stroke="#fff0bb" stroke-width="1.4"/><path d="M8 27 18 12l6 9 3-4 7 10Z" fill="#24452f"/><path d="m14 18 4-6 4 6-4-2Z" fill="#fbf5e6"/></svg>`;

export function openProfile(profile: Profile, balance: number, onSave: (p: Profile) => void, beforeAuth: () => void = () => {}): void {
  const draft = normalizeProfile(profile);
  const body = document.createElement('div');
  const palette = (name: string, label: string, values: string[], current: string) => `<fieldset class="profile-swatches"><legend>${label}</legend>${values.map((v, i) => `<button type="button" data-${name}="${v}" aria-label="${label} ${i + 1}" aria-pressed="${v === current}" style="--sw:${v}"></button>`).join('')}</fieldset>`;
  body.innerHTML = `
    <section class="account-section account-top">
      <div class="account-hero">
        <div class="account-hero-copy"><span class="account-eyebrow">TU PASEO, SIEMPRE CON VOS</span><h3></h3><p class="account-status"></p></div>
        <div class="account-hero-buttons"></div>
      </div>
      <p class="auth-feedback" role="status" aria-live="polite"></p>
      <p class="account-privacy">Al crear una cuenta, guardamos tu perfil y tus paseos. <a href="${import.meta.env.BASE_URL}privacidad.html" target="_blank" rel="noopener">Privacidad</a></p>
      <div class="account-actions"></div>
    </section>
    <div class="profile-layout">
      <div class="avatar-preview" aria-label="Vista previa del personaje"><div class="avatar-stage"></div><span>Tu manera de andar el valle</span></div>
      <form class="profile-form">
        <label class="profile-label">¿Cómo te llamás?<input name="name" maxlength="24" required autocomplete="nickname"></label>
        ${palette('skin', 'Tono de piel', SKINS, draft.appearance.skin)}
        <label class="profile-label">Pelo<select name="hair">${HAIRSTYLES.map((style) => `<option value="${style.id}">${style.label}</option>`).join('')}</select></label>
        ${palette('hair-color', 'Color de pelo', HAIR_COLORS, draft.appearance.hairColor)}
        ${palette('shirt', 'Remera', SHIRTS, draft.appearance.shirt)}
        <label class="profile-check"><input name="beard" type="checkbox"> Barba corta</label>
        <p class="profile-note">Estos estilos son gratis desde el primer paseo.</p>
        <button class="btn btn-primary" type="submit">Guardar mi estilo</button>
      </form>
    </div>
    <div class="serranos-summary">${serranoIcon}<div><b>${balance} Serranos</b><p>50 por postal nueva · 200 por pueblo completo · 20 a 60 por llevar a alguien · 10 por la primera foto compartida del día.</p><p>La moneda del valle. La tienda de estilos llega más adelante.</p></div></div>
`;
  const name = body.querySelector<HTMLInputElement>('[name=name]')!;
  name.value = draft.name === DEFAULT_PROFILE.name ? '' : draft.name;
  name.placeholder = 'Tu nombre en el valle';
  body.querySelector<HTMLSelectElement>('[name=hair]')!.value = draft.appearance.hair;
  body.querySelector<HTMLInputElement>('[name=beard]')!.checked = draft.appearance.beard;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff5df, 0x697254, 3));
  const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(4, 6, 5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20); camera.position.set(4, 2.1, 3.5); camera.lookAt(0, 1, 0);
  let renderer: THREE.WebGLRenderer | null = null;
  let avatar: THREE.Group | null = null;
  const disposeAvatar = () => {
    if (!avatar) return;
    const materials = new Set<THREE.Material>();
    avatar.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m)); } });
    materials.forEach((m) => m.dispose()); scene.remove(avatar);
  };
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); renderer.setSize(240, 240); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    body.querySelector('.avatar-stage')!.appendChild(renderer.domElement);
  } catch { body.querySelector('.avatar-stage')!.textContent = 'Tu estilo se verá al caminar por el valle.'; }
  const preview = () => { disposeAvatar(); avatar = createAvatar(draft.appearance).mesh; scene.add(avatar); renderer?.render(scene, camera); };
  preview();
  const sheet = overlays.open('Tu lugar en el valle', body, { className: 'profile-card', onClose: () => { disposeAvatar(); renderer?.dispose(); renderer?.forceContextLoss(); } });
  body.querySelector('.profile-form')!.addEventListener('submit', (e) => { e.preventDefault(); draft.name = name.value; onSave(normalizeProfile(draft)); sheet.close(); });
  body.querySelectorAll<HTMLButtonElement>('[data-skin], [data-shirt], [data-hair-color]').forEach((b) => b.addEventListener('click', () => {
    const prop = b.dataset.skin ? 'skin' : b.dataset.shirt ? 'shirt' : 'hairColor';
    draft.appearance[prop] = b.dataset.skin ?? b.dataset.shirt ?? b.dataset.hairColor!;
    b.closest('fieldset')!.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button === b)));
    preview();
  }));
  body.querySelector<HTMLSelectElement>('[name=hair]')!.addEventListener('change', (e) => { draft.appearance.hair = (e.target as HTMLSelectElement).value as Profile['appearance']['hair']; preview(); });
  body.querySelector<HTMLInputElement>('[name=beard]')!.addEventListener('change', (e) => { draft.appearance.beard = (e.target as HTMLInputElement).checked; preview(); });
  const status = body.querySelector('.account-status')!;
  const actions = body.querySelector<HTMLElement>('.account-actions')!;
  const heroButtons = body.querySelector<HTMLElement>('.account-hero-buttons')!;
  body.querySelector('.account-hero h3')!.textContent = accounts.user ? 'El valle se acuerda de vos' : 'Que el valle se acuerde de vos';
  status.textContent = accounts.user ? accounts.status : 'Creá tu cuenta y llevá tus postales, tu estilo y tus Serranos a donde vayas.';
  if (!accounts.client) {
    status.textContent = 'Tu progreso queda en este navegador. Las cuentas estarán disponibles cuando se conecte el servicio de guardado.';
    return;
  }
  const preserve = () => { draft.name = name.value || 'Visitante'; onSave(normalizeProfile(draft)); beforeAuth(); };
  if (accounts.user && !accounts.recovery) {
    heroButtons.innerHTML = '<button class="btn btn-light profile-ranking" type="button">Ranking del valle</button><button class="account-signout" type="button">Cerrar sesión</button>';
    heroButtons.querySelector('.profile-ranking')!.addEventListener('click', openRanking);
    heroButtons.querySelector('.account-signout')!.addEventListener('click', async (e) => {
      const button = e.currentTarget as HTMLButtonElement; button.disabled = true;
      try { preserve(); await accounts.signOut(); } catch { status.textContent = 'No se pudo cerrar sesión. Volvé a intentar.'; button.disabled = false; }
    });
    return;
  }
  let authMode: 'signup' | 'login' = 'signup';
  heroButtons.innerHTML = accounts.recovery ? '' : `
    ${accounts.googleEnabled ? `<button class="google-login" type="button">${googleIcon}<span>Seguir con Google</span></button>` : ''}
    <button class="btn btn-primary account-cta" type="button">Crear mi cuenta ${icon('arrow')}</button>
    <button class="account-signin" type="button">Ya tengo cuenta</button>`;
  actions.classList.toggle('hidden', !accounts.recovery);
  actions.innerHTML = `<form class="auth-form">
    <h4 class="auth-heading">${accounts.recovery ? 'Elegí una nueva contraseña' : 'Creá tu cuenta con email'}</h4>
    ${accounts.recovery ? '' : '<label class="profile-label">Email<input name="email" type="email" autocomplete="email" required></label>'}
    <label class="profile-label">${accounts.recovery ? 'Nueva contraseña' : 'Contraseña'}<input name="password" type="password" minlength="8" autocomplete="${accounts.recovery ? 'new-password' : 'current-password'}" required></label>
    <div class="auth-buttons"><button class="btn btn-primary auth-submit" type="submit">${accounts.recovery ? 'Actualizar contraseña' : 'Crear cuenta'}</button>${accounts.recovery ? '' : '<button class="text-button auth-switch" type="button">Ya tengo cuenta</button>'}</div>
    ${accounts.recovery ? '' : '<button class="text-button recover hidden" type="button">Olvidé mi contraseña</button>'}
    </form>`;
  const form = actions.querySelector('form')!;
  const feedback = body.querySelector('.auth-feedback')!;
  feedback.textContent = accounts.authError ?? '';
  const showAuth = (mode: 'signup' | 'login') => {
    authMode = mode;
    actions.classList.remove('hidden');
    actions.querySelector('.auth-heading')!.textContent = mode === 'signup' ? 'Creá tu cuenta con email' : 'Qué bueno verte de nuevo';
    actions.querySelector('.auth-submit')!.textContent = mode === 'signup' ? 'Crear cuenta' : 'Entrar';
    actions.querySelector('.auth-switch')!.textContent = mode === 'signup' ? 'Ya tengo cuenta' : 'Crear una cuenta';
    actions.querySelector('.recover')!.classList.toggle('hidden', mode !== 'login');
    actions.querySelector<HTMLInputElement>('[name=password]')!.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    actions.querySelector<HTMLInputElement>('[name=email]')!.focus({ preventScroll: true });
    actions.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  heroButtons.querySelector('.account-cta')?.addEventListener('click', () => showAuth('signup'));
  heroButtons.querySelector('.account-signin')?.addEventListener('click', () => showAuth('login'));
  actions.querySelector('.auth-switch')?.addEventListener('click', () => showAuth(authMode === 'signup' ? 'login' : 'signup'));
  let busy = false;
  const run = async (action: () => Promise<void>) => {
    if (busy) return; busy = true;
    body.querySelectorAll<HTMLButtonElement>('.account-section button').forEach((b) => { b.disabled = true; }); feedback.textContent = 'Conectando…';
    try { preserve(); await action(); } catch { feedback.textContent = 'No se pudo completar. Revisá tus datos, la conexión y la confirmación del email.'; }
    finally { busy = false; body.querySelectorAll<HTMLButtonElement>('.account-section button').forEach((b) => { b.disabled = false; }); }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = actions.querySelector<HTMLInputElement>('[name=email]')?.value ?? '';
    const password = actions.querySelector<HTMLInputElement>('[name=password]')!.value;
    const signup = authMode === 'signup' && !accounts.recovery;
    void run(async () => {
      const result = accounts.recovery ? await accounts.client!.auth.updateUser({ password }) : signup
        ? await accounts.client!.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
        : await accounts.client!.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (accounts.recovery) accounts.recovery = false;
      analytics.event(signup ? 'sign_up' : 'login', { method: 'password' });
      if (!accounts.recovery && 'session' in result.data && !result.data.session) { feedback.textContent = 'Revisá tu email para confirmar la cuenta. Tu progreso sigue guardado acá.'; return; }
      location.href = location.pathname;
    });
  });
  heroButtons.querySelector('.google-login')?.addEventListener('click', () => void run(async () => {
    const { error } = await accounts.client!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }); if (error) throw error;
  }));
  actions.querySelector('.recover')?.addEventListener('click', () => {
    const email = actions.querySelector<HTMLInputElement>('[name=email]')!;
    if (!email.reportValidity() || !email.value) return;
    void run(async () => {
      const { error } = await accounts.client!.auth.resetPasswordForEmail(email.value, { redirectTo: location.origin + location.pathname }); if (error) throw error;
      feedback.textContent = 'Si ese email tiene cuenta, te llegará un enlace para cambiar la contraseña.';
    });
  });
}
