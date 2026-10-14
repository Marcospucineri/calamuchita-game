# Modo debug y anotaciones del mapa

Abrí el juego con `?debug` en la URL (por ejemplo `http://localhost:5173/?debug` o `https://tu-app.up.railway.app/?debug`).
El módulo se descarga aparte: el juego normal no lo carga.

## Controles

| Tecla | Acción |
|---|---|
| `G` | Modo dios: cámara libre, el juego queda congelado |
| `W A S D` / flechas | Moverse (en modo dios) |
| `E` / `Espacio` · `Q` | Subir · bajar |
| `Shift` | Ir 4 veces más rápido |
| Rueda | Cambiar la velocidad |
| Arrastrar | Mirar alrededor |
| `1` | Herramienta **Punto**: clic en el mundo o en el mapa |
| `2` | Herramienta **Polígono**: clic por vértice · `Enter` o clic en el primero termina · `Borrar` deshace · `Esc` cancela |
| `M` | Mapa: con una herramienta, marca; en modo dios sin herramienta, lleva la cámara a ese punto |
| `L` | Lista de notas: ir, ver en el mapa, editar, marcar procesada, borrar |
| `V` | Mostrar u ocultar las notas en el mundo y en el mapa |

Al guardar se elige una categoría (Plaza, Edificio, Calle / ruta, Vegetación, Agua / río, Hito, Error, Otro) y se escribe la observación, por ejemplo "acá va una plaza".

## Dónde se guardan

- Con `MONGODB_URI` en `.env`: MongoDB Atlas, base `calamuchita`, colección `notes`.
- Sin `MONGODB_URI`: `notes/anotaciones.json`.
- En Railway la API (`/api/notes`) solo funciona con `DEBUG_TOKEN` configurado. El modo debug pide el token una vez y lo recuerda en el navegador.
- Sin API (por ejemplo, un hosting estático), las notas quedan en el navegador. Con **Exportar** se bajan en JSON.

## Circuito para procesar las notas

1. `npm run notes`: sube las marcas pendientes y baja todas las notas a `notes/anotaciones.json`. También se ejecuta solo al arrancar `npm run dev` si hay `MONGODB_URI`.
2. `npm run notes -- list`: muestra las notas abiertas. Con `--all` muestra también las procesadas.
3. Después de aplicar una corrección en el juego: `npm run notes -- done <id> "qué se hizo"`. La marca queda en `notes/procesadas.json` y se sube a la base en el próximo `npm run notes`.
4. `npm run notes -- reopen <id>` la vuelve a dejar abierta. También se puede reabrir desde la lista del juego.

Las notas con estado `procesada` no se vuelven a trabajar. Las que están en `notes/procesadas.json` cuentan como procesadas aunque todavía no se hayan subido.

## Formato de cada nota

```json
{
  "id": "…",
  "kind": "point | polygon",
  "points": [[x, n, y], …],
  "lonlat": [[lon, lat], …],
  "geometry": { "type": "Point | Polygon", "coordinates": … },
  "category": "plaza | edificio | calle | vegetacion | agua | hito | error | otro",
  "text": "acá va una plaza",
  "town": "Villa General Belgrano",
  "camera": { "x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0 },
  "status": "abierta | procesada",
  "resolution": "qué se hizo (al procesarla)",
  "createdAt": "ISO", "updatedAt": "ISO", "processedAt": "ISO | null"
}
```

Los valores de `points` son metros en coordenadas del juego: `x` = Este, `n` = Norte, origen en el centro de VGB (−31.9765, −64.5590). Es el mismo sistema de `tools/build-world.mjs` y de `public/world/*`. En Three.js, `X = x` y `Z = −n`.
