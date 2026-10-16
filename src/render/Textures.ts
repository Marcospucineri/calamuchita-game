import * as THREE from 'three';

/**
 * Texturas procedurales dibujadas en canvas: no hace falta bajar imágenes
 * y todo comparte el mismo "trazo" pintado a mano.
 */

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pinceladas en escala de grises, tileable. Se usa para modular la luz de todo. */
export function brushTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S;
    const len = 10 + rnd() * 34, wid = 3 + rnd() * 7;
    const ang = -0.5 + rnd() * 0.5 + (rnd() < 0.25 ? Math.PI / 2 : 0);
    const v = Math.floor(70 + rnd() * 120);
    g.fillStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.25})`;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(ang);
      g.beginPath();
      g.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  return tex(c, true, false);
}

/** Rampa de sombreado tipo toon con bandas suaves. */
export function toonRamp(): THREE.DataTexture {
  const vals = [96, 150, 205, 242, 255];
  const data = new Uint8Array(vals.length * 4);
  vals.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const t = new THREE.DataTexture(data, vals.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Asfalto con doble línea amarilla y bordes blancos (u: ancho 0..1, v: metros/8). */
export function asphaltTexture(lines: boolean): THREE.CanvasTexture {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#5f5b55';
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 1800; i++) {
    const v = 70 + rnd() * 50;
    g.fillStyle = `rgba(${v},${v - 3},${v - 6},0.35)`;
    g.fillRect(rnd() * 256, rnd() * 512, 2 + rnd() * 4, 2 + rnd() * 4);
  }
  // parches y grietas
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(40,38,36,0.18)';
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 512, 20 + rnd() * 40, 8 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // bordes gastados
  const edge = g.createLinearGradient(0, 0, 256, 0);
  edge.addColorStop(0, 'rgba(150,120,80,0.55)');
  edge.addColorStop(0.05, 'rgba(150,120,80,0)');
  edge.addColorStop(0.95, 'rgba(150,120,80,0)');
  edge.addColorStop(1, 'rgba(150,120,80,0.55)');
  g.fillStyle = edge;
  g.fillRect(0, 0, 256, 512);
  if (lines) {
    g.fillStyle = 'rgba(232,228,214,0.85)';
    g.fillRect(14, 0, 6, 512);
    g.fillRect(236, 0, 6, 512);
    g.fillStyle = 'rgba(228,178,40,0.95)';
    g.fillRect(118, 0, 6, 512);
    g.fillRect(132, 0, 6, 512);
  }
  return tex(c);
}

export function gravelTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#b39467';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.3 ? 'rgba(120,95,65,0.5)' : v < 0.6 ? 'rgba(205,185,150,0.5)' : 'rgba(150,140,125,0.5)';
    const s = 1 + rnd() * 3.5;
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 256, s, s * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // huellas de ruedas
  g.fillStyle = 'rgba(110,85,55,0.22)';
  g.fillRect(50, 0, 34, 256);
  g.fillRect(172, 0, 34, 256);
  return tex(c);
}

export function pavingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#7a7166';
  g.fillRect(0, 0, 256, 256);
  const s = 21;
  for (let y = 0; y < 256; y += s) for (let x = (y / s) % 2 ? -s / 2 : 0; x < 256; x += s) {
    const v = 120 + rnd() * 40;
    g.fillStyle = `rgb(${v},${v - 8},${v - 18})`;
    g.fillRect(x + 1.5, y + 1.5, s - 3, s - 3);
  }
  return tex(c);
}

/** Paredes por estilo. u = metros/4 (un módulo de ventana), v = metros/3 (un piso). */
export function wallTexture(style: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 192);
  const base = style === 'alpino' ? '#efe3c8' : style === 'criollo' ? '#f1ece2' : style === 'serrano' ? '#a77a4f' : style === 'comun' ? '#e9d2b4'
    : style === 'localA' ? '#f1e7d0' : style === 'localB' ? '#d9e4de' : style === 'localC' ? '#efcfae' : style === 'premium' ? '#f6f2ea' : '#e6dccb';
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 192);
  // textura de revoque / madera
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${style === 'serrano' ? '60,35,20' : '150,130,100'},${0.04 + rnd() * 0.06})`;
    g.fillRect(rnd() * 256, rnd() * 192, 3 + rnd() * 12, 2 + rnd() * 4);
  }
  if (style === 'serrano') {
    g.strokeStyle = 'rgba(70,40,22,0.6)';
    g.lineWidth = 3;
    for (let y = 0; y < 192; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  }
  if (style === 'alpino') {
    // entramado de madera (fachwerk)
    g.strokeStyle = '#4a2e1c';
    g.lineWidth = 11;
    g.strokeRect(5, 5, 246, 182);
    g.beginPath();
    g.moveTo(5, 100); g.lineTo(251, 100);
    g.moveTo(128, 5); g.lineTo(128, 187);
    g.moveTo(5, 187); g.lineTo(60, 100);
    g.moveTo(251, 187); g.lineTo(196, 100);
    g.stroke();
  }
  if (style === 'criollo') {
    g.fillStyle = 'rgba(160,140,110,0.35)';
    g.fillRect(0, 172, 256, 20); // zócalo
  }
  if (style === 'premium') {
    // zócalo de piedra
    g.fillStyle = '#9a8f80';
    g.fillRect(0, 160, 256, 32);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = rnd() < 0.5 ? '#b3a898' : '#857a6c';
      g.fillRect(rnd() * 256, 162 + rnd() * 26, 14 + rnd() * 18, 6 + rnd() * 6);
    }
  }
  // ventana con postigos
  const wx = 92, wy = 34, ww = 72, wh = 62;
  const shutter = style === 'alpino' ? '#2f5a3a' : style === 'criollo' ? '#3c6a7a' : style === 'comun' || style.startsWith('local') ? '#8a8f86' : style === 'premium' ? '#3d3a35' : '#6b3f22';
  g.fillStyle = shutter;
  g.fillRect(wx - 26, wy, 24, wh);
  g.fillRect(wx + ww + 2, wy, 24, wh);
  g.fillStyle = '#6b4a30';
  g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
  g.fillStyle = '#2b3a44';
  g.fillRect(wx, wy, ww, wh);
  g.fillStyle = 'rgba(160,200,220,0.35)';
  g.fillRect(wx + 4, wy + 4, ww / 2 - 6, wh / 2 - 6);
  g.fillStyle = '#6b4a30';
  g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
  g.fillRect(wx, wy + wh / 2 - 2, ww, 4);
  if (style === 'alpino') {
    // jardinera con flores
    g.fillStyle = '#5a3a22';
    g.fillRect(wx - 6, wy + wh + 2, ww + 12, 10);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = rnd() < 0.5 ? '#c8382c' : '#e46a3c';
      g.beginPath();
      g.arc(wx - 2 + rnd() * (ww + 4), wy + wh + 1, 3 + rnd() * 2, 0, Math.PI * 2);
      g.fill();
    }
  }
  return tex(c);
}

/** Tejas / chapa. u = metros/3, v = metros/3. */
export function roofTexture(kind: 'teja' | 'chapa' | 'tejuela'): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const base = kind === 'teja' ? '#9b4a2b' : kind === 'chapa' ? '#6f7471' : '#5b3f2d';
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  if (kind === 'chapa') {
    for (let x = 0; x < 128; x += 8) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, 0, 3, 128); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 4, 0, 2, 128); }
  } else {
    for (let y = 0; y < 128; y += 12) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, y, 128, 3);
      for (let x = (y / 12) % 2 ? 0 : 8; x < 128; x += 16) {
        const v = rnd() * 0.18;
        g.fillStyle = `rgba(${kind === 'teja' ? '255,170,120' : '200,160,120'},${v})`;
        g.fillRect(x, y + 3, 14, 9);
      }
    }
  }
  return tex(c);
}

export function stoneTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#8d877a';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 28) for (let x = (y / 28) % 2 ? -20 : 0; x < 256; x += 42) {
    const v = 120 + rnd() * 50;
    g.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
    g.beginPath();
    g.ellipse(x + 21, y + 14, 19, 12, 0, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** Cartel tallado en madera del portal de entrada. */
export function signTexture(title: string, subtitle: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#9a5d33');
  grad.addColorStop(1, '#6e3d1f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 256);
  for (let y = 0; y < 256; y += 6) { g.fillStyle = `rgba(40,20,10,${0.05 + rnd() * 0.08})`; g.fillRect(0, y, 1024, 2); }
  g.strokeStyle = '#4a2512';
  g.lineWidth = 10;
  g.strokeRect(8, 8, 1008, 240);
  g.textAlign = 'center';
  g.fillStyle = '#f3e6c4';
  g.shadowColor = 'rgba(30,10,0,0.6)';
  g.shadowOffsetY = 3;
  g.font = '700 92px "Josefin Sans", sans-serif';
  g.fillText(title, 512, 128);
  g.font = '600 50px "Josefin Sans", sans-serif';
  g.fillText(subtitle, 512, 205);
  return tex(c, false);
}

export function clockTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#5b3a22';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#efe6cf';
  g.beginPath(); g.arc(128, 128, 110, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2c1d12'; g.lineWidth = 8; g.stroke();
  g.fillStyle = '#2c1d12';
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillRect(128 + Math.cos(a) * 88 - 4, 128 + Math.sin(a) * 88 - 4, 8, 8); }
  g.lineCap = 'round';
  g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 50, 128 - 30); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 - 10, 128 - 80); g.stroke();
  return tex(c, false);
}

/** Nube pintada (sprite). */
export function cloudTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 256);
  const puffs = 14;
  for (let i = 0; i < puffs; i++) {
    const x = 90 + rnd() * 330, y = 110 + rnd() * 70 - (Math.abs(x - 256) < 120 ? 40 : 0);
    const r = 45 + rnd() * 55;
    const grd = g.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
    grd.addColorStop(0, 'rgba(255,253,240,1)');
    grd.addColorStop(0.7, 'rgba(250,240,215,0.95)');
    grd.addColorStop(1, 'rgba(240,228,205,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // base sombreada
  const sh = g.createLinearGradient(0, 120, 0, 230);
  sh.addColorStop(0, 'rgba(180,170,160,0)');
  sh.addColorStop(1, 'rgba(170,165,170,0.55)');
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = sh;
  g.fillRect(0, 0, 512, 256);
  const t = tex(c, false);
  return t;
}

