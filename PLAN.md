# Calamuchita — Plan de juego y arquitectura

> Juego de manejo y exploración por el Valle de Calamuchita, con la **geografía real** del lugar.
> **Versión 1:** Villa General Belgrano, Los Reartes y Villa Ciudad Parque.
> Estética indie estilizada y pintada a mano, jugable en el navegador. Podés manejar entre los pueblos, bajarte y recorrerlos caminando.

![Referencia visual](docs/referencias/referencia-vgb-portal.jpg)

---

## 1. Visión

- **Género:** exploración / "cozy driving" en mundo abierto chico. Sin presión de tiempo por defecto.
- **Fantasía central:** salir de Villa General Belgrano por la ruta, ver las sierras, cruzar el río Los Reartes, parar donde quieras, bajarte y recorrer el pueblo a pie.
- **Plataforma:** browser desktop primero (teclado + gamepad). Mobile como objetivo secundario.
- **Hardware objetivo:** 60 fps en una MacBook Air M1 en Chrome/Safari a 1080p con calidad "media".

### Pilares de diseño
1. **La geografía es real.** Rutas, ríos, relieve y ubicación de los pueblos salen de datos reales. Alguien de la zona tiene que poder orientarse sin mapa.
2. **Auto ↔ a pie sin cortes.** Bajarse y subirse es instantáneo, sin pantallas de carga.
3. **Manejo con carácter, no simulación.** Asfalto, ripio y tierra se sienten distintos, pero el auto es fácil de controlar.
4. **Estilizado, cálido y legible.** Look pintado a mano (ver §3), no fotorrealismo ni pixel art.

---

## 2. Geografía real — alcance de la versión 1

> Fuentes del relevamiento: trazado de rutas de Google Maps (solo como referencia visual) y datos de OpenStreetMap (rutas, superficies, ríos, POIs y coordenadas). **Los datos que entran al juego salen de OpenStreetMap y de modelos de elevación abiertos**, no de Google Maps (sus términos no permiten extraer datos). Atribución obligatoria en créditos: "© colaboradores de OpenStreetMap" (ODbL).

### 2.1 Área de juego
| | Valor |
|---|---|
| Bounding box (lat) | −31.995 → −31.875 |
| Bounding box (lon) | −64.605 → −64.515 |
| Tamaño aproximado | **~8.5 km (E‑O) × ~13.3 km (N‑S)** ≈ 113 km² |
| Proyección | UTM zona 20S (EPSG:32720) → metros locales |
| Origen del mundo (0,0) | Centro de Villa General Belgrano (−31.9765, −64.5590) |
| Ejes | X = Este, Z = Norte (en Three.js: −Z), Y = altura |

### 2.2 Localidades
| Localidad | Coordenadas OSM | Posición local (km E, km N) | Carácter |
|---|---|---|---|
| **Villa General Belgrano** | −31.9765, −64.5590 | (0.0, 0.0) | Pueblo alpino/centroeuropeo, el más grande (~11.700 hab.). Calles con arroyos y puentes, cerros al este. |
| **Los Reartes** | −31.9207, −64.5769 | (−1.7, +6.2) | Pueblo histórico y criollo (~3.000 hab.), sobre el río Los Reartes, balnearios. |
| **Villa Ciudad Parque Los Reartes** | −31.9124, −64.5288 (núcleo junto a RP5) | (+2.9, +7.1) | Villa serrana residencial (~2.700 hab.), se extiende desde el río (oeste) hasta la RP5 (este); barrios El Cedrón. |

### 2.3 Red vial (según OSM)
| Ruta | Nombre(s) | Superficie | Rol en el juego |
|---|---|---|---|
| **RP 5** | Ruta Provincial 5 | Asfalto | Eje troncal N‑S por el **este**. Pasa junto a VGB y llega a la altura de Villa Ciudad Parque. Es la ruta "rápida". |
| **RP E‑83** | Av. Julio A. Roca, Av. Las Magnolias, Av. San Martín | Asfalto / adoquín | **Eje urbano de VGB**, conecta el centro con la RP5. La calle principal del pueblo. |
| **RP S‑271** | Av. San Martín → Ruta Provincial S‑271 | Asfalto | **Conexión directa VGB → Los Reartes** hacia el norte/noroeste; cruza cursos de agua con varios puentes y sigue hacia el norte (Balneario El Puente). |
| **RP S‑430** | Boulevard Los Reartes, Puente Los Reartes–Villa Ciudad Parque, Juan Manuel de Rosas | Asfalto / compactado | **Transversal E‑O**: sale de la RP5, atraviesa Villa Ciudad Parque, cruza el río Los Reartes por el puente y entra a Los Reartes. |
| **RP S‑210** | Ruta Provincial S‑210 | Asfalto / pavimento | Transversal entre la RP5 y el oeste (zona media del valle). *Verificar en terreno: Google la rotula distinto.* |
| **RP S‑373** | Av. Argentina, Corrientes | Asfalto / **sin pavimentar** | Salida sur‑oeste de VGB, parte en ripio. |
| Calles internas | — | Mezcla, mucho **ripio y tierra** | Barrios de los tres pueblos. Importadas con su `surface` de OSM. |

**Recorrido de referencia (Google Maps):** VGB → RP5 norte → RP S‑430 oeste → Villa Ciudad Parque = **12.9 km (~17 min)**; Villa Ciudad Parque → Los Reartes por la costanera = **2.4 km (~8 min)**. Total 15.2 km.
**Circuito natural del juego:** VGB → RP5 → S‑430 → Villa Ciudad Parque → puente → Los Reartes → S‑271 → VGB (≈ 22–24 km).

### 2.4 Hidrografía
- **Río Los Reartes**: separa Los Reartes de Villa Ciudad Parque; corre de suroeste a noreste. Costaneras (Bartolomé Lema, Justiniano Sánchez), balnearios y puentes. Es el elemento geográfico central del área norte.
- **Río del Medio** y arroyos **La Toma, Los Molles, El Corral, El Sauce, Portezuelo, Los Gigenas, Cordobensis**.
- En VGB, los arroyos cruzan la trama urbana: puentes en Av. San Martín, El Quebracho, Av. Ojo de Agua, Los Cerezos, Corrientes, Julio Kochmann; *Paseo de los Arroyos*.

### 2.5 Relieve
- Valle con fondo ondulado entre ~700 y 800 m s. n. m. (a confirmar con DEM).
- **Al este** de VGB: Cerro La Virgen (980 m, con mirador) y Cerro Alemán; detrás, las **Sierras Chicas** (la RP5 tiene el mirador camino a San Agustín).
- **Al oeste**: lomadas hacia Cristo Grande, Capilla Vieja y, en el horizonte, las **Sierras Grandes**. Se renderizan como fondo lejano fuera del área jugable.

### 2.6 Puntos de interés (coordenadas OSM)
**Villa General Belgrano**
| POI | Coordenadas | Notas |
|---|---|---|
| Portal de entrada "Capital Nacional de la Cerveza" | sobre RP5 / E‑83 | Escena de la imagen de referencia. Ubicación exacta a relevar. |
| Torre del Reloj | −31.9795, −64.5601 | Hito vertical del centro. |
| Barril Cervecero | −31.9761, −64.5589 | |
| Castillo Romano | −31.9767, −64.5566 | |
| Paseo de los Arroyos | −31.9785, −64.5566 | |
| Museo Histórico y Centro Cultural | −31.9796, −64.5619 | |
| Casa de la Historia y la Cultura del Bicentenario | −31.9774, −64.5606 | |
| Plaza Enrique Dick | −31.9733, −64.5637 | |
| Cerro La Virgen + Mirador | −31.9814, −64.5429 (980 m) | Destino a pie. |
| Cerro Alemán | −31.9828, −64.5408 | |
| Pileta Municipal | −31.9847, −64.5600 | |

**Los Reartes**
| POI | Coordenadas | Notas |
|---|---|---|
| Capilla Inmaculada Concepción | −31.9189, −64.5760 | Capilla histórica, centro del pueblo. |
| Corral de Piedras (año 1780) | −31.9168, −64.5811 | |
| Morteros aborígenes | −31.9231, −64.5744 | |
| Campo de doma | −31.9182, −64.5771 | |
| Zona de balnearios / Balneario | −31.9206, −64.5735 | |
| Balneario El Aguacero | −31.9270, −64.5875 | |
| Puentes S‑271 | −31.9257, −64.5771 · −31.9156, −64.5839 | |

**Villa Ciudad Parque**
| POI | Coordenadas | Notas |
|---|---|---|
| Puente Los Reartes – Villa Ciudad Parque | −31.9012, −64.5652 | Conexión entre pueblos. |
| Balneario Villa Ciudad Parque | −31.9017, −64.5648 | |
| Capilla Nuestra Señora de Fátima | −31.9126, −64.5275 | |
| Museo del Carruaje El Tacú | −31.8973, −64.5231 | |
| Barrios del Cedrón (Bosques, Colinas, Lomas, Valle, Ribera) | ~−31.90, −64.53/−64.56 | Zona residencial entre pinos, calles de tierra. |

> Esta lista sale de OSM; el relevamiento en persona (fotos, qué está bien ubicado, qué falta) es parte del Hito M3.

### 2.7 Escala
- **Proporciones siempre reales.** Nunca se deforma el mapa: si hace falta achicar, se aplica un **factor uniforme** `WORLD_SCALE` a todo.
- Arranque: `WORLD_SCALE = 1.0` (1:1). A 90–100 km/h, VGB → Los Reartes son ~4–5 min de manejo: razonable para un juego contemplativo.
- Si en el playtest se siente largo, probar `0.75` o `0.5` (los pueblos se pueden mantener a 1:1 con una zona de transición suave).
- Altura: real (`HEIGHT_SCALE = 1.0`), con opción de exagerar levemente (≤ 1.2) solo para el fondo lejano.

```
                    N
                    ↑
                              Museo El Tacú ●
        Balneario El Puente ●
                       Puente LR–VCP ●══ S‑430 ══● Villa Ciudad Parque ── RP5
                 ~~Río Los Reartes~~                     │
          Los Reartes ●                                  │
                 │                                       │
              S‑271                                     RP5
                 │                                       │
                 │                                       │
                 └──────── Villa General Belgrano ●──────┘  ● Cerro La Virgen
                                    (E‑83)
```
*(esquema no a escala)*

---

## 3. Dirección de arte (según la imagen de referencia)

Archivo: `docs/referencias/referencia-vgb-portal.jpg`

**Lo que define la referencia**
- **Look pintado a mano**: texturas con pincelada, sombreado suave tipo *toon* con 3–4 tonos, sin brillos especulares. Más cerca de un juego estilizado moderno que de un low‑poly plano.
- **Paleta cálida**: verdes oliva y musgo, ocres de pasto seco, tejas rojo óxido, piedra gris cálida, cielo azul saturado con nubes cremosas.
- **Cámara elevada de persecución** (~35–50° de inclinación) detrás del auto, con mucha visión del entorno.
- **Pinos** como elemento dominante, con follaje en capas de "pinceladas".
- **Arquitectura alpina**: entramado de madera (*fachwerk*), techos a dos aguas de teja, balcones; **Torre del Reloj** como hito vertical.
- **Portal de entrada** de piedra y madera con cartel tallado.
- **Ruta de asfalto** con doble línea amarilla central, banquinas de tierra, carteles verdes.
- **Auto clásico** color crema (sedán argentino de los 70/80 genérico, sin marca).
- **Sierras** en el fondo con perspectiva atmosférica (se aclaran y azulan con la distancia).

**Cómo lograrlo técnicamente**
- Material propio (`ShaderMaterial` / `onBeforeCompile` sobre `MeshStandardMaterial`):
  - Iluminación difusa cuantizada con **rampa de color** (gradient map) en lugar de `MeshToonMaterial` crudo.
  - **Textura de pincelada** en espacio de mundo (triplanar) que modula la luz → look pintado sin pintar cada textura.
  - Rim light suave del lado del cielo.
- **Árboles**: tronco simple + copas hechas de "tarjetas" de pinceladas con alpha (técnica de *foliage cards*) y normales esféricas infladas para que la luz los modele como volumen. Instanciados (`InstancedMesh`).
- **Terreno**: mezcla por pendiente/altura/máscara (pasto, pasto seco, tierra, roca) + misma textura de pincelada.
- **Cielo**: gradiente pintado + nubes planas billboard; niebla de altura con tinte azulado para la perspectiva atmosférica.
- **Post‑proceso** (preset medio/alto): color grading cálido, viñeta leve, opcional *Kuwahara* liviano para reforzar lo pictórico, opcional outline sutil.
- **Sombras**: una sola luz direccional, sombra suave y de color (no negra).

---

## 4. Elección de tecnología

| Capa | Tecnología | Por qué |
|---|---|---|
| Lenguaje | **TypeScript** (strict) | Tipado, refactors seguros, mismo lenguaje que el día a día en Angular. |
| Render 3D | **Three.js** | El ecosistema 3D web más grande, liviano, control total de shaders para el look pintado. |
| Física | **Rapier** (`@dimforge/rapier3d-compat`, WASM) | Rápido y trae **dos piezas clave**: `DynamicRayCastVehicleController` (auto) y `KinematicCharacterController` (personaje a pie). Soporta colliders `heightfield` para el terreno. |
| Build / dev server | **Vite** | HMR instantáneo, soporte nativo de WASM, workers y TS. |
| UI / HUD | DOM + CSS sobre el canvas (vanilla o Preact si crece) | El HUD es chico; no hace falta un framework pesado dentro del loop. |
| Audio | **Howler.js** + `THREE.PositionalAudio` | Simple y robusto en todos los browsers. |
| Debug | **lil-gui** + **stats-gl** + debug render de Rapier | Tunear manejo y shaders en vivo. |
| Assets | **Blender → glTF/GLB**, optimizado con **gltf-transform** (meshopt + KTX2) | Estándar web, archivos chicos. |
| Datos geográficos | **OpenStreetMap** (Overpass API) + **DEM** Copernicus GLO‑30 / MDE‑Ar del IGN | Geografía real con licencias abiertas. |
| Tests | **Vitest** + **Playwright** (smoke test) | |
| Deploy | Netlify / Vercel / GitHub Pages; **itch.io** para publicar | Todo estático. |

**Alternativas consideradas:** Babylon.js + Havok (segunda opción; Havok no trae controlador de vehículo listo), React Three Fiber (mete React en el loop de juego), PlayCanvas (flujo centrado en su editor), Godot web export (más pesado y arranque lento), Phaser (2D no encaja con sierras y cámara elevada).

---

## 5. Pipeline geográfico (offline, en `tools/`)

```
Overpass (OSM) ──► osm-raw.json ─┐
                                 ├─► proyección UTM 20S → metros locales (origen VGB) × WORLD_SCALE
DEM GeoTIFF ─────► recorte bbox ─┘
        │
        ├─► terreno: heightmap remuestreado (~2 m) + detalle procedural  → chunks 256×256 m (PNG 16‑bit)
        ├─► tallado: aplanar bajo calles, canal de ríos, plataformas de edificios (bake en el heightmap)
        ├─► rutas: splines + ancho + superficie (asphalt | paving | compacted | gravel | dirt) + puentes
        ├─► agua: ríos (líneas → canal + malla), balnearios
        ├─► edificios: huellas OSM → tipo de pieza modular por localidad (alpina / criolla / cabaña)
        ├─► vegetación: máscaras por bioma (pinar, pastizal, ribera, monte) → puntos Poisson por chunk
        └─► POIs: JSON con id, nombre, coordenadas, localidad, tipo
                                 ▼
                      public/world/  (lo que carga el juego)
```

**Detalles**
1. **Consultas Overpass** versionadas en `tools/queries/` (rutas, calles, ríos, edificios, POIs). El resultado crudo se guarda en el repo para no depender de la API en cada build.
2. **Elevación**: GLO‑30 (30 m) es la base; se interpola a ~2 m y se agrega ruido suave **solo fuera de rutas y pueblos** para que no quede "liso". Si el IGN tiene un MDE de mejor resolución para la zona, se usa ese.
3. **Rutas**: las vías de OSM se suavizan (Catmull‑Rom), se calcula el perfil vertical suavizado (pendiente máxima razonable) y el terreno se ajusta a la ruta, no al revés.
4. **Puentes**: los `bridge=yes` de OSM se reemplazan por piezas de puente; debajo, el canal del río.
5. **Curado manual**: `tools/overrides/*.json` permite corregir a mano lo que OSM tenga mal (posición del portal, superficie de un tramo, edificios importantes) sin tocar los datos crudos.
6. **Validación**: un script genera un PNG de vista superior del mundo procesado para compararlo contra el mapa real.

---

## 6. Arquitectura del código

### 6.1 Principios
- **Loop explícito con paso fijo de física** (60 Hz) + render variable con interpolación.
- **Sistemas desacoplados** que se comunican por un **event bus** tipado.
- **Composición liviana** (entidades = objetos con componentes). Si crecen tráfico/NPCs, migrar a **miniplex** o **bitECS**.
- **Lógica pura testeable** separada de Three/Rapier.
- **Data‑driven**: autos, lugares, POIs, misiones y diálogos en JSON/TS.

### 6.2 Estructura de carpetas
```
calamuchita-game/
├─ PLAN.md
├─ docs/referencias/       # imágenes de referencia, fotos del relevamiento
├─ index.html
├─ vite.config.ts
├─ public/
│  ├─ world/               # salida del pipeline: chunks, rutas, ríos, POIs
│  ├─ models/              # .glb optimizados
│  ├─ textures/            # .ktx2, rampas de color, pinceladas
│  └─ audio/
├─ tools/
│  ├─ queries/             # consultas Overpass
│  ├─ raw/                 # OSM y DEM crudos (versionados o descargables)
│  ├─ overrides/           # correcciones manuales
│  ├─ fetch-osm.ts
│  ├─ process-dem.ts
│  ├─ build-world.ts       # chunks, rutas, tallado, vegetación, POIs
│  ├─ preview-map.ts       # PNG de validación
│  └─ optimize-assets.ts
├─ src/
│  ├─ main.ts
│  ├─ core/        Game.ts · GameLoop.ts · EventBus.ts · AssetManager.ts · Config.ts
│  ├─ engine/      Renderer.ts · PostFX.ts · Physics.ts · Input.ts
│  ├─ render/      PaintedMaterial.ts · FoliageMaterial.ts · TerrainMaterial.ts · Sky.ts · Water.ts
│  ├─ world/       WorldStreamer.ts · TerrainChunk.ts · Roads.ts · Bridges.ts · Vegetation.ts · Buildings.ts · Geo.ts
│  ├─ player/      PlayerController.ts · Vehicle.ts · VehicleAudio.ts · Character.ts · CameraRig.ts
│  ├─ gameplay/    Interaction.ts · POI.ts · Quests.ts · NPC.ts · SaveSystem.ts
│  ├─ ui/          HUD.ts · Minimap.ts · Menus.ts · styles.css
│  ├─ data/        vehicles.ts · places.ts · quests.ts
│  └─ utils/
└─ tests/
```
`world/Geo.ts` concentra la conversión lat/lon ↔ mundo (misma fórmula que el pipeline) para ubicar POIs, el minimapa y futuras features.

### 6.3 Flujo del loop
```
requestAnimationFrame
  └─ Input.poll()
  └─ acumulador += dt
      mientras acumulador >= 1/60:
         PlayerController.fixedUpdate()
         Physics.step()
         acumulador -= 1/60
  └─ sincronizar transforms (interpolando)
  └─ CameraRig.update(dt)
  └─ WorldStreamer.update(posJugador)
  └─ Gameplay / UI
  └─ Renderer.render() → PostFX
```

### 6.4 Máquina de estados del jugador
```
          [E cerca de la puerta]               [~0.6 s]
 OnFoot ──────────────────────────► EnteringCar ──────────► Driving
   ▲                                                          │
   │          [~0.6 s]             [E y velocidad < umbral]    │
   └──────────── ExitingCar ◄─────────────────────────────────┘
```
- Al bajarse se busca un punto libre al costado de la puerta (raycast + test de colisión).
- El auto queda estacionado (cuerpo físico dormido) y marcado en el minimapa.
- La cámara interpola entre el rig de manejo (alto, como la referencia) y el de tercera persona (más bajo y cerca).

### 6.5 Vehículo
- `DynamicRayCastVehicleController` de Rapier; parámetros en `data/vehicles.ts`.
- **Tuning por superficie** (dato que viene de OSM por tramo):

| Superficie | Agarre | Vel. máx. sugerida | Feedback |
|---|---|---|---|
| Asfalto (RP5, E‑83, S‑271, S‑430) | alto | 100 % | sonido limpio |
| Adoquín (centro de VGB) | alto | 80 % | traqueteo suave |
| Compactado | medio‑alto | 85 % | algo de polvo |
| Ripio | medio, derrapa | ~70 % | piedritas, polvo, vibración |
| Tierra / pasto | bajo | ~50 % | polvo, rebote |
| Vado / agua | muy bajo | ~30 % | salpicadura |

- Ayudas arcade: anti‑vuelco, asistencia de dirección, reset si queda dado vuelta.

### 6.6 Personaje a pie
- `KinematicCharacterController`: escalones, pendiente máxima, snap al piso.
- Caminar / correr / saltar corto; animaciones con `AnimationMixer`.
- Interacciones: POIs, NPCs, bancos, modo foto, subir a pie al Cerro La Virgen.

### 6.7 Streaming del mundo
- ~113 km² a 1:1 → grilla de chunks de 256 m (~1.800 chunks, la mayoría solo terreno + vegetación).
- Radio de carga mayor manejando, menor a pie. Colliders `heightfield` solo en chunks cercanos.
- **LOD** de terreno (3 niveles) y de vegetación (copas → impostores a distancia).
- Carga y decodificación en **Web Workers**.
- Fondo lejano siempre cargado: anillo de sierras de baja resolución (Sierras Grandes al oeste, Sierras Chicas al este).
- Coordenadas: el área cabe en ±13 km del origen, precisión `float32` suficiente; *floating origin* solo si se amplía el mapa.

### 6.8 Input y guardado
- Acciones abstractas → teclado (WASD/flechas, E, Espacio, M, Esc), gamepad, touch (fase posterior).
- `SaveSystem`: posición, estado (a pie / en auto), posición del auto, POIs descubiertos, misiones, opciones. `localStorage`/IndexedDB con versión de formato.

---

## 7. Gameplay

**MVP (versión 1)**
- Recorrer libremente VGB, Los Reartes y Villa Ciudad Parque por su red vial real.
- Bajarse y caminar en cualquier lugar.
- Minimapa y mapa grande generados desde los mismos datos del mundo, con nombres reales de rutas.
- **Descubrimientos**: cada POI de §2.6 desbloquea una "postal" ilustrada en una colección.
- Carteles de ruta reales (RP5, S‑271, S‑430) y portales/carteles de entrada a cada localidad.

**Capa 2**
- Mandados entre pueblos (llevar algo de VGB a Los Reartes, ir al balneario, subir al mirador al atardecer).
- NPCs con diálogos cortos en tono cordobés.
- Radio del auto, modo foto, ciclo día/noche.

**Capa 3 (expansión)**
- Nuevas localidades sobre la misma red: Villa Berna y La Cumbrecita (pueblo peatonal: obliga a dejar el auto), Santa Rosa de Calamuchita, Lago Los Molinos.
- Clima (lluvia que embarra el ripio), eventos de temporada (fiestas del pueblo).

---

## 8. Assets

- **Kits modulares en Blender** según la referencia:
  - *Alpino VGB*: muros con entramado, techos de teja a dos aguas, balcones, Torre del Reloj, portal de entrada.
  - *Criollo Los Reartes*: casas bajas encaladas, galerías, capilla, pircas de piedra.
  - *Serrano Villa Ciudad Parque*: cabañas y casas entre pinos, cercos, tranqueras.
  - *Ruta*: carteles verdes, mojones, guardarraíles, puentes, banquinas.
- **Prototipado** con packs CC0 (Kenney, Quaternius, Poly Pizza) re‑materializados con el shader pintado.
- **Convenciones**: 1 unidad = 1 m, Y arriba, origen en la base, `kit_alpino_muro_01`, colliders `*_col`.
- **Audio**: grabaciones de campo propias (río Los Reartes, pájaros, viento en los pinos, ripio bajo las ruedas).

---

## 9. Roadmap por hitos

| Hito | Objetivo | Entregable |
|---|---|---|
| **M0 · Setup** (1 sem.) | Vite + TS + Three + Rapier, loop con paso fijo, debug GUI, deploy automático. | Cubo que cae sobre un plano, publicado. |
| **M1 · Auto en caja de arena** (2 sem.) | Vehículo raycast, cámara elevada tipo referencia, superficies, sonido de motor. | Pista de prueba donde manejar ya es divertido. |
| **M2 · A pie + transición** (1–2 sem.) | Personaje cinemático, subir/bajar del auto, cámara de tercera persona. | Loop "manejar → bajarse → caminar → volver". |
| **M3 · Pipeline geográfico** (3 sem.) | Overpass + DEM → chunks, rutas talladas, ríos, puentes, streaming. PNG de validación. Relevamiento en persona. | Manejar el circuito VGB → RP5 → S‑430 → Villa Ciudad Parque → puente → Los Reartes → S‑271 → VGB por el trazado real. |
| **M4 · Look pintado** (2–3 sem.) | Shader pintado, terreno, pinos con *foliage cards*, cielo, niebla, post‑proceso. | Captura comparable con la imagen de referencia. |
| **M5 · Pueblos** (4 sem.) | Kits modulares, los tres pueblos armados, POIs, minimapa. | **Vertical slice**. |
| **M6 · Gameplay** (2–3 sem.) | Postales, NPCs, mandados, guardado, menús, presets de calidad. | Demo pública (itch.io). |
| **M7 · Pulido y expansión** | Audio de campo, radio, día/noche, nuevas localidades. | Versiones siguientes. |

> Tiempos para trabajo part‑time. **Regla:** no pasar a M3 hasta que manejar en M1 sea divertido en una pista vacía.

---

## 10. Rendimiento

- [ ] Paso fijo de física, render interpolado.
- [ ] `InstancedMesh` para pinos y props; impostores a distancia.
- [ ] Geometría estática fusionada por chunk; frustum culling por chunk.
- [ ] Colliders solo cerca del jugador; cajas/cápsulas para edificios.
- [ ] Workers para carga/decodificación.
- [ ] KTX2 + meshopt en todos los assets.
- [ ] Presets bajo / medio / alto (sombras, distancia, densidad de vegetación, post‑proceso, pixel ratio).
- [ ] Presupuesto inicial: < 150 draw calls, < 500k triángulos visibles.

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El manejo no se siente bien | Hito M1 dedicado, con tuning en vivo. |
| Datos OSM incompletos o con errores | Carpeta `overrides/` + relevamiento en persona. Se puede mejorar OSM y beneficiar a todos. |
| DEM de 30 m demasiado grueso cerca de rutas | Rutas mandan sobre el terreno; detalle procedural fuera de rutas; buscar MDE de mejor resolución. |
| 1:1 se siente largo o vacío | `WORLD_SCALE` uniforme + densidad de contenido sobre las rutas. |
| El look pintado es caro en GPU | Efectos pesados (Kuwahara, outline) solo en preset alto. |
| Producción de assets | Kits modulares + packs CC0 para lo no identitario. |
| Safari / WebGL | Probar en Safari desde M0. WebGPU como mejora futura. |

---

## 12. Primeros pasos concretos

```bash
npm create vite@latest . -- --template vanilla-ts
npm i three @dimforge/rapier3d-compat howler
npm i -D @types/three @types/howler lil-gui stats-gl vitest
```
1. `Game`, `GameLoop`, `Renderer`, `Physics`, `Input` (§6.2).
2. Plano + cubo dinámico para validar el paso fijo.
3. Chasis + `DynamicRayCastVehicleController` + `CameraRig` elevado.
4. En paralelo: `tools/fetch-osm.ts` con las consultas de §5 y un primer `preview-map.ts` para ver el área de juego.
5. Deploy en cada push.

---

## 13. Decisiones abiertas
- Nombre del juego.
- Época: ¿actual o con nostalgia (autos de los 70/80, como el sedán de la referencia)?
- `WORLD_SCALE` definitivo tras el primer playtest a 1:1.
- Ubicación exacta del portal de entrada de VGB y de otros carteles/hitos que no están en OSM.
- Qué edificios se modelan de forma única (Torre del Reloj, capillas, Castillo Romano) y cuáles salen del kit modular.
- Objetivo comercial (itch.io pago / Steam vía wrapper) o proyecto libre.

---

## 14. Estado actual (11/10/2026)

**Hecho — primera versión jugable** (`npm install && npm run dev`):
- [x] **M0** Vite + TypeScript + Three.js + Rapier, loop con física a 60 Hz fija.
- [x] **M1** Auto con `DynamicRayCastVehicleController`, tracción trasera, agarre por superficie (asfalto / adoquín / compactado / ripio / tierra / campo), anti‑vuelco y reset (`R`).
- [x] **M2** Personaje a pie (`KinematicCharacterController`), bajarse/subirse con `E`, cámara en tercera persona y cámara de manejo elevada como la referencia (con colisión contra casas).
- [x] **M3** Pipeline geográfico real: OSM (1.645 calles, 70 cursos de agua, 594 edificios, 26 POIs) + relieve 10 m; rutas y ríos tallados en el terreno; puentes con colisión; fondo de sierras a 200 m. Validación: `docs/preview-mundo.png` y `npm run test:physics` (heightfield vs. datos: error < 1 cm).
- [x] **M4 (base)** Material pintado (toon + pinceladas en espacio de mundo), cielo con nubes pintadas, niebla, sombras, ~250 k árboles con 2 niveles de detalle.
- [x] **M5 (base)** Estilos por pueblo (alpino VGB, criollo Los Reartes, serrano Villa Ciudad Parque), portal de entrada, Torre del Reloj, capillas, Castillo Romano, Barril Cervecero; minimapa y mapa grande.
- [x] **M6 (parcial)** 26 postales para descubrir, guardado automático, presets de calidad, sonido de motor sintetizado.

**Pendiente / próximos pasos sugeridos**
- Probar rendimiento real en la MacBook Air (el entorno de prueba no tenía GPU). Si hace falta: bajar `treeNearRadius` o usar calidad "Baja".
- Relevamiento en persona: ubicación exacta del portal (hoy está en el cruce E‑83 / RP5), carteles, hitos faltantes → `tools/overrides/world.json`.
- Árboles: copas con *foliage cards* pintadas para acercarse más a la referencia; transparencia de árboles que tapan la cámara.
- NPCs, mandados entre pueblos, ciclo día/noche, radio del auto (música con Magnific, cuidando créditos).
- Mobile (controles táctiles).
