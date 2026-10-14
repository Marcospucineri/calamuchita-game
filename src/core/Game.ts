import * as THREE from 'three';
import { QUALITY, QualityLevel } from './Config';
import { bus } from './EventBus';
import { GameLoop } from './GameLoop';
import { Input, InputState } from '../engine/Input';
import { Physics, RAPIER } from '../engine/Physics';
import { Renderer } from '../engine/Renderer';
import { POIs } from '../gameplay/POI';
import { SaveData, SaveSystem } from '../gameplay/SaveSystem';
import { CameraRig } from '../player/CameraRig';
import { Character } from '../player/Character';
import { PlayerController, VehicleChoice } from '../player/PlayerController';
import { Aircraft } from '../player/Aircraft';
import { Vehicle } from '../player/Vehicle';
import { VehicleAudio } from '../player/VehicleAudio';
import { Music } from '../engine/Music';
import { ShopDecor, planShops } from '../world/Shops';
import { sharedUniforms } from '../render/PaintedMaterial';
import { HUD } from '../ui/HUD';
import { Buildings } from '../world/Buildings';
import { Landmarks } from '../world/Landmarks';
import { Roads } from '../world/Roads';
import { Sky } from '../world/Sky';
import { Terrain } from '../world/Terrain';
import { Vegetation } from '../world/Vegetation';
import { WorldData } from '../world/WorldData';
import { Airfield, getAirfield, prepareAirfield } from '../world/Airfield';

/** Modo debug (se carga aparte con ?debug): en modo dios mueve la cámara libre y congela el juego. */
export interface GameDebug {
  god: boolean;
  update(dt: number, state: InputState): void;
}

export class Game {
  readonly renderer: Renderer;
  readonly physics: Physics;
  readonly input: Input;
  readonly terrain: Terrain;
  readonly vegetation: Vegetation;
  readonly player: PlayerController;
  readonly cameraRig: CameraRig;
  readonly hud: HUD;
  readonly pois: POIs;
  readonly audio = new VehicleAudio();
  readonly music = new Music();
  private shops: ShopDecor;
  private sky: Sky;
  private loop: GameLoop;
  private state: InputState;
  private time = 0;
  private saveTimer = 0;
  private miniZoom = 1;
  debug: GameDebug | null = null;

  constructor(readonly world: WorldData, canvas: HTMLCanvasElement, uiRoot: HTMLElement, quality: QualityLevel, save: SaveData | null, vehicle: VehicleChoice = save?.vehicle ?? 'car') {
    prepareAirfield(world);
    const q = QUALITY[quality];
    const tStart = performance.now();
    let tLast = tStart;
    const timings: string[] = [];
    const lap = (name: string) => { const t = performance.now(); timings.push(`${name} ${(t - tLast).toFixed(0)}ms`); tLast = t; };
    this.renderer = new Renderer(canvas, q);
    const scene = this.renderer.scene;
    this.sky = new Sky(scene, this.renderer.sunDir);
    lap('sky');
    this.terrain = new Terrain(world, scene, q.terrainLodDistances);
    lap('terrain');
    const roads = new Roads(world, scene);
    lap('roads');
    // locales comerciales: cambia estilos y saca árboles, por eso va antes de casas y vegetación
    const shopPlan = planShops(world);
    console.info(`[calamuchita] locales: ${shopPlan.fronts.filter((f) => f.kind === 'centro').length} centroeuropeos, ${shopPlan.fronts.filter((f) => f.kind === 'local').length} comunes, ${shopPlan.decks.length} decks, ${shopPlan.magnolias.length} en Las Magnolias`);
    const buildings = new Buildings(world, scene);
    this.shops = new ShopDecor(shopPlan, scene);
    const landmarks = new Landmarks(world, scene);
    const airfield = new Airfield(world, scene);
    lap('buildings');
    this.vegetation = new Vegetation(world, scene, q.treeNearRadius, q.treeFarRadius, q.shadows);
    lap('vegetation');

    this.physics = new Physics(world);
    this.physics.addBoxes(buildings.colliders);
    this.physics.addBoxes(shopPlan.colliders);
    this.physics.addBoxes(landmarks.colliders);
    this.physics.addBoxes(airfield.colliders);
    for (const b of roads.bridgeColliders) this.physics.addTrimesh(b.vertices, b.indices);
    lap('physics');

    // punto de partida: frente al portal de VGB (o la partida guardada)
    const st = world.meta.start;
    const carX = save?.car.x ?? st.x, carN = save?.car.n ?? st.n, carH = save?.car.heading ?? st.heading;
    const car = new Vehicle(this.physics, world, scene, new THREE.Vector3(carX, world.heightAt(carX, carN) + 1, -carN), carH);
    const person = new Character(this.physics, scene);
    const plane = new Aircraft(world, scene, this.physics, getAirfield(world).spawn);
    this.player = new PlayerController(car, person, this.physics, world, plane);
    this.cameraRig = new CameraRig(this.renderer.camera, world);
    try {
      const v = localStorage.getItem('calamuchita.camera');
      if (v) this.cameraRig.setView(v);
    } catch { /* sin almacenamiento */ }
    // solo obstáculos fijos (casas, árboles, puentes); el terreno ya lo maneja la cámara
    this.cameraRig.occluder = (from, to) => {
      const d = to.clone().sub(from);
      const len = d.length();
      if (len < 0.01) return null;
      d.divideScalar(len);
      const hit = this.physics.world.castRay(new RAPIER.Ray(from, d), len, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, undefined, undefined, undefined, (c) => c.shape.type !== RAPIER.ShapeType.HeightField);
      return hit ? hit.timeOfImpact : null;
    };
    this.cameraRig.yaw = Math.atan2(-Math.cos(carH), Math.sin(carH));
    if (vehicle === 'plane') {
      this.player.selectVehicle('plane');
      this.cameraRig.setMode('flying');
      const f = plane.forward();
      this.cameraRig.yaw = Math.atan2(-f.x, -f.z);
    } else if (save?.mode === 'onfoot') {
      car.occupied = false;
      person.spawn(new THREE.Vector3(save.player.x, world.heightAt(save.player.x, save.player.n), -save.player.n), 0);
      this.player.mode = 'onfoot';
      this.cameraRig.setMode('onfoot');
    }

    this.input = new Input(canvas, uiRoot);
    this.state = this.input.read();
    this.hud = new HUD(world, uiRoot);
    lap('hud');
    this.pois = new POIs(world, scene, save?.discovered ?? []);
    lap('pois');
    this.hud.setFound(this.pois.discovered.size);
    this.hud.setVehicle(vehicle);

    this.hud.onTravel = (x, n, label) => this.fastTravel(x, n, label);
    this.hud.onVehicleChange = (choice) => this.selectVehicle(choice);
    this.hud.onReturnToAirfield = () => this.returnToAirfield();
    this.hud.onClose = () => { const p = this.player.position; this.hud.toggleMap(p.x, -p.z, this.pois.discovered); };

    bus.on('player:mode', (e) => {
      this.cameraRig.setMode(e.mode);
      if (e.mode === 'onfoot') this.cameraRig.yaw = Math.atan2(-this.player.car.forward().x, -this.player.car.forward().z);
    });

    this.loop = new GameLoop((dt) => this.fixed(dt), (dt, a) => this.frame(dt, a));
    this.vegetation.update(this.player.position, true);
    this.terrain.update(this.player.position);
    lap('first-update');
    window.addEventListener('beforeunload', () => this.save());
    (window as unknown as { __game: Game }).__game = this;
    console.info(`[calamuchita] armado en ${(performance.now() - tStart).toFixed(0)}ms: ${timings.join(', ')}`);
  }

  /** Compila los shaders sin trabar la página (antes del primer cuadro). */
  async warmup(): Promise<void> {
    const r = this.renderer;
    const p = this.player;
    await Promise.all([
      p.car.loadModel(`${import.meta.env.BASE_URL}models/fiat-uno-5-door.glb`),
      this.shops.load(import.meta.env.BASE_URL),
    ]);
    p.car.render(1);
    p.plane.render(1, 0);
    this.cameraRig.update(1 / 60, p.position, p.flying ? p.plane.forward() : p.car.forward(), 0, this.input.read());
    try {
      await r.renderer.compileAsync(r.scene, r.camera);
    } catch {
      /* si el navegador no lo soporta, se compila en el primer cuadro */
    }
  }

  start(): void {
    this.audio.start();
    this.music.start();
    this.loop.start();
    bus.emit('toast', this.player.flying
      ? { text: 'Aeroclub de Villa General Belgrano', sub: 'W acelera · S desacelera · tirá ↓ para despegar' }
      : { text: 'Bienvenido al Valle de Calamuchita', sub: 'Buscá las postales ✉ en los tres pueblos' });
  }

  private fixed(dt: number): void {
    if (this.hud.isMapOpen || this.debug?.god) return;
    this.player.fixedUpdate(dt, this.state, this.cameraRig.yaw);
    this.physics.step();
    this.player.postStep();
  }

  private frame(dt: number, alpha: number): void {
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    this.state = this.input.read();
    const p = this.player;
    const pos = p.position;

    const mapAt = this.debug?.god ? this.renderer.camera.position : pos;
    if (this.state.mapPressed) this.hud.toggleMap(mapAt.x, -mapAt.z, this.pois.discovered);
    if (this.state.cameraPressed) {
      this.cameraRig.cycleView();
      // sin cartel al cambiar de cámara
      try { localStorage.setItem('calamuchita.camera', this.cameraRig.view); } catch { /* sin almacenamiento */ }
    }
    if (this.state.musicPressed) {
      const name = this.music.next();
      bus.emit('toast', { text: `♪ Música: ${name}`, sub: 'N para cambiar' });
    }
    if (this.debug?.god) { this.godFrame(dt); return; }
    if (!this.hud.isMapOpen) p.handleActions(this.state);

    p.car.render(alpha);
    p.plane.render(alpha, this.hud.isMapOpen ? 0 : dt);
    p.person.render(alpha, dt);
    const driving = p.driving;
    const flying = p.flying;
    const target = flying ? p.plane.mesh.position : driving ? p.car.mesh.position : p.person.mesh.position;
    const forward = flying ? p.plane.forward() : p.car.forward();
    const speed = flying ? p.plane.speed : driving ? p.car.speed : 0;
    const cockpit = flying
      ? { quat: p.plane.mesh.quaternion, eye: p.plane.pilotEye, roll: true }
      : driving ? { quat: p.car.mesh.quaternion, eye: p.car.driverEye, roll: false } : undefined;
    this.cameraRig.update(dt, target, forward, speed, this.state, cockpit);
    // primera persona: interior del auto visible y sin dibujar el propio cuerpo a pie
    p.car.setInterior(this.cameraRig.isFirstPerson && driving);
    p.plane.setCockpit(this.cameraRig.isFirstPerson && flying);
    p.person.mesh.visible = p.person.active && !(this.cameraRig.isFirstPerson && !driving && !flying);

    this.terrain.update(this.renderer.camera.position);
    this.vegetation.update(target);
    this.physics.updateTrees(this.vegetation, target.x, -target.z);
    this.renderer.followShadow(target);
    this.sky.update(this.renderer.camera.position, this.time);
    this.pois.update(dt, target.x, -target.z, driving || flying, flying ? target.y : undefined);

    // HUD
    const heading = driving || flying ? Math.atan2(-forward.z, forward.x) : Math.atan2(Math.cos(this.cameraRig.yaw), -Math.sin(this.cameraRig.yaw)) ;
    this.hud.update(target.x, -target.z, driving || flying ? speed * 3.6 : null, driving ? p.car.surface : null);
    if (flying) this.hud.setFlight(p.plane.altitude, p.plane.grounded);
    const cam = driving || flying ? null : p.car.position;
    this.miniZoom += ((flying ? 0.4 : driving ? THREE.MathUtils.lerp(1, 0.55, Math.min(1, Math.abs(speed) / 30)) : 1.6) - this.miniZoom) * Math.min(1, dt * 2);
    this.hud.minimap.draw(target.x, -target.z, heading, cam ? cam.x : null, cam ? -cam.z : null, this.pois.discovered, this.miniZoom);
    const action = p.canExit() ? 'Bajarse del auto' : p.canEnter() ? 'Subir al auto' : null;
    if (this.input.touch) {
      this.input.touch.setAction(action ? (p.canExit() ? 'Bajar' : 'Subir') : null);
      this.input.touch.setDriving(driving);
      this.input.touch.setFlying(flying);
      this.hud.setPrompt(null);
    } else this.hud.setPrompt(action ? `<kbd>E</kbd> ${action}` : null);
    this.audio.update(driving || flying, speed, flying ? p.plane.throttleOut : p.car.throttleOut, flying ? 0 : p.car.rough, flying);

    this.saveTimer += dt;
    if (this.saveTimer > 5) { this.saveTimer = 0; this.save(); }
    this.renderer.render();
  }

  /** Cuadro en modo dios: la cámara vuela libre; el auto, la avioneta y el resto quedan quietos. */
  private godFrame(dt: number): void {
    const cam = this.renderer.camera;
    if (!this.hud.isMapOpen) this.debug!.update(dt, this.state);
    const p = this.player;
    p.car.render(1);
    p.plane.render(1, 0);
    p.person.render(1, 0);
    const ground = new THREE.Vector3(cam.position.x, this.world.heightAt(cam.position.x, -cam.position.z), cam.position.z);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    // la sombra y los árboles siguen al punto del suelo que se está mirando (cerca)
    const look = ground.clone().addScaledVector(dir.setY(0).normalize(), Math.min(120, Math.max(0, cam.position.y - ground.y)));
    look.y = this.world.heightAt(look.x, -look.z);
    this.terrain.update(cam.position);
    this.vegetation.update(look);
    this.renderer.followShadow(look);
    this.sky.update(cam.position, this.time);
    this.hud.update(cam.position.x, -cam.position.z, null, null);
    this.hud.minimap.draw(cam.position.x, -cam.position.z, Math.atan2(-dir.z, dir.x), null, null, this.pois.discovered, 1.2);
    this.hud.setPrompt(null);
    this.audio.update(false, 0, 0, 0, false);
    this.renderer.render();
  }

  save(): void {
    const p = this.player;
    const f = p.car.forward();
    SaveSystem.save({
      version: 1,
      mode: p.flying ? 'flying' : p.driving ? 'driving' : 'onfoot',
      vehicle: p.vehicle,
      car: { x: p.car.position.x, n: -p.car.position.z, heading: Math.atan2(-f.z, f.x) },
      player: { x: p.person.position.x, n: -p.person.position.z },
      discovered: [...this.pois.discovered],
    });
  }

  /** Viaje rápido: aparece en la calle más cercana al punto elegido en el mapa, ya arriba del auto. */
  fastTravel(x: number, n: number, label: string): void {
    if (this.player.flying) {
      bus.emit('toast', { text: 'Explorá el valle volando', sub: 'Para viajar por tierra, elegí Auto. La avioneta sale desde el aeroclub.' });
      return;
    }
    let best: { px: number; pn: number; dirX: number; dirN: number; dist: number } | null = null;
    for (let r = 0; r <= 400 && !best; r += 40) {
      for (let a = 0; a < (r ? 16 : 1); a++) {
        const qx = x + Math.cos((a / 16) * Math.PI * 2) * r, qn = n + Math.sin((a / 16) * Math.PI * 2) * r;
        const nr = this.world.nearestRoad(qx, qn);
        if (!nr || nr.road.bridge) continue;
        const d = Math.hypot(nr.px - x, nr.pn - n);
        if (!best || d < best.dist) best = { px: nr.px, pn: nr.pn, dirX: nr.dirX, dirN: nr.dirN, dist: d };
      }
    }
    const p = this.player;
    if (!p.driving) {
      p.person.despawn();
      p.car.occupied = true;
      p.mode = 'driving';
      bus.emit('player:mode', { mode: 'driving' });
    }
    const heading = best ? Math.atan2(best.dirN, best.dirX) : 0;
    this.teleport(best ? best.px : x, best ? best.pn : n, heading);
    this.cameraRig.yaw = Math.atan2(-Math.cos(heading), Math.sin(heading));
    this.vegetation.update(p.car.position, true);
    this.terrain.update(p.car.position);
    if (this.hud.isMapOpen) this.hud.toggleMap(0, 0, this.pois.discovered);
    bus.emit('toast', { text: `Viajaste a ${label}`, sub: 'Viaje rápido' });
    this.save();
  }

  selectVehicle(vehicle: VehicleChoice): void {
    if (vehicle === this.player.vehicle) return;
    this.player.selectVehicle(vehicle);
    this.hud.setVehicle(vehicle);
    const forward = vehicle === 'plane' ? this.player.plane.forward() : this.player.car.forward();
    this.cameraRig.yaw = Math.atan2(-forward.x, -forward.z);
    this.cameraRig.snap();
    this.vegetation.update(this.player.position, true);
    this.terrain.update(this.player.position);
    if (this.hud.isMapOpen) this.hud.toggleMap(0, 0, this.pois.discovered);
    bus.emit('toast', vehicle === 'plane'
      ? { text: 'Avioneta lista en el aeroclub', sub: 'Acelerá para despegar. Podés volver al auto cuando quieras.' }
      : { text: 'De vuelta en el auto', sub: 'Seguís desde donde lo dejaste.' });
    this.save();
  }

  returnToAirfield(): void {
    if (!this.player.flying) return;
    this.player.plane.reset();
    const f = this.player.plane.forward();
    this.cameraRig.yaw = Math.atan2(-f.x, -f.z);
    this.cameraRig.snap();
    this.vegetation.update(this.player.position, true);
    this.terrain.update(this.player.position);
    if (this.hud.isMapOpen) this.hud.toggleMap(0, 0, this.pois.discovered);
    bus.emit('toast', { text: 'De vuelta en el aeroclub', sub: 'La pista está lista para otro vuelo.' });
    this.save();
  }

  /** Utilidad de depuración: teletransportar el auto (coordenadas del pipeline). */
  teleport(x: number, n: number, heading = 0): void {
    this.player.car.place(x, n, heading);
    this.cameraRig.snap();
  }
}
