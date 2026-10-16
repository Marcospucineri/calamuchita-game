# Cuentas y Serranos · primera implementación

El paseo sigue siendo gratis y se puede iniciar sin registrarse. El botón del personaje en el inicio y el contador de Serranos durante el juego abren el perfil. Hay nombre visible, tres tonos de piel, tres remeras, tres colores de pelo, rapado, corto, rodete, rulos largos, casi a los hombros, largo lacio y barba opcional, con vista previa 3D. Los ojos y las cejas siempre son negros, independientemente del color de pelo. Estos estilos son gratuitos. La tienda y el resto de los cosméticos quedan para otra tanda.

## Qué se guarda

Sin cuenta se mantiene `calamuchita.save.v1`, compatible con las partidas anteriores. Con cuenta, cada usuario tiene una caché local separada y el progreso se sincroniza con Supabase cada cinco segundos y después de una recompensa o un cambio de perfil. Las postales se fusionan entre dispositivos. Nombre, apariencia, color del auto, posición, vehículo y pasajero en curso también se guardan. La avioneta sigue saliendo desde el aeroclub.

Al crear la cuenta se importan las postales y las recompensas del paseo como visitante. El historial de viajes del visitante se importa una vez; para nuevos viajes con cuenta hay que poder registrar el inicio en Supabase. Si se pierde la conexión durante un viaje ya registrado, el cierre se sincroniza al volver. Un cambio de cuenta en otra pestaña recarga el juego para mantener separados los guardados.

## Economía

| Acción | Serranos | Límite |
| --- | ---: | --- |
| Postal nueva | 50 | Una por lugar |
| Todas las postales de un pueblo | 200 | Una por pueblo |
| Llevar a alguien que hace dedo | 20–60 | Un pasajero a la vez |
| Compartir una foto del paseo | 10 | Una por día de Córdoba |

Los traslados pagan 20 más 10 por cada kilómetro completo de distancia directa entre origen y destino, hasta 60. Hay nueve recorridos con destinos reales y puntos de recogida y llegada junto a calles transitables. Frená al lado del personaje, tocá «Acercarle», seguí el destino y frená al llegar. El mapa marca dónde dejarle. Viajar rápido o cambiar a avioneta cancela el traslado. El recorrido y una duración mínima se controlan en el juego; Supabase además registra el inicio, valida el tiempo y paga cada ID de viaje una sola vez.

«Foto del paseo» en el menú de pausa genera una postal con el paisaje actual, marco crema, logo, nombre del pueblo y vallecito.ar. Usa compartir del teléfono cuando está disponible; en escritorio descarga la imagen y trata de copiar el texto. La descarga cuenta como compartir, según el flujo propuesto en el plan. Cancelar el menú nativo no paga. No incluye todavía cámara libre ni filtros.

Mate y cerveza quedan fuera de esta tanda. Los Serranos no compran ventajas ni se venden. El control actual de recompensas sirve para una economía cosmética: no constituye una simulación de movimiento autoritativa ni prueba que una foto haya sido publicada en una red social.

## Supabase

Variables aceptadas en `.env` y en el entorno de build de Railway:

```dotenv
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=TU-CLAVE-PUBLICA
SUPABASE_SECRET_KEY=
VITE_GA_MEASUREMENT_ID=
```

La clave secreta es opcional para herramientas administrativas locales; Vite solo incorpora la URL y la clave pública. También se aceptan `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Reiniciá Vite o reconstruí después de cambiar variables.

El esquema está en `supabase/migrations/202610160001_progress.sql`. Ya se aplicó al proyecto Vallecito el 16/10/2026 desde el SQL Editor, dentro de una transacción. En un proyecto nuevo, ejecutá ese archivo una vez. Tablas: `player_progress`, `serrano_ledger`, `active_hitchhikes` y catálogos de lugares/recorridos. Todas tienen RLS. El cliente solo puede leer su progreso y su historial; `sync_progress` calcula importes y evita duplicados, y `start_hitchhike` registra el comienzo. El saldo nunca se recibe del navegador.

Se configuró Site URL en `https://vallecito.ar` y las redirecciones exactas `https://vallecito.ar/`, `http://localhost:5173/` y `http://127.0.0.1:5173/`. Para usar otro puerto o dominio hay que agregarlo. La confirmación del email y la recuperación usan esos destinos. Para enviar correos al público falta configurar SMTP propio; el servicio de pruebas de Supabase tiene restricciones de destinatarios. Ver [SMTP de Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

Email/contraseña está habilitado. Google ya está configurado y habilitado en Supabase, con el cliente web «Vallecito web · Supabase» del proyecto Google Cloud `vallecito-511819`. Se comprobó el ingreso real y el guardado de progreso con Google. El secreto del cliente está guardado en Supabase y no se incorpora al juego. Google quedó en estado «En producción» el 16/10/2026, después de desplegar `public/privacidad.html`, para permitir el ingreso de jugadores fuera de la lista de prueba. La página de privacidad configurada es `https://vallecito.ar/privacidad.html`.

`node tools/build-hitchhikes.mjs` regenera las rutas y el catálogo inicial. Después de aplicar esta primera migración, los cambios de catálogo deben llevar una migración SQL nueva.

## Analytics

Por pedido de Marcos, `VITE_GA_MEASUREMENT_ID` queda vacío como placeholder. No carga scripts ni envía eventos hasta configurar un ID real de GA4. Eventos preparados: `game_start`, `postal_found`, `fast_travel`, `activity_complete`, `share`, `sign_up`, `login`, `earn_virtual_currency` y `play_time` por minuto activo. Se omiten el tiempo en menús y los datos del perfil. No se envían email, nombre, tokens de sesión ni coordenadas exactas. La URL enviada no tiene parámetros ni hash; se respeta Do Not Track. Hay un aviso de privacidad en Créditos.

## Interfaz y audio

Inicio y HUD usan paneles oscuros, texto crema e iconos de línea. Las opciones secundarias se encuentran en el menú de pausa; el perfil muestra primero la invitación a crear una cuenta. La vista interior oculta los vidrios exteriores pintados para dejar libre la visión.

La música usa únicamente `Vallecito.mp3` y `Camino de Verano.mp3`, con volumen reducido. El motor también tiene un volumen menor. Ambos contextos de audio se suspenden al ocultar la pestaña y se reanudan al volver, respetando las restricciones de reproducción del navegador.

## Verificación

- `npm run build`: tipos y bundle de producción.
- `npm run test:progress`: recompensas y perfiles, migración real sobre PostgreSQL embebido, RLS, fotos diarias y simulación de recogida/entrega, reanudación y teletransporte.
- `npm run test:avatar`: seis peinados, persistencia y ojos/cejas negros con todos los colores de pelo.
- `npm run test:vehicle`: visibilidad de los vidrios al entrar y salir de primera persona.
- `npm run test:audio`: suspensión y reanudación de música/motor al cambiar de pestaña.
- `node tools/check-supabase.mjs`: prueba opcional contra el proyecto configurado. Requiere la clave secreta local. Crea una cuenta temporal confirmada, prueba login, guardado, lectura, recompensas y permisos, y elimina esa cuenta. No manda emails ni imprime credenciales.

Se verificó la API real de Vallecito y la interfaz en el navegador. El ingreso con Google se probó de punta a punta. La confirmación y recuperación por email para el público siguen pendientes de SMTP propio.


## Ajustes mobile · 16/10/2026

El destino del pasajero aparece en el minimapa: flecha dorada en el borde si queda fuera del área visible, bandera al acercarse y distancia restante. Es una indicación de dirección directa, no navegación por calles. Se quitó el cartel permanente del traslado. El menú permite ver el destino en el mapa grande y cancelar el viaje.

Los avisos comparten un único espacio arriba a la izquierda y sustituyen temporalmente ubicación y saldo. El aviso más reciente reemplaza al anterior sin cola; una recompensa simultánea por postal se incorpora a la tarjeta de esa postal, conservando el acceso al álbum. «Tu personaje» tiene más jerarquía que Auto/Avioneta en mobile.

Railway tenía únicamente las variables de notas. Se agregaron `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` al servicio `calamuchita-game` y se reconstruyó el despliegue existente. No se cargó la clave secreta. Estas variables deben conservarse en los próximos builds. Se probó el ingreso con Google desde `https://vallecito.ar/`, el retorno al juego y el estado «Progreso guardado en tu cuenta», recuperando las postales y el saldo. Google Auth Platform quedó en producción para usuarios externos.

`npm run test:mobile` comprueba dirección y límites del indicador del minimapa, reemplazo de avisos y cancelación de temporizadores anteriores.
