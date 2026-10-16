import { overlays, asset } from './Overlays';
import { analytics } from '../services/Analytics';
import type { Progress } from '../gameplay/Progress';
import { bus } from '../core/EventBus';

export const valleyDay = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Capture only the world canvas; HUD and menus never appear in the postcard. */
export async function openPhoto(source: HTMLCanvasElement, place: string, progress: Progress, onChange: () => void): Promise<void> {
  const portrait = source.clientHeight > source.clientWidth;
  const canvas = document.createElement('canvas');
  canvas.width = portrait ? 1080 : 1920; canvas.height = portrait ? 1920 : 1080;
  const g = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  g.fillStyle = '#f3e7c8'; g.fillRect(0, 0, w, h);
  const border = 36, footer = portrait ? 240 : 160;
  const iw = w - border * 2, ih = h - border - footer;
  const scale = Math.max(iw / source.width, ih / source.height);
  g.save(); g.beginPath(); g.rect(border, border, iw, ih); g.clip();
  g.drawImage(source, border + (iw - source.width * scale) / 2, border + (ih - source.height * scale) / 2, source.width * scale, source.height * scale);
  g.restore();
  const logo = new Image(); logo.src = asset('brand/logo.webp');
  try { await logo.decode(); g.drawImage(logo, border, h - footer + 20, 250, 110); } catch { /* the footer still contains the brand URL */ }
  g.fillStyle = '#24452f'; g.textAlign = 'right'; g.font = '700 32px "Josefin Sans"';
  g.fillText(place, w - border, h - footer + 64, portrait ? w - border * 2 : w - 360);
  g.font = '400 28px "Josefin Sans"'; g.fillText('vallecito.ar · Manejá el valle.', w - border, h - footer + 110);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { bus.emit('toast', { text: 'No se pudo preparar la foto', sub: 'Volvé a intentar en unos segundos.' }); return; }
  const url = URL.createObjectURL(blob);
  const body = document.createElement('div');
  body.className = 'photo-sheet';
  body.innerHTML = '<img alt="Tu paseo por Vallecito"><p>Una postal de tu paseo. La primera que compartís cada día suma 10 Serranos.</p><button class="btn btn-primary">Compartir mi foto</button><p class="photo-status" role="status" aria-live="polite"></p>';
  body.querySelector('img')!.src = url;
  const sheet = overlays.open('Saludos desde el valle', body, { onClose: () => URL.revokeObjectURL(url) });
  const button = body.querySelector('button')!;
  const feedback = body.querySelector('.photo-status')!;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const file = new File([blob], `vallecito-${valleyDay()}.png`, { type: 'image/png' });
    try {
      let method: string;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mi paseo por Vallecito', text: '#Vallecito · vallecito.ar' });
        method = 'native';
      } else {
        const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
        try { await navigator.clipboard.writeText('#Vallecito · vallecito.ar'); } catch { /* download works without clipboard permission */ }
        method = 'download';
      }
      analytics.event('share', { method, content_type: 'photo', item_id: place });
      const day = valleyDay();
      progress.photos ??= [];
      if (!progress.photos.includes(day)) {
        progress.photos.push(day);
        analytics.event('earn_virtual_currency', { virtual_currency_name: 'Serranos', value: 10, source: 'photo' });
        onChange();
        bus.emit('toast', { text: '+10 Serranos', sub: 'Tu primera foto compartida del día' });
      }
      sheet.close();
    } catch (e) {
      feedback.textContent = e instanceof Error && e.name === 'AbortError' ? 'Compartir se canceló. Tu foto sigue lista.' : 'No se pudo compartir. Volvé a intentar.';
      button.disabled = false;
    }
  });
}
