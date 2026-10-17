# Vallecito

*Manejá el valle.* · [vallecito.ar](https://vallecito.ar) · creado por Marcos Pucineri ([Valle Visual](https://vallevisual.com))

Juego de manejo, vuelo y exploración por el Valle de Calamuchita (Córdoba, Argentina) con **geografía real**:
Villa General Belgrano, Los Reartes y Villa Ciudad Parque. Se juega en el navegador.

![Referencia visual](docs/referencias/referencia-vgb-portal.jpg)

## Cómo correrlo

```bash
npm install
npm run dev        # abre http://localhost:5173
```

El mundo ya viene generado en `public/world/`. Solo hace falta regenerarlo si cambiás datos o el pipeline (ver abajo).

Para publicar: `npm run build` genera `dist/` (estático; sirve para Netlify, Vercel, GitHub Pages o itch.io).

### Railway

El proyecto ya está listo para Railway (`npm run build` + `npm start`, que levanta `server.mjs` con gzip):

```bash
railway init        # una sola vez: crea el proyecto
railway up          # sube y despliega
railway domain      # genera la URL pública
```

En el celular hay controles táctiles (joystick + botones) y la calidad arranca en "Baja".

## Elegí cómo recorrer el valle

En la pantalla inicial y durante el paseo podés elegir **Auto** o **Avioneta**.
La avioneta **siempre sale desde la pista del Aeroclub de Villa General Belgrano**: tanto al elegirla como al retomar una partida. Acelerá por la pista y mantené **Espacio** para despegar.

Al volver al auto, lo encontrás donde lo habías dejado. Se conservan las postales al cambiar de vehículo. En avioneta, el mapa muestra el aeroclub y permite volver a la pista; para usar viajes rápidos por tierra, elegí Auto.

## Controles del auto y a pie

| Acción | Teclado | Gamepad |
|---|---|---|
| Acelerar / frenar / marcha atrás | `W` / `S` (o flechas) | RT / LT |
| Doblar / caminar | `A` `D` | stick izquierdo |
| Freno de mano / saltar | `Espacio` | A |
| Entrar / salir del vehículo; abrir paracaídas | `E` | X / Y |
| Correr (a pie) | `Shift` | B |
| Mapa | `M` | Select |
| Cambiar cámara | `C` | RB |
| Enderezar el auto | `R` | LB |
| Mirar alrededor / zoom | arrastrar el mouse / rueda | stick derecho |
| Mostrar/ocultar ayuda | `H` | |

## Controles de la avioneta

| Acción | Teclado | Gamepad |
|---|---|---|
| Acelerar / desacelerar | `W` / `S` (o flechas arriba/abajo) | RT / LT |
| Girar | `A` / `D` (o flechas izquierda/derecha) | stick izquierdo horizontal |
| Subir / bajar | `Espacio` / `Shift` | stick izquierdo vertical |
| Volver al aeroclub | `R` | LB |
| Mapa / cámara / ayuda | `M` / `C` / `H` | Select / RB |

Con **E** podés bajar de la avioneta en tierra o saltar en vuelo. En el aire caés en picada: volvé a pulsar **E** para abrir el paracaídas y dirigí el descenso con WASD / flechas. Al tocar suelo volvés a caminar. En mobile aparecen **Saltar** y **Abrir paracaídas**, y el joystick dirige el descenso. La caída no suma kilómetros a pie.

En celular, usá el joystick para girar y los botones **Acelerar**, **Desacel.**, **Subir**, **Bajar** y **Aeroclub** para volar.

La partida se guarda sola en el navegador y, al crear una cuenta, también en Supabase. Incluye nombre, aspecto, vehículo, posición del auto, postales y Serranos. Abrí el perfil desde el inicio o tocando la moneda durante el paseo. La avioneta vuelve al aeroclub al cargar si estabas pilotando. Si habías bajado, conserva su posición en tierra; si estabas cayendo, se retoman la altura y el estado del paracaídas. «Borrar la partida y empezar» también borra las postales.

Para probar el vuelo directamente: `http://localhost:5173/?auto=1&vehicle=plane` (agregá `&fresh=1` para borrar la partida).

## Jugar con otros y chat

Todos ven a los demás jugadores y pueden chatear sin cuenta: alcanza con escribir el nombre en la pantalla de inicio (o en el chat, la primera vez que apretás `T`). Con cuenta, el nombre del chat sale del perfil guardado. Es opcional: en Opciones → «Otros jugadores» elegís «Jugar solo».

- **Chat:** tecla `T` o el ícono de globo arriba del menú. `Enter` envía, `Esc` cancela. Mensajes de hasta 120 caracteres; se ven en el registro (abajo a la izquierda) y en un globo sobre quien habla.
- **Salas:** hasta 12 jugadores por sala; si está llena, pasás a la siguiente. Los demás aparecen con su nombre, color de auto o aspecto, y como puntos verdes en el minimapa y el mapa.
- **Cómo funciona:** Supabase Realtime con dos canales privados por sala (`vallecito:pos:N` para posiciones y presencia, `vallecito:chat:N` solo de lectura). Los mensajes entran por la función `send_chat`, que valida todo en el servidor: límite de 1 mensaje cada 0,7 s y 5 cada 10 s (por cuenta o por invitado), 30 cada 10 s entre todos los invitados de una sala, y listas de silenciados. Con cuenta manda el nombre del perfil guardado; un invitado usa el que escribió, así que puede repetir el de otro.
- **Código:** `src/multiplayer/` (protocolo, red, jugadores remotos, orquestación) y `src/ui/Chat.ts`. Las migraciones son `202610160003_multiplayer_chat.sql`, `…0004_multiplayer_guests.sql` y `…0005_chat_invitados.sql` (ya aplicadas en el proyecto Vallecito); `npm run test:chat` la prueba sobre PostgreSQL embebido.
- **Silenciar a alguien:** `insert into public.chat_bans(user_id, reason) values ('<uuid>', 'motivo');` ; para un invitado: `insert into public.chat_guest_bans(sid, reason) values ('<sid>', 'motivo');` (los mensajes quedan en `public.chat_messages` con `user_id` o `guest`).
- **Límites conocidos:** los otros autos no chocan con el tuyo (son «fantasmas»), y los nombres sobre la cabeza los manda cada cliente, mientras que los del chat son verificados por el servidor. El plan gratuito de Supabase Realtime tiene tope de mensajes por segundo: 12 jugadores moviéndose entran, pero con mucho público conviene subir de plan o bajar `ROOM_CAP`.
- **Desarrollo:** `npm run dev` y abrí `/?auto=1&mpsim=4` para ver 4 jugadores simulados y probar el chat sin red.

## Cuentas, pasajeros y Serranos

Podés personalizar tu personaje, llevar gente que hace dedo a destinos del valle y compartir fotos desde el menú de pausa. Ganás 50 Serranos por postal, 200 por completar un pueblo, 20–60 por traslado y 10 por la primera foto compartida del día. La moneda tiene una montaña; la tienda queda para más adelante. Mate y cerveza todavía no se implementan.

Configuración de Supabase, Analytics, migración y pruebas: [cuentas y Serranos](docs/cuentas-y-serranos.md). Analytics queda preparado sin ID hasta configurar GA4.

## Qué hay en esta versión

- **Terreno real** de ~8,5 × 13,3 km (relieve de 10 m) + sierras lejanas (Sierras Grandes y Chicas, Champaquí incluido) como fondo.
- **Red vial real de OpenStreetMap** (RP 5, E‑83, S‑271, S‑430, S‑210 y todas las calles), con su superficie: asfalto, adoquín, compactado, ripio y tierra. El auto agarra distinto en cada una.
- **Ríos y arroyos** (Río Los Reartes, Río del Medio, El Sauce, La Toma…) con cauces tallados y **puentes** con barandas.
- **Casas por estilo de pueblo**: alpinas con entramado en VGB, criollas encaladas en Los Reartes, cabañas serranas en Villa Ciudad Parque (huellas reales de OSM + casas procedurales a lo largo de las calles).
- **Hitos**: portal de entrada "Capital Nacional de la Cerveza", Torre del Reloj, capillas, Castillo Romano, Barril Cervecero.
- **~250.000 árboles** (pinares, sauces en las orillas, espinillos), instanciados con dos niveles de detalle.
- **Auto** con física de vehículo (Rapier), **personaje a pie** y **avioneta** con despegue desde el Aeroclub de Villa General Belgrano.
- **26 postales** para descubrir (puntos de interés reales), minimapa y mapa grande.
- Sonido de motor sintetizado (sin archivos de audio).

## Arquitectura

TypeScript + **Three.js** (render) + **Rapier** (física, WASM) + **Vite**. Ver `PLAN.md` para el plan completo.

```
src/
  core/       Game (orquesta todo), GameLoop (física a 60 Hz fija), EventBus, Config (calidad, paleta)
  engine/     Renderer, Physics (heightfield + edificios + puentes + troncos cercanos), Input (teclado/gamepad)
  render/     PaintedMaterial (toon + pinceladas en espacio de mundo), Textures (todas procedurales en canvas)
  world/      WorldData (carga y consultas), Terrain (chunks con LOD), Roads, Buildings, Vegetation, Sky
  player/     PlayerController (a pie ↔ manejando), Vehicle, Character, CameraRig, VehicleAudio
  gameplay/   POI (postales), SaveSystem
  ui/         HUD, Minimap/Mapa, estilos
tools/
  fetch-data.mjs     baja OSM + relieve a tools/raw/   (npm run data)
  build-world.mjs    genera public/world/               (npm run world)
  preview-map.mjs    vista superior para validar        (npm run preview-map → docs/preview-mundo.png)
  test-physics.mjs   chequea que la física coincida con el relieve
```

Coordenadas: el pipeline usa `x` = Este y `n` = Norte en metros, con origen en el centro de Villa General Belgrano (−31.9765, −64.5590). En Three.js, `X = x`, `Z = −n`.

## Regenerar el mundo

```bash
npm run data     # descarga OSM y relieve (necesita internet)
npm run world    # procesa y escribe public/world/
npm run preview-map
```

Correcciones a mano (por ejemplo, la ubicación exacta del portal o POIs que no están en OSM) van en `tools/overrides/world.json`:

```json
{
  "portal": { "x": 1554, "n": 658, "y": 0, "heading": 3.1, "width": 8.5 },
  "pois": [{ "id": "manual-1", "name": "Mirador X", "kind": "viewpoint", "x": 100, "n": 200, "town": "vgb" }]
}
```

## Créditos de datos

- Mapa: © colaboradores de OpenStreetMap (licencia ODbL).
- Relieve: Terrarium elevation tiles (Mapzen / AWS Open Data; SRTM, GMTED y otros).
