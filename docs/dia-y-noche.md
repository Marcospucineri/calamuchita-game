# Día, noche e iluminación del valle

El juego usa la fecha y hora reales del dispositivo como instante UTC. La hora local del valle es GMT−3, independientemente de la zona horaria elegida en el dispositivo. El sol se calcula con las coordenadas del mapa (latitud −31.9765, longitud −64.559) y las [ecuaciones solares aproximadas de NOAA](https://gml.noaa.gov/grad/solcalc/solareqns.PDF).

La posición cambia con la hora y la época del año: sale hacia el este, pasa por el cielo norte y se oculta hacia el oeste. Amanecer y atardecer no usan un horario fijo. El cielo, las nubes, la niebla y la luz ambiente pasan gradualmente por tonos cálidos antes de la noche. La noche conserva luz ambiental tenue para permitir recorrer rutas sin luminarias. La luna y las estrellas son decorativas; no se simulan fases lunares.

## Calles iluminadas

- VGB: San Martín, Julio Argentino Roca, Las Magnolias, Ojo de Agua, Comechingones y Champaquí, dentro del área del pueblo.
- Villa Ciudad Parque: solo Boulevard Los Reartes, dentro del pueblo.
- Los Reartes: solo Avenida San Martín, dentro del pueblo.

Las cuadras se obtienen de los tramos e intersecciones del mapa. Hay dos posiciones por cuadra (un cuarto y tres cuartos), con una luminaria en cada lado de cada posición. Los postes están fuera de la calzada; se evitan puentes y duplicados. El catálogo actual genera 368 luminarias en VGB, 100 en Ciudad Parque y 64 en Los Reartes.

Los faroles se apagan de día y se encienden gradualmente durante el crepúsculo. Las luces cercanas iluminan calzada, veredas, vegetación y fachadas. Las ventanas de casas y vidrieras tienen máscaras de emisión cálida que se activan con la noche, sin iluminar artificialmente toda la pared. Los faroles existentes de las plazas también se encienden de noche.

Las piezas nuevas usan cuatro mallas instanciadas para todos los postes. Las luces sobre superficies usan un grupo fijo de cuatro luces de punto en calidad baja y ocho en media/alta, sin sombras adicionales. Se actualizan las luces cercanas a la cámara cuatro veces por segundo. Así no se agregan cientos de luces dinámicas al render de mobile.

## Comprobación

`npm run test:lighting` verifica GMT−3, este/oeste, altura solar y estaciones, transición suave del atardecer, cantidad por cuadra y lado, restricciones por pueblo, luces encendidas de noche/apagadas de día y máscaras de emisión conectadas al reloj.

En desarrollo se puede usar `?auto=1&touch=1&hora=23` para revisar la noche o `hora=19.3` para ver las 19:18 del día actual. Esta sustitución de hora no está habilitada en producción. La iluminación sigue avanzando con el reloj real incluso con el juego pausado.
