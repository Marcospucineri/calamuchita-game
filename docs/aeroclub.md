# Aeroclub de Villa General Belgrano

La salida de la avioneta usa la pista real del aeroclub, al noroeste del centro de Villa General Belgrano. El punto de aparición está a 42 metros del extremo sur, orientado hacia el norte-noroeste y dentro de la pista.

Fuentes consultadas el 12 de octubre de 2026:

- [ANAC / Ministerio de Transporte: datos de aeródromos](https://servicios.transporte.gob.ar/gobierno_abierto/detalle.php?d=detalle&t=aeropuertos). Registro `VGB`, Villa General Belgrano, ARP `31°57′52″S 64°33′52″W`. El catálogo indica actualización en septiembre de 2021; se utiliza para contrastar la ubicación, no como información operacional vigente.
- [OpenStreetMap: pista 310390493](https://www.openstreetmap.org/way/310390493). Geometría obtenida desde la API de OpenStreetMap: extremos `(-31.9679322, -64.5636354)` y `(-31.9614105, -64.5654472)`, referencia `16/34`, superficie `grass`. La longitud de unos 743 metros y la orientación del juego se calculan a partir de esa geometría usando la proyección local existente.
- [OpenStreetMap: aeroclub 1267946070](https://www.openstreetmap.org/way/1267946070). Confirma el nombre y el predio que contiene la pista. Datos © colaboradores de OpenStreetMap, ODbL.

La representación es recreativa: ancho de 30 metros, marcas, manga y hangar simplificados para que el lugar resulte reconocible. No pretende reproducir instalaciones, señalización ni procedimientos aeronáuticos con precisión. El relieve sigue el mismo DEM que el resto del juego; no se aplica la elevación publicada al modelo ni se introduce una plataforma flotante.

`prepareAirfield(world)` se ejecuta antes de crear terreno, vegetación, edificios y colisiones. Elimina los árboles y edificios del corredor y de la pequeña plataforma lateral, y pinta el césped. No cambia alturas ni archivos de datos generados. `getAirfield(world)` es la única fuente de coordenadas para aparición y reinicio de la avioneta. La dirección sigue la convención del mundo: `cos(heading)` hacia el este y `sin(heading)` hacia el norte.
