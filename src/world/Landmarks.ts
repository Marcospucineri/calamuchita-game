import * as THREE from 'three';
import { paintedMaterial } from '../render/PaintedMaterial';
import { roofTexture, stoneTexture } from '../render/Textures';
import type { BoxCollider } from './Buildings';
import { Landmark, WorldData } from './WorldData';

/**
 * Hitos reales modelados a partir de Street View:
 * - Arco de VGB (Ruta 5 y Av. Ojo de Agua): torre de ladrillo + hastial "En octubre Fiesta Nacional de la Cerveza"
 *   unidos por un techo de tejas en rombos que cruza la calle.
 * - Arco de Villa Ciudad Parque (Ruta 5 y Bv. Los Reartes): arco blanco colonial con guarda de piedra y farol.
 * - Botella gigante (Las Magnolias y Ruta 5).
 * - Barril cervecero bajo la glorieta y tótem tallado (Av. San Martín, plaza José Hernández).
 * - Plazas circulares de Villa Ciudad Parque (Plaza Joven y Paseo del Bosque).
 */

let seed = 77;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}
function tex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function brickTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#d8c7a8';
  g.fillRect(0, 0, 256, 256);
  const bh = 16, bw = 42;
  for (let y = 0; y < 256; y += bh)
    for (let x = (y / bh) % 2 ? -bw / 2 : 0; x < 256; x += bw) {
      const v = rnd();
      g.fillStyle = v < 0.33 ? '#9a4f33' : v < 0.66 ? '#a85c3c' : '#8c4a32';
      g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  return tex(c, true);
}

/** Tejas en rombos rojizos y marrones, como el techo que cruza Ojo de Agua. */
function diamondTileTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#7d3a24';
  g.fillRect(0, 0, 256, 256);
  const s = 32;
  for (let y = 0; y < 256; y += s / 2)
    for (let x = (y / (s / 2)) % 2 ? s / 2 : 0; x < 256 + s; x += s) {
      g.fillStyle = ((x / s + y / s) | 0) % 3 === 0 ? '#c56a45' : ((x + y) / s) % 2 ? '#a24a2c' : '#6e3020';
      g.beginPath();
      g.moveTo(x, y - s / 2);
      g.lineTo(x + s / 2, y);
      g.lineTo(x, y + s / 2);
      g.lineTo(x - s / 2, y);
      g.closePath();
      g.fill();
    }
  return tex(c, true);
}

function halfTimberTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#efe4cc';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#4a2e1c';
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(128, 0); g.lineTo(128, 256);
  g.moveTo(0, 256); g.lineTo(128, 60); g.lineTo(256, 256);
  g.moveTo(0, 170); g.lineTo(256, 170);
  g.stroke();
  return tex(c);
}

/** Texto pintado sobre ladrillo/revoque. */
function textPlate(lines: string[], bg: string, fg: string, w = 512, h = 256, font = 'Bitter, Georgia, serif'): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = h / (lines.length + 0.6);
  lines.forEach((l, i) => {
    g.font = `800 ${Math.round(lh * 0.62)}px ${font}`;
    g.fillText(l, w / 2, lh * (i + 0.8));
  });
  return tex(c);
}

/** Letras "VILLA CIUDAD PARQUE" siguiendo el arco (fondo transparente). */
function arcLettersTexture(text: string, pxPerM: number, cx: number, cy: number, radius: number): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#4a4f55';
  g.font = `800 ${Math.round(0.62 * pxPerM)}px Bitter, Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...text];
  const span = Math.PI * 0.74;
  chars.forEach((ch, i) => {
    const a = Math.PI / 2 + span / 2 - (span * (i + 0.5)) / chars.length;
    g.save();
    g.translate(cx + Math.cos(a) * radius, cy - Math.sin(a) * radius);
    g.rotate(Math.PI / 2 - a);
    g.fillText(ch, 0, 0);
    g.restore();
  });
  return tex(c);
}

function labelTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#f2e7cf';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#b3261e';
  g.fillRect(0, 0, 512, 10);
  g.fillRect(0, 118, 512, 10);
  g.font = '800 54px Bitter, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const x of [128, 384]) g.fillText('BIER', x, 66);
  return tex(c, true);
}

function signBoard(text: string): THREE.CanvasTexture {
  const [c, g] = canvas(512, 160);
  g.fillStyle = '#7a4a2a';
  g.fillRect(0, 0, 512, 160);
  for (let y = 0; y < 160; y += 7) { g.fillStyle = `rgba(30,15,5,${0.06 + rnd() * 0.08})`; g.fillRect(0, y, 512, 2); }
  g.strokeStyle = '#4a2a15';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 504, 152);
  g.fillStyle = '#f3e6c4';
  g.font = '700 58px Bitter, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 84);
  return tex(c);
}

/** Ubica una malla en (x, y, z) locales y la devuelve. */
function at(m: THREE.Mesh, x: number, y: number, z: number): THREE.Mesh {
  m.position.set(x, y, z);
  return m;
}

export class Landmarks {
  readonly group = new THREE.Group();
  readonly colliders: BoxCollider[] = [];
  private brick = paintedMaterial({ map: brickTexture(), brushScale: 0.6, brushAmount: 0.12 });
  private stone = paintedMaterial({ map: stoneTexture(), brushScale: 0.6 });
  private white = paintedMaterial({ color: 0xf4efe4, brushScale: 0.5, brushAmount: 0.1 });
  private whiteDS = paintedMaterial({ color: 0xf4efe4, brushScale: 0.5, brushAmount: 0.1, side: THREE.DoubleSide });
  private wood = paintedMaterial({ color: 0x6e4428, brushScale: 0.9 });
  private dark = paintedMaterial({ color: 0x2c2a28, brushScale: 1 });
  private tile = paintedMaterial({ map: roofTexture('teja'), brushScale: 0.5, side: THREE.DoubleSide });

  constructor(private w: WorldData, scene: THREE.Scene) {
    for (const l of w.meta.landmarks ?? []) {
      const g = new THREE.Group();
      g.position.set(l.x, w.heightAt(l.x, l.n), -l.n);
      g.rotation.y = l.heading ?? 0;
      switch (l.type) {
        case 'arcoVGB': this.arcoVGB(g, l); break;
        case 'arcoVCP': this.arcoVCP(g, l); break;
        case 'botella': this.botella(g, l); break;
        case 'barril': this.barril(g, l); break;
        case 'totem': this.totem(g, l); break;
        case 'plaza': this.plaza(l); continue;
      }
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(g);
    }
    scene.add(this.group);
  }

  /** Caja en coordenadas locales del hito (X a lo largo de la calle, Z lateral). */
  private box(g: THREE.Group, l: Landmark, sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material | THREE.Material[], collide = true): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    if (collide) this.collider(l, x, y, z, sx / 2, sy / 2, sz / 2);
    return mesh;
  }

  private collider(l: Landmark, x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    const h = l.heading ?? 0, c = Math.cos(h), s = Math.sin(h);
    const X = l.x + x * c + z * s;
    const Z = -l.n - x * s + z * c;
    this.colliders.push({ x: X, y: this.w.heightAt(l.x, l.n) + y, z: Z, hx, hy, hz, rotY: h });
  }

  private arcoVGB(g: THREE.Group, l: Landmark): void {
    const half = (l.width ?? 7.5) / 2 + 1.6;
    // torre de ladrillo (lado derecho al entrar al pueblo)
    const tz = half + 1.9;
    const shaft = new THREE.CylinderGeometry(1.95, 2.35, 11, 4, 1);
    shaft.rotateY(Math.PI / 4);
    const tower = new THREE.Mesh(shaft, this.brick);
    tower.position.set(0, 5.2, tz);
    g.add(tower);
    this.collider(l, 0, 5.2, tz, 1.7, 5.5, 1.7);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 3.2), this.brick);
    cornice.position.set(0, 10.8, tz);
    g.add(cornice);
    const roofG = new THREE.ConeGeometry(2.55, 2.8, 4);
    roofG.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofG, this.tile);
    roof.position.set(0, 12.3, tz);
    g.add(roof);
    // ventanitas con arco, puerta y cartel con el nombre del pueblo
    const winMat = paintedMaterial({ color: 0x2a211c, brushScale: 1 });
    const hwAt = (y: number) => 1.66 - ((y + 0.3) / 11) * 0.28 + 0.03; // semiancho de la torre a esa altura
    for (const [y, sx] of [[9.3, 0.5], [6.4, 0.6]] as [number, number][]) {
      for (const face of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(sx, sx * 1.6), winMat);
        win.position.set(face * hwAt(y), y, tz);
        win.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
        g.add(win);
      }
    }
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), paintedMaterial({ color: 0x5b3a26 }));
    door.position.set(0, 1.05, tz - hwAt(1.05));
    door.rotation.y = Math.PI;
    g.add(door);
    const plate = textPlate(['VILLA', 'GENERAL', 'BELGRANO'], '#efe4cc', '#5a2c18', 256, 256);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), paintedMaterial({ map: plate, brushAmount: 0.05 }));
    sign.position.set(-hwAt(7.8), 7.8, tz);
    sign.rotation.y = -Math.PI / 2;
    g.add(sign);

    // hastial de ladrillo con la leyenda (lado izquierdo)
    const gz = -half - 2.1;
    this.box(g, l, 3.4, 3.2, 4.2, 0, 1.4, gz, this.brick);
    const gable = new THREE.Shape([new THREE.Vector2(-2.4, 0), new THREE.Vector2(2.4, 0), new THREE.Vector2(0, 3.4)]);
    const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: 3.6, bevelEnabled: false });
    gableGeo.translate(0, 0, -1.8);
    gableGeo.rotateY(Math.PI / 2);
    const gm = new THREE.Mesh(gableGeo, [paintedMaterial({ map: halfTimberTexture(), brushAmount: 0.08 }), this.tile]);
    gm.position.set(0, 3.0, gz);
    g.add(gm);
    const legend = textPlate(['EN OCTUBRE', 'FIESTA NACIONAL', 'DE LA CERVEZA'], '#9a4f33', '#f4ead2', 512, 256);
    for (const face of [-1, 1]) {
      const lg = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), paintedMaterial({ map: legend, brushAmount: 0.06 }));
      lg.position.set(face * 1.72, 1.6, gz);
      lg.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(lg);
    }

    // techo de tejas en rombos que cruza la calle, sobre una cercha
    const z0 = gz + 1.6, z1 = tz - 1.35;
    const span = z1 - z0, zc = (z0 + z1) / 2;
    const ridge = new THREE.Shape([new THREE.Vector2(-1.9, 0), new THREE.Vector2(1.9, 0), new THREE.Vector2(0, 1.5)]);
    const ridgeGeo = new THREE.ExtrudeGeometry(ridge, { depth: span, bevelEnabled: false });
    ridgeGeo.translate(0, 0, -span / 2);
    const dt = diamondTileTexture();
    dt.repeat.set(0.35, 0.35);
    const rm = new THREE.Mesh(ridgeGeo, [paintedMaterial({ map: dt, brushAmount: 0.1, side: THREE.DoubleSide }), paintedMaterial({ map: dt, brushAmount: 0.1, side: THREE.DoubleSide })]);
    rm.position.set(0, 6.0, zc);
    g.add(rm);
    const beam = paintedMaterial({ color: 0x5c4634, brushScale: 1 });
    for (const x of [-1.4, 1.4]) {
      this.box(g, l, 0.22, 0.25, span, x, 5.2, zc, beam, false);
      this.box(g, l, 0.18, 0.18, span, x, 5.95, zc, beam, false);
      for (let k = 0; k < 8; k++) {
        const zA = z0 + (span * k) / 8, zB = z0 + (span * (k + 1)) / 8;
        const diag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, Math.hypot(zB - zA, 0.75)), beam);
        diag.position.set(x, 5.57, (zA + zB) / 2);
        diag.rotation.x = (k % 2 ? 1 : -1) * Math.atan2(0.75, zB - zA);
        g.add(diag);
      }
    }
  }

  private arcoVCP(g: THREE.Group, l: Landmark): void {
    const open = (l.width ?? 7) / 2 + 0.7; // semiancho de la abertura
    const outer = open + 1.4;
    const spring = 3.0;
    const s = new THREE.Shape();
    s.moveTo(-outer, 0);
    s.lineTo(-outer, spring + open * 0.72);
    s.quadraticCurveTo(-outer + 0.9, spring + open + 0.65, -2.4, spring + open + 1.05);
    s.lineTo(-1.9, spring + open + 1.05);
    s.quadraticCurveTo(-1.9, spring + open + 2.1, -1.2, spring + open + 2.2);
    s.quadraticCurveTo(-0.6, spring + open + 3.0, 0, spring + open + 3.0);
    s.quadraticCurveTo(0.6, spring + open + 3.0, 1.2, spring + open + 2.2);
    s.quadraticCurveTo(1.9, spring + open + 2.1, 1.9, spring + open + 1.05);
    s.lineTo(2.4, spring + open + 1.05);
    s.quadraticCurveTo(outer - 0.9, spring + open + 0.65, outer, spring + open * 0.72);
    s.lineTo(outer, 0);
    s.lineTo(open, 0);
    s.lineTo(open, spring);
    s.absarc(0, spring, open, 0, Math.PI, false);
    s.lineTo(-open, 0);
    s.closePath();
    const depth = 1.1;
    const archGeo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 24 });
    archGeo.translate(0, 0, -depth / 2);
    archGeo.rotateY(Math.PI / 2);
    g.add(new THREE.Mesh(archGeo, this.white));
    // guarda de piedra alrededor de la abertura
    const band = new THREE.Shape();
    band.moveTo(open + 0.55, 0);
    band.lineTo(open + 0.55, spring);
    band.absarc(0, spring, open + 0.55, 0, Math.PI, false);
    band.lineTo(-open - 0.55, 0);
    band.lineTo(-open, 0);
    band.lineTo(-open, spring);
    band.absarc(0, spring, open, Math.PI, 0, true);
    band.lineTo(open, 0);
    band.closePath();
    const bandGeo = new THREE.ExtrudeGeometry(band, { depth: depth + 0.12, bevelEnabled: false, curveSegments: 24 });
    bandGeo.translate(0, 0, -(depth + 0.12) / 2);
    bandGeo.rotateY(Math.PI / 2);
    g.add(new THREE.Mesh(bandGeo, this.stone));
    for (const sz of [-1, 1]) this.collider(l, 0, 3.5, sz * (open + 0.7), 0.6, 3.5, 0.7);
    // letras en arco
    const pxm = 1024 / (2 * outer);
    const letters = arcLettersTexture('VILLA CIUDAD PARQUE', pxm, 512, (spring + open + 3.2 - spring) * pxm, (open + 1.15) * pxm);
    const lettersMat = paintedMaterial({ map: letters, transparent: true, alphaTest: 0.4, brushAmount: 0.02 });
    for (const face of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(2 * outer, (512 / pxm)), lettersMat);
      pl.position.set(face * (depth / 2 + 0.07), spring + open + 3.2 - 256 / pxm, 0);
      pl.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(pl);
    }
    // farol en el remate
    const lamp = new THREE.Group();
    lamp.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.45), paintedMaterial({ color: 0x333333 })));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.36), paintedMaterial({ color: 0xfff1c4, emissive: 0x6b5520 }));
    lamp.add(glass);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.35, 4), paintedMaterial({ color: 0x333333 }));
    cap.position.y = 0.45;
    cap.rotation.y = Math.PI / 4;
    lamp.add(cap);
    lamp.position.set(0, spring + open + 2.2, 0);
    g.add(lamp);
    // garitas laterales de piedra y revoque, con el muro en pendiente
    for (const sz of [-1, 1]) {
      const wing = new THREE.Shape([
        new THREE.Vector2(outer, 0), new THREE.Vector2(outer + 4.2, 0), new THREE.Vector2(outer + 4.2, 3.2),
        new THREE.Vector2(outer + 0.6, spring + open * 0.6), new THREE.Vector2(outer, spring + open * 0.72),
      ]);
      const wg = new THREE.ExtrudeGeometry(wing, { depth: 4.2, bevelEnabled: false });
      wg.translate(0, 0, -2.1);
      wg.rotateY(Math.PI / 2);
      if (sz > 0) wg.scale(1, 1, -1);
      g.add(new THREE.Mesh(wg, this.whiteDS));
      this.box(g, l, 4.3, 1.5, 4.3, 0, 0.6, sz * (outer + 2.1), this.stone);
      // ventana con rejas hacia afuera
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.3), paintedMaterial({ color: 0x2b3238 }));
      win.position.set(-2.17, 2.2, sz * (outer + 2.4));
      win.rotation.y = -Math.PI / 2;
      g.add(win);
      for (let b = -2; b <= 2; b++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.05), this.dark);
        bar.position.set(-2.2, 2.2, sz * (outer + 2.4) + b * 0.24);
        g.add(bar);
      }
      this.collider(l, 0, 2, sz * (outer + 2.1), 2.1, 2, 2.1);
    }
    // cartel de información turística
    const info = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), paintedMaterial({ map: signBoard('Información'), brushAmount: 0.05 }));
    info.position.set(-3.6, 1.6, outer + 1.4);
    info.rotation.y = -Math.PI / 2;
    g.add(info);
    for (const dz of [-0.6, 0.6]) this.box(g, l, 0.1, 1.9, 0.1, -3.62, 0.95, outer + 1.4 + dz, this.wood, false);
  }

  private botella(g: THREE.Group, l: Landmark): void {
    const pts = [[0, 0], [0.95, 0], [1.0, 0.18], [1.0, 3.6], [0.96, 4.05], [0.72, 4.75], [0.44, 5.35], [0.37, 6.15], [0.42, 6.32], [0.37, 6.5], [0, 6.5]].map(([r, y]) => new THREE.Vector2(r, y));
    const glass = paintedMaterial({ color: 0x6a2c12, brushScale: 1.2, brushAmount: 0.1, rim: 0.55 });
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), glass);
    body.position.y = 1.0;
    g.add(body);
    const label = labelTexture();
    const lab = new THREE.Mesh(new THREE.CylinderGeometry(1.015, 1.015, 1.5, 24, 1, true), paintedMaterial({ map: label, brushAmount: 0.05 }));
    lab.position.y = 1.0 + 2.2;
    g.add(lab);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 16), paintedMaterial({ color: 0xece2c6 }));
    cap.position.y = 1.0 + 6.55;
    g.add(cap);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 1.0, 20), this.brick);
    base.position.y = 0.4;
    g.add(base);
    this.collider(l, 0, 3.5, 0, 1.1, 3.6, 1.1);
    // la casita con la torre blanca de al lado
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 5.5, 14), this.white);
    tw.position.set(-6, 2.6, 14);
    g.add(tw);
    const twr = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2.2, 14), paintedMaterial({ color: 0x3b3a38 }));
    twr.position.set(-6, 6.4, 14);
    g.add(twr);
    this.collider(l, -6, 2.6, 14, 1.5, 2.8, 1.5);
  }

  private barril(g: THREE.Group, l: Landmark): void {
    // plazoleta de piedra
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.3, 28), this.stone);
    floor.position.y = 0.05;
    g.add(floor);
    // glorieta hexagonal con techo en punta
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.7, 0.2), this.wood);
      post.position.set(Math.cos(a) * 2.4, 1.5, Math.sin(a) * 2.4);
      g.add(post);
      if (k % 2 === 0) this.collider(l, Math.cos(a) * 2.4, 1.5, Math.sin(a) * 2.4, 0.12, 1.35, 0.12);
    }
    const eave = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.35, 6), this.wood);
    eave.position.y = 2.95;
    g.add(eave);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.25, 4.6, 6), paintedMaterial({ map: roofTexture('teja'), brushScale: 0.6 }));
    roof.position.y = 5.4;
    g.add(roof);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.9, 6), this.dark);
    spike.position.y = 8.1;
    g.add(spike);
    // el barril sobre su caballete
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.8, 20), paintedMaterial({ color: 0x5b3a22, brushScale: 1.5 }));
    barrel.rotation.z = Math.PI / 2;
    barrel.position.y = 1.35;
    g.add(barrel);
    for (const x of [-0.65, 0, 0.65]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.05, 6, 24), this.dark);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(x, 1.35, 0);
      g.add(hoop);
    }
    for (const x of [-0.6, 0.6]) this.box(g, l, 0.15, 0.6, 1.4, x, 0.45, 0, this.wood, false);
    this.collider(l, 0, 1.3, 0, 1.0, 0.9, 0.9);
  }

  private totem(g: THREE.Group, l: Landmark): void {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 3.6, 9), paintedMaterial({ color: 0x8a7b6a, brushScale: 2 }));
    trunk.position.y = 1.8;
    g.add(trunk);
    const carved = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.34, 1.2, 9), paintedMaterial({ color: 0x5f7fa0, brushScale: 2 }));
    carved.position.y = 2.6;
    g.add(carved);
    for (let k = 0; k < 4; k++) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 5), paintedMaterial({ color: k % 2 ? 0xd9784a : 0xe8a37a }));
      flame.position.set(Math.cos(k * 1.6) * 0.22, 4.0, Math.sin(k * 1.6) * 0.22);
      flame.rotation.z = Math.cos(k * 1.6) * -0.35;
      flame.rotation.x = Math.sin(k * 1.6) * 0.35;
      g.add(flame);
    }
    const rocks = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), this.stone);
    rocks.scale.set(1.2, 0.35, 1.2);
    g.add(rocks);
    this.collider(l, 0, 1.8, 0, 0.45, 1.8, 0.45);
  }

  /** Plaza circular: senderos radiales de tierra, bancos, faroles y (en Paseo del Bosque) canchas. */
  private plaza(l: Landmark): void {
    const R = l.r ?? 50;
    const pos: number[] = [], idx: number[] = [];
    const H = (x: number, n: number) => this.w.heightAt(x, n) + 0.07;
    const strip = (a0: number, r0: number, r1: number, wdt: number) => {
      const ca = Math.cos(a0), sa = Math.sin(a0);
      const ox = -sa * wdt / 2, on = ca * wdt / 2;
      const base = pos.length / 3;
      const steps = Math.ceil((r1 - r0) / 4);
      for (let k = 0; k <= steps; k++) {
        const d = r0 + ((r1 - r0) * k) / steps;
        const x = l.x + ca * d, n = l.n + sa * d;
        pos.push(x + ox, H(x + ox, n + on), -(n + on), x - ox, H(x - ox, n - on), -(n - on));
        if (k) { const a = base + (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    };
    for (let k = 0; k < 8; k++) strip((k / 8) * Math.PI * 2 + Math.PI / 8, 5.5, R + 1, 2.6);
    // claro central
    const cBase = pos.length / 3;
    pos.push(l.x, H(l.x, l.n), -l.n);
    for (let k = 0; k <= 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const x = l.x + Math.cos(a) * 7, n = l.n + Math.sin(a) * 7;
      pos.push(x, H(x, n), -n);
      if (k) idx.push(cBase, cBase + k + 1, cBase + k);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const paths = new THREE.Mesh(geo, paintedMaterial({ color: 0xc2a27a, brushScale: 0.4, brushAmount: 0.25, polygonOffset: 2, side: THREE.DoubleSide }));
    paths.receiveShadow = true;
    this.group.add(paths);

    const place = (obj: THREE.Object3D, x: number, n: number, rotY: number) => {
      obj.position.set(x, this.w.heightAt(x, n), -n);
      obj.rotation.y = rotY;
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(obj);
    };
    // bancos y faroles a lo largo de los senderos
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const d = 12 + (k % 3) * 6;
      const side = k % 2 ? 1.9 : -1.9;
      const bx = l.x + Math.cos(a) * d - Math.sin(a) * side, bn = l.n + Math.sin(a) * d + Math.cos(a) * side;
      const bench = new THREE.Group();
      bench.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.45), this.wood), 0, 0.45, 0));
      bench.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.06), this.wood), 0, 0.7, -0.2));
      for (const x of [-0.75, 0.75]) bench.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), this.dark), x, 0.22, 0));
      place(bench, bx, bn, -a + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
      if (k % 2 === 0) {
        const lamp = new THREE.Group();
        lamp.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6), this.dark), 0, 1.7, 0));
        lamp.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), paintedMaterial({ color: 0xfff3d0, emissive: 0x554422 })), 0, 3.5, 0));
        place(lamp, l.x + Math.cos(a) * (d + 8) + Math.sin(a) * 1.9, l.n + Math.sin(a) * (d + 8) - Math.cos(a) * 1.9, 0);
      }
    }
    // cartel con el nombre, mirando al boulevard (hacia el sur)
    const sign = new THREE.Group();
    sign.add(at(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), paintedMaterial({ map: signBoard(l.name), brushAmount: 0.05, side: THREE.DoubleSide })), 0, 1.5, 0));
    for (const x of [-1.1, 1.1]) sign.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.1), this.wood), x, 0.95, -0.05));
    place(sign, l.x + 3, l.n - R + 3, 0);
    // canchas con tejido verde (Paseo del Bosque)
    if (l.court) {
      const cx = l.x + R * 0.45, cn = l.n;
      const court = new THREE.Group();
      const floor = new THREE.Mesh(new THREE.BoxGeometry(17, 0.12, 28), paintedMaterial({ color: 0x9a8f7f, brushScale: 0.3 }));
      floor.position.y = 0.06;
      court.add(floor);
      const lines = new THREE.Mesh(new THREE.BoxGeometry(15, 0.02, 0.12), this.white);
      lines.position.y = 0.13;
      court.add(lines);
      const fence = paintedMaterial({ color: 0x2f6b45, transparent: true, opacity: 0.55, side: THREE.DoubleSide, brushAmount: 0.05 });
      for (const [w, d, x, z] of [[17.4, 0.05, 0, -14.2], [17.4, 0.05, 0, 14.2], [0.05, 28.4, -8.7, 0], [0.05, 28.4, 8.7, 0]] as number[][]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, d), fence);
        f.position.set(x, 1.6, z);
        f.castShadow = false;
        court.add(f);
      }
      place(court, cx, cn, 0);
    }
  }
}
