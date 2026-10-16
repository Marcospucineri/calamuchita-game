import { accounts } from '../services/Accounts';
import { distances, TRAVEL_CATEGORIES, type TravelCategory } from '../services/Distances';
import { overlays } from './Overlays';

export function openRanking(): void {
  if (!accounts.user) return;
  const body = document.createElement('div');
  body.className = 'ranking';
  body.innerHTML = `<p class="ranking-intro">Cada camino cuenta. Los kilómetros del valle, entre quienes lo recorren.</p>
    <div class="ranking-categories" role="group" aria-label="Categoría del ranking">${TRAVEL_CATEGORIES.map((c) => `<button type="button" data-category="${c.id}" aria-pressed="${c.id === 'car'}">${c.label}</button>`).join('')}</div>
    <p class="ranking-status" role="status" aria-live="polite"></p>
    <div class="ranking-results"></div>
    <p class="ranking-note">Los 50 que más recorrieron, más tu posición. Solo se cuentan recorridos con sesión iniciada desde que se incorporó el ranking. Los viajes rápidos no suman kilómetros.</p>`;
  let closed = false, revision = 0;
  overlays.open('Kilómetros de valle', body, { className: 'ranking-card', onClose: () => { closed = true; } });
  const status = body.querySelector<HTMLElement>('.ranking-status')!;
  const results = body.querySelector<HTMLElement>('.ranking-results')!;
  const load = async (category: TravelCategory) => {
    const request = ++revision;
    body.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.category === category)));
    status.textContent = 'Buscando caminos recorridos…';
    results.replaceChildren();
    try {
      const synced = await distances.flush();
      const rows = await distances.ranking(category);
      if (closed || request !== revision) return;
      const hasDistances = rows.some((r) => r.meters > 0);
      status.textContent = !synced ? 'Tus últimos kilómetros esperan conexión. Mostramos lo que ya está guardado.' : hasDistances ? '' : 'El valle espera sus primeros kilómetros. ¡Podés estrenar este ranking!';
      const table = document.createElement('table');
      table.innerHTML = '<caption class="sr-only"></caption><thead><tr><th scope="col">Puesto</th><th scope="col">Personaje</th><th scope="col">Kilómetros</th></tr></thead><tbody></tbody>';
      table.querySelector('caption')!.textContent = `Ranking en ${TRAVEL_CATEGORIES.find((c) => c.id === category)!.label}`;
      for (const row of rows) {
        const tr = document.createElement('tr');
        tr.classList.toggle('ranking-me', row.is_me);
        const rank = document.createElement('td'); rank.textContent = row.position ? String(row.position) : '—';
        const name = document.createElement('th'); name.scope = 'row'; name.textContent = row.name + (row.is_me ? ' · vos' : '');
        const km = document.createElement('td'); km.textContent = (row.meters / 1000).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        tr.append(rank, name, km); table.querySelector('tbody')!.appendChild(tr);
      }
      results.appendChild(table);
    } catch (error) {
      if (closed || request !== revision) return;
      status.textContent = (error as Error).message;
      const retry = document.createElement('button'); retry.className = 'btn btn-light'; retry.textContent = 'Volver a intentar'; retry.addEventListener('click', () => void load(category)); results.appendChild(retry);
    }
  };
  body.querySelectorAll<HTMLButtonElement>('[data-category]').forEach((b) => b.addEventListener('click', () => void load(b.dataset.category as TravelCategory)));
  void load('car');
}
