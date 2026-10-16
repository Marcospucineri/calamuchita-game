import * as THREE from 'three';
import type { Game, GameDebug } from '../core/Game';
import { InputState, isTyping } from '../engine/Input';
import { CATEGORIES, Category, Note, NotesClient, catOf } from './Notes';
import { DEBUG_CSS } from './styles';

/**
 * Modo debug (se activa con ?debug en la URL):
 *  - Modo dios (G): cámara libre para recorrer todo el valle; el juego queda congelado.
 *  - Herramientas para marcar un punto (1) o un polígono (2), en la vista 3D o en el mapa (M),
 *    y dejar una observación ("acá va una plaza") que se guarda en el servidor.
 *  - Lista de notas (L) para revisarlas, ir hasta ellas y marcarlas como procesadas.
 */
export function installDebug(game: Game): Debug {
  return new Debug(game);
}

type Tool = 'none' | 'point' | 'polygon';
const fmt = (v: number, d = 0) => v.toFixed(d).replace('.', ',');

export class Debug implements GameDebug {
  god = false;
  private tool: Tool = 'none';
  private draft: number[][] = [];
  private notes: Note[] = [];
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.3;
  private speed = 40;
  private client = new NotesClient();
  private showNotes = true;
  private showDone = false;
  private root: HTMLElement;
  private dialog: HTMLElement;
  private list: HTMLElement;
  private group = new THREE.Group();
  private draftGroup = new THREE.Group();
  private labels: THREE.Sprite[] = [];
  private editing: Note | null = null;
  private status = 'Conectando…';

  constructor(private game: Game) {
    game.debug = this;
    document.body.classList.add('debug-on');
    const style = document.createElement('style');
    style.textContent = DEBUG_CSS;
    document.head.appendChild(style);

    this.root = this.el(`
      <div class="dbg" role="toolbar" aria-label="Herramientas de debug">
        <div class="dbg-row">
          <b class="dbg-tag">DEBUG</b>
          <button data-a="god" aria-pressed="false">Modo dios <kbd>G</kbd></button>
          <i class="dbg-sep"></i>
          <button data-t="point" aria-pressed="false">Punto <kbd>1</kbd></button>
          <button data-t="polygon" aria-pressed="false">Polígono <kbd>2</kbd></button>
          <button data-a="finish" class="hidden">Terminar <kbd>Enter</kbd></button>
          <i class="dbg-sep"></i>
          <button data-a="list">Notas <span class="dbg-count">0</span> <kbd>L</kbd></button>
          <button data-a="toggle" aria-pressed="true" title="Mostrar u ocultar las notas en el mundo">Ver <kbd>V</kbd></button>
          <button data-a="export">Exportar</button>
        </div>
        <div class="dbg-hint"></div>
        <div class="dbg-status"></div>
        <form class="dbg-token hidden"><input type="password" autocomplete="off" placeholder="Token de debug" aria-label="Token de debug"><button>Conectar</button></form>
      </div>`);
    this.dialog = this.el(`
      <div class="dbg-dialog hidden" role="dialog" aria-modal="true" aria-label="Nueva anotación">
        <form class="dbg-card">
          <h3>Nueva anotación</h3>
          <p class="dbg-where"></p>
          <div class="dbg-cats" role="radiogroup" aria-label="Categoría">
            ${CATEGORIES.map((c) => `<button type="button" role="radio" aria-checked="false" data-c="${c.id}" style="--c:${c.color}">${c.label}</button>`).join('')}
          </div>
          <textarea rows="4" maxlength="4000" placeholder="Ej.: acá va una plaza con juegos y bancos" aria-label="Observación"></textarea>
          <p class="dbg-err" role="alert"></p>
          <div class="dbg-actions">
            <button type="button" class="dbg-cancel">Cancelar <kbd>Esc</kbd></button>
            <button type="submit" class="dbg-save">Guardar <kbd>⌘/Ctrl+Enter</kbd></button>
          </div>
        </form>
      </div>`);
    this.list = this.el(`
      <aside class="dbg-list hidden" aria-label="Anotaciones">
        <header>
          <h3>Anotaciones</h3>
          <label><input type="checkbox" class="dbg-done"> Ver procesadas</label>
          <button class="dbg-close" aria-label="Cerrar lista">✕</button>
        </header>
        <ul></ul>
      </aside>`);
    const ui = document.getElementById('ui') ?? document.body;
    ui.append(this.root, this.dialog, this.list);
    this.wireUI();

    game.renderer.scene.add(this.group, this.draftGroup);
    this.wireInput();

    // el mapa también sirve para marcar
    const hud = game.hud;
    hud.mapPickHandler = (x, n) => {
      if (this.tool !== 'none') { this.addPoint(x, n, game.world.heightAt(x, n)); return true; }
      if (this.god) { this.flyTo(x, n); if (hud.isMapOpen) this.toggleMap(); return true; }
      return false;
    };
    hud.mapView.overlay = (g, S, mpp) => this.drawMap(g, S, mpp);

    setInterval(() => { this.cullLabels(); if (!this.god) this.updateStatus(); }, 400);
    this.connect();
    this.refreshUI();
  }

  // ---------------------------------------------------------------- interfaz

  private el(html: string): HTMLElement {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild as HTMLElement;
  }

  private wireUI(): void {
    const q = <T extends Element>(root: Element, s: string) => root.querySelector(s) as T;
    // los botones no se quedan con el foco (Espacio y Enter son del juego)
    this.root.addEventListener('click', (e) => { if (e.detail > 0 && e.target instanceof Element) e.target.closest('button')?.blur(); });
    q<HTMLButtonElement>(this.root, '[data-a="god"]').addEventListener('click', () => this.setGod(!this.god));
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-t]')) b.addEventListener('click', () => this.setTool(this.tool === b.dataset.t ? 'none' : (b.dataset.t as Tool)));
    q<HTMLButtonElement>(this.root, '[data-a="finish"]').addEventListener('click', () => this.finishPolygon());
    q<HTMLButtonElement>(this.root, '[data-a="list"]').addEventListener('click', () => this.toggleList());
    q<HTMLButtonElement>(this.root, '[data-a="toggle"]').addEventListener('click', () => this.toggleVisible());
    q<HTMLButtonElement>(this.root, '[data-a="export"]').addEventListener('click', () => this.export());
    const tokenForm = q<HTMLFormElement>(this.root, '.dbg-token');
    tokenForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.client.setToken(q<HTMLInputElement>(tokenForm, 'input').value);
      this.connect();
    });

    // diálogo
    const form = q<HTMLFormElement>(this.dialog, 'form');
    for (const b of this.dialog.querySelectorAll<HTMLButtonElement>('[data-c]')) {
      b.addEventListener('click', () => this.pickCategory(b.dataset.c as Category));
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); this.saveDialog(); });
    q<HTMLButtonElement>(this.dialog, '.dbg-cancel').addEventListener('click', () => this.closeDialog());
    q<HTMLTextAreaElement>(this.dialog, 'textarea').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.saveDialog(); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeDialog(); }
      e.stopPropagation();
    });

    // lista
    q<HTMLButtonElement>(this.list, '.dbg-close').addEventListener('click', () => this.toggleList(false));
    q<HTMLInputElement>(this.list, '.dbg-done').addEventListener('change', (e) => { this.showDone = (e.target as HTMLInputElement).checked; this.renderList(); this.rebuild3D(); this.game.hud.mapView.redraw(); });
  }

  private refreshUI(): void {
    const set = (sel: string, on: boolean) => this.root.querySelector(sel)!.setAttribute('aria-pressed', String(on));
    set('[data-a="god"]', this.god);
    set('[data-t="point"]', this.tool === 'point');
    set('[data-t="polygon"]', this.tool === 'polygon');
    set('[data-a="toggle"]', this.showNotes);
    this.root.querySelector('[data-a="finish"]')!.classList.toggle('hidden', !(this.tool === 'polygon' && this.draft.length >= 3));
    const open = this.notes.filter((n) => n.status !== 'procesada').length;
    this.root.querySelector('.dbg-count')!.textContent = String(open);
    const hint = this.tool === 'point'
      ? 'Punto: hacé clic en el mundo o en el mapa (M) · Esc cancela'
      : this.tool === 'polygon'
        ? `Polígono: clic para agregar vértices (${this.draft.length}) · Enter o clic en el primero termina · Borrar deshace · Esc cancela`
        : this.god
          ? 'WASD moverse · E/Espacio subir · Q bajar · Shift rápido · rueda velocidad · arrastrá para mirar · M mapa (tocá para ir)'
          : 'G para volar libre · 1 punto · 2 polígono · M mapa · L notas';
    this.root.querySelector('.dbg-hint')!.textContent = hint;
    document.body.classList.toggle('debug-picking', this.tool !== 'none');
  }

  private setStatus(s: string): void { this.status = s; }

  private updateStatus(): void {
    const c = this.game.renderer.camera.position;
    const x = c.x, n = -c.z;
    const [lat, lon] = this.game.world.toLatLon(x, n);
    const ground = this.game.world.heightAt(x, n);
    const parts = [
      `x ${fmt(x)} · n ${fmt(n)}`,
      `${fmt(lat, 5)}, ${fmt(lon, 5)}`,
      this.god ? `${fmt(c.y - ground)} m sobre el suelo · ${fmt(this.speed)} m/s` : '',
      `Notas: ${this.status}`,
    ].filter(Boolean);
    this.root.querySelector('.dbg-status')!.textContent = parts.join('  ·  ');
  }

  // ---------------------------------------------------------------- notas

  private async connect(): Promise<void> {
    this.setStatus('conectando…');
    const r = await this.client.connect();
    const token = this.root.querySelector('.dbg-token')!;
    token.classList.toggle('hidden', !(!r.ok && r.reason === 'token'));
    this.setStatus(r.ok ? `guardando en ${r.where}` : r.message);
    await this.reload();
  }

  private async reload(): Promise<void> {
    try { this.notes = await this.client.list(); } catch (e) { this.setStatus((e as Error).message); }
    this.rebuild3D();
    this.renderList();
    this.refreshUI();
    this.game.hud.mapView.redraw();
  }

  private toggleVisible(): void {
    this.showNotes = !this.showNotes;
    this.group.visible = this.showNotes;
    this.refreshUI();
    this.game.hud.mapView.redraw();
  }

  private export(): void {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), notes: this.notes }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'anotaciones-vallecito.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------------------------------------------------------- modo dios

  private setGod(on: boolean): void {
    if (on === this.god) return;
    this.god = on;
    const cam = this.game.renderer.camera;
    if (on) {
      const d = cam.getWorldDirection(new THREE.Vector3());
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      cam.up.set(0, 1, 0);
      cam.near = 0.5; cam.fov = 60; cam.updateProjectionMatrix();
    } else {
      this.game.cameraRig.snap();
    }
    this.refreshUI();
  }

  update(dt: number, s: InputState): void {
    const cam = this.game.renderer.camera;
    const w = this.game.world;
    if (!this.dialogOpen) {
      this.yaw -= s.lookX * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch - s.lookY * 0.0035, -1.52, 1.52);
      if (s.zoom) this.speed = THREE.MathUtils.clamp(this.speed * Math.pow(1.18, -s.zoom), 4, 600);
      const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
      const v = this.speed * fast * dt;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      cam.position.x += (fx * s.moveY + Math.cos(this.yaw) * s.moveX) * v;
      cam.position.z += (fz * s.moveY - Math.sin(this.yaw) * s.moveX) * v;
      const up = (this.keys.has('KeyE') || this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0);
      cam.position.y += up * v;
    }
    const pa = w.meta.playArea, m = 1500;
    cam.position.x = THREE.MathUtils.clamp(cam.position.x, pa.x0 - m, pa.x1 + m);
    cam.position.z = THREE.MathUtils.clamp(cam.position.z, -(pa.n1 + m), -(pa.n0 - m));
    cam.position.y = THREE.MathUtils.clamp(cam.position.y, w.heightAt(cam.position.x, -cam.position.z) + 1.5, 5000);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.updateStatus();
  }

  /** Lleva la cámara (modo dios) a mirar un punto desde el sur. */
  private flyTo(x: number, n: number, cam?: Note['camera']): void {
    this.setGod(true);
    const c = this.game.renderer.camera;
    if (cam) {
      c.position.set(cam.x, cam.y, cam.z);
      this.yaw = cam.yaw; this.pitch = cam.pitch;
    } else {
      const g = this.game.world.heightAt(x, n - 70);
      c.position.set(x, g + 55, -(n - 70));
      this.yaw = 0; this.pitch = -0.62;
    }
    c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  // ---------------------------------------------------------------- entrada

  private wireInput(): void {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      if (this.dialogOpen) return;
      switch (e.code) {
        case 'KeyG': this.setGod(!this.god); break;
        case 'Digit1': this.setTool(this.tool === 'point' ? 'none' : 'point'); break;
        case 'Digit2': this.setTool(this.tool === 'polygon' ? 'none' : 'polygon'); break;
        case 'KeyL': this.toggleList(); break;
        case 'KeyV': this.toggleVisible(); break;
        case 'Enter': if (this.tool === 'polygon') { e.preventDefault(); this.finishPolygon(); } break;
        case 'Backspace': if (this.draft.length) { e.preventDefault(); this.draft.pop(); this.drawDraft(); } break;
        case 'Escape': if (this.tool !== 'none') { this.setTool('none'); } break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // clic (sin arrastrar) sobre el mundo 3D con una herramienta activa
    const canvas = this.game.renderer.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || this.tool === 'none' || this.dialogOpen || this.game.hud.isMapOpen) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 700) return;
      const hit = this.pickTerrain(e.clientX, e.clientY);
      if (hit) this.addPoint(hit.x, -hit.z, hit.y);
    });
  }

  /** Rayo desde la cámara hasta el relieve. */
  private pickTerrain(cx: number, cy: number): THREE.Vector3 | null {
    const cam = this.game.renderer.camera;
    const r = this.game.renderer.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), cam);
    const o = ray.ray.origin, d = ray.ray.direction, w = this.game.world;
    const below = (t: number) => { const p = o.clone().addScaledVector(d, t); return p.y < w.heightAt(p.x, -p.z); };
    let a = 0, t = 0.5;
    while (t < 12000) {
      if (below(t)) {
        let b = t;
        for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (below(m)) b = m; else a = m; }
        const p = o.clone().addScaledVector(d, b);
        p.y = w.heightAt(p.x, -p.z);
        return p;
      }
      a = t;
      t += Math.max(0.5, t * 0.02);
    }
    return null;
  }

  // ---------------------------------------------------------------- herramientas

  private setTool(t: Tool): void {
    this.tool = t;
    this.draft = [];
    this.drawDraft();
    this.refreshUI();
  }

  private addPoint(x: number, n: number, y: number): void {
    if (this.tool === 'point') {
      this.draft = [[x, n, y]];
      this.drawDraft();
      this.openDialog();
      return;
    }
    if (this.tool !== 'polygon') return;
    // clic cerca del primer vértice: cerrar
    if (this.draft.length >= 3) {
      const [fx, fn] = this.draft[0];
      const cam = this.game.renderer.camera.position;
      const near = Math.max(4, Math.hypot(cam.x - fx, -cam.z - fn) * 0.03);
      if (Math.hypot(x - fx, n - fn) < near) { this.finishPolygon(); return; }
    }
    this.draft.push([x, n, y]);
    this.drawDraft();
  }

  private finishPolygon(): void {
    if (this.tool !== 'polygon' || this.draft.length < 3) return;
    this.openDialog();
  }

  // ---------------------------------------------------------------- diálogo

  private get dialogOpen(): boolean { return !this.dialog.classList.contains('hidden'); }
  private category: Category = 'otro';

  private pickCategory(c: Category): void {
    this.category = c;
    for (const b of this.dialog.querySelectorAll<HTMLButtonElement>('[data-c]')) b.setAttribute('aria-checked', String(b.dataset.c === c));
  }

  private openDialog(note?: Note): void {
    this.editing = note ?? null;
    const pts = note ? note.points : this.draft;
    const [cx, cn] = centroid(pts);
    const town = this.game.world.townAt(cx, cn)?.town.name ?? 'fuera de los pueblos';
    const what = (note?.kind ?? (this.tool === 'polygon' ? 'polygon' : 'point')) === 'polygon' ? `Polígono de ${pts.length} vértices` : 'Punto';
    this.dialog.querySelector('h3')!.textContent = note ? 'Editar anotación' : 'Nueva anotación';
    this.dialog.querySelector('.dbg-where')!.textContent = `${what} · ${town} · x ${fmt(cx)}, n ${fmt(cn)}`;
    this.dialog.querySelector('.dbg-err')!.textContent = '';
    this.pickCategory(note?.category ?? this.category);
    const ta = this.dialog.querySelector('textarea')!;
    ta.value = note?.text ?? '';
    this.dialog.classList.remove('hidden');
    this.keys.clear();
    setTimeout(() => ta.focus(), 30);
  }

  private closeDialog(): void {
    this.dialog.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!this.editing) {
      // el punto suelto se descarta; el polígono queda para seguir editándolo
      if (this.tool === 'point') { this.draft = []; this.drawDraft(); }
    }
    this.editing = null;
    this.refreshUI();
  }

  private async saveDialog(): Promise<void> {
    const ta = this.dialog.querySelector('textarea')!;
    const err = this.dialog.querySelector('.dbg-err')!;
    const text = ta.value.trim();
    if (!text) { err.textContent = 'Escribí la observación.'; ta.focus(); return; }
    const save = this.dialog.querySelector<HTMLButtonElement>('.dbg-save')!;
    save.disabled = true;
    try {
      if (this.editing) {
        await this.client.update(this.editing.id, { text, category: this.category });
      } else {
        const w = this.game.world;
        const pts = this.draft.map(([x, n, y]) => [x, n, y]);
        const [cx, cn] = centroid(pts);
        const cam = this.game.renderer.camera;
        const d = cam.getWorldDirection(new THREE.Vector3());
        await this.client.create({
          kind: this.tool === 'polygon' ? 'polygon' : 'point',
          points: pts,
          lonlat: pts.map(([x, n]) => { const [lat, lon] = w.toLatLon(x, n); return [lon, lat]; }),
          category: this.category,
          text,
          town: w.townAt(cx, cn)?.town.name ?? null,
          camera: { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) },
        });
        this.draft = [];
        this.drawDraft();
      }
      this.dialog.classList.add('hidden');
      this.editing = null;
      this.game.hud.toast(this.client.mode === 'server' ? 'Anotación guardada' : 'Anotación guardada en este navegador', this.client.where);
      await this.reload();
    } catch (e) {
      err.textContent = (e as Error).message;
    } finally {
      save.disabled = false;
    }
  }

  // ---------------------------------------------------------------- lista

  private toggleList(force?: boolean): void {
    const open = force ?? this.list.classList.contains('hidden');
    this.list.classList.toggle('hidden', !open);
    if (open) this.renderList();
  }

  private renderList(): void {
    const ul = this.list.querySelector('ul')!;
    const items = this.notes.filter((n) => this.showDone || n.status !== 'procesada');
    ul.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'dbg-empty';
      li.textContent = this.notes.length ? 'No hay notas abiertas.' : 'Todavía no hay notas. Elegí Punto (1) o Polígono (2) y marcá el mundo o el mapa.';
      ul.appendChild(li);
      return;
    }
    for (const n of items) {
      const c = catOf(n.category);
      const li = document.createElement('li');
      li.className = n.status === 'procesada' ? 'done' : '';
      const date = new Date(n.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
      li.innerHTML = `
        <div class="dbg-li-head"><span class="dbg-chip" style="--c:${c.color}">${c.label}</span><small></small></div>
        <p></p>
        <p class="dbg-res hidden"></p>
        <div class="dbg-li-actions">
          <button data-x="go">Ir</button><button data-x="map">En el mapa</button><button data-x="edit">Editar</button>
          <button data-x="status">${n.status === 'procesada' ? 'Reabrir' : 'Procesada'}</button><button data-x="del" class="danger">Borrar</button>
        </div>`;
      li.querySelector('small')!.textContent = `${n.kind === 'polygon' ? 'Polígono' : 'Punto'} · ${n.town ?? 'fuera de los pueblos'} · ${date}`;
      li.querySelector('p')!.textContent = n.text;
      if (n.status === 'procesada') {
        const res = li.querySelector('.dbg-res')!;
        res.classList.remove('hidden');
        res.textContent = `✔ ${n.resolution || 'Procesada'}${n.processedAt ? ` · ${new Date(n.processedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}` : ''}`;
      }
      const [cx, cn] = centroid(n.points);
      li.querySelector('[data-x="go"]')!.addEventListener('click', () => { if (this.game.hud.isMapOpen) this.toggleMap(); this.flyTo(cx, cn, n.camera); });
      li.querySelector('[data-x="map"]')!.addEventListener('click', () => { if (!this.game.hud.isMapOpen) this.toggleMap(); this.game.hud.mapView.centerOn(cx, cn); });
      li.querySelector('[data-x="edit"]')!.addEventListener('click', () => this.openDialog(n));
      li.querySelector('[data-x="status"]')!.addEventListener('click', async () => {
        try { await this.client.update(n.id, { status: n.status === 'procesada' ? 'abierta' : 'procesada' }); await this.reload(); } catch (e) { this.game.hud.toast('No se pudo actualizar', (e as Error).message); }
      });
      const del = li.querySelector<HTMLButtonElement>('[data-x="del"]')!;
      del.addEventListener('click', async () => {
        if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = '¿Seguro?'; setTimeout(() => { del.dataset.sure = ''; del.textContent = 'Borrar'; }, 3000); return; }
        try { await this.client.remove(n.id); await this.reload(); } catch (e) { this.game.hud.toast('No se pudo borrar', (e as Error).message); }
      });
      ul.appendChild(li);
    }
  }

  private toggleMap(): void {
    const c = this.game.renderer.camera.position;
    const p = this.god ? { x: c.x, n: -c.z } : { x: this.game.player.position.x, n: -this.game.player.position.z };
    this.game.hud.toggleMap(p.x, p.n, this.game.pois.discovered);
  }

  // ---------------------------------------------------------------- dibujo 3D

  private rebuild3D(): void {
    disposeChildren(this.group);
    this.labels = [];
    for (const n of this.notes) {
      const done = n.status === 'procesada';
      if (done && !this.showDone) continue;
      const color = done ? '#8d8d8d' : catOf(n.category).color;
      this.group.add(this.shape(n.points, n.kind === 'polygon', color, done ? 0.12 : 0.28));
      const [cx, cn] = centroid(n.points);
      const label = makeLabel(`${catOf(n.category).label}: ${n.text}`, color, done);
      const y = this.game.world.heightAt(cx, cn);
      label.position.set(cx, y + 17, -cn);
      label.userData.note = n.id;
      this.group.add(label);
      this.labels.push(label);
    }
    this.cullLabels();
  }

  private drawDraft(): void {
    disposeChildren(this.draftGroup);
    if (this.draft.length) this.draftGroup.add(this.shape(this.draft, this.tool === 'polygon' && this.draft.length >= 3, '#fff2a8', 0.4, true));
    this.refreshUI();
    this.game.hud.mapView.redraw();
  }

  /** Poste por vértice y, si es polígono, una cortina translúcida sobre el borde (siguiendo el relieve). */
  private shape(points: number[][], closed: boolean, color: string, opacity: number, draft = false): THREE.Group {
    const g = new THREE.Group();
    const w = this.game.world;
    const col = new THREE.Color(color);
    const poleMat = new THREE.MeshBasicMaterial({ color: col });
    const poleGeo = new THREE.CylinderGeometry(0.3, 0.3, draft ? 8 : 14, 6);
    poleGeo.translate(0, draft ? 4 : 7, 0);
    const pts = points.map(([x, n]) => ({ x, n, y: w.heightAt(x, n) }));
    const poles = closed || points.length === 1 ? (points.length === 1 ? pts : pts) : pts;
    for (const p of poles) { const m = new THREE.Mesh(poleGeo, poleMat); m.position.set(p.x, p.y, -p.n); g.add(m); }
    if (points.length >= 2) {
      const ring = closed ? [...pts, pts[0]] : pts;
      const pos: number[] = [], line: number[] = [];
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.n - a.n) / 3));
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const x0 = a.x + (b.x - a.x) * t0, n0 = a.n + (b.n - a.n) * t0, x1 = a.x + (b.x - a.x) * t1, n1 = a.n + (b.n - a.n) * t1;
          const y0 = w.heightAt(x0, n0) + 0.3, y1 = w.heightAt(x1, n1) + 0.3, h = 2.6;
          pos.push(x0, y0, -n0, x1, y1, -n1, x1, y1 + h, -n1, x0, y0, -n0, x1, y1 + h, -n1, x0, y0 + h, -n0);
          line.push(x0, y0 + h, -n0, x1, y1 + h, -n1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })));
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
      g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: col })));
    }
    return g;
  }

  /** Etiquetas solo cerca de la cámara (y siempre del tamaño de pantalla). */
  private cullLabels(): void {
    const c = this.game.renderer.camera.position;
    for (const l of this.labels) l.visible = l.position.distanceTo(c) < 2600;
  }

  // ---------------------------------------------------------------- dibujo en el mapa

  private drawMap(g: CanvasRenderingContext2D, S: (x: number, n: number) => [number, number], mpp: number): void {
    const poly = (pts: number[][], color: string, fillA: number, closed: boolean, dashed = false) => {
      g.beginPath();
      pts.forEach(([x, n], i) => { const [sx, sy] = S(x, n); if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
      if (closed) g.closePath();
      if (closed && fillA > 0) { g.globalAlpha = fillA; g.fillStyle = color; g.fill(); g.globalAlpha = 1; }
      g.setLineDash(dashed ? [6, 4] : []);
      g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
      g.setLineDash([]);
    };
    const dot = (x: number, n: number, color: string, r = 6) => {
      const [sx, sy] = S(x, n);
      g.save(); g.translate(sx, sy); g.rotate(Math.PI / 4);
      g.fillStyle = color; g.strokeStyle = '#fff6e0'; g.lineWidth = 2;
      g.fillRect(-r, -r, 2 * r, 2 * r); g.strokeRect(-r, -r, 2 * r, 2 * r);
      g.restore();
    };
    if (this.showNotes) {
      for (const n of this.notes) {
        if (n.status === 'procesada' && !this.showDone) continue;
        const color = n.status === 'procesada' ? '#8d8d8d' : catOf(n.category).color;
        if (n.kind === 'polygon') poly(n.points, color, 0.22, true);
        else dot(n.points[0][0], n.points[0][1], color);
        if (mpp < 6) {
          const [cx, cn] = centroid(n.points);
          const [sx, sy] = S(cx, cn);
          const t = n.text.length > 34 ? n.text.slice(0, 33) + '…' : n.text;
          g.font = '700 11px "Josefin Sans", sans-serif'; g.textAlign = 'center';
          g.lineWidth = 3; g.strokeStyle = 'rgba(255,248,230,0.95)'; g.strokeText(t, sx, sy - 10);
          g.fillStyle = '#2d2016'; g.fillText(t, sx, sy - 10);
        }
      }
    }
    if (this.draft.length) {
      poly(this.draft, '#c8452c', 0.15, this.tool === 'polygon' && this.draft.length >= 3, true);
      for (const [x, n] of this.draft) dot(x, n, '#c8452c', 4);
    }
  }
}

// ---------------------------------------------------------------- utilidades

function centroid(points: number[][]): [number, number] {
  let x = 0, n = 0;
  for (const p of points) { x += p[0]; n += p[1]; }
  return [x / points.length, n / points.length];
}

function disposeChildren(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (x as THREE.SpriteMaterial).map?.dispose?.();
      x.dispose();
    }
  });
  g.clear();
}

function makeLabel(text: string, color: string, done: boolean): THREE.Sprite {
  const t = text.length > 46 ? text.slice(0, 45) + '…' : text;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = '700 28px "Josefin Sans", sans-serif';
  const w = Math.ceil(g.measureText(t).width) + 40;
  c.width = w; c.height = 52;
  g.font = '700 28px "Josefin Sans", sans-serif';
  g.fillStyle = done ? 'rgba(80,80,80,0.75)' : 'rgba(255,248,230,0.95)';
  g.beginPath(); g.roundRect(2, 2, w - 4, 48, 14); g.fill();
  g.fillStyle = color; g.fillRect(12, 14, 8, 24);
  g.fillStyle = done ? '#eee' : '#2d2016';
  g.textBaseline = 'middle';
  g.fillText(t, 28, 27);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false, transparent: true });
  const s = new THREE.Sprite(m);
  const h = 0.042;
  s.scale.set((h * w) / 52, h, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 999;
  return s;
}
