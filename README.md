# Corde

Juego de ritmo multijugador en el navegador, inspirado en Guitar Hero. Se toca con el teclado en PC (5 cuerdas) o con los dedos en el celular (4 cuerdas), con canciones en formato Clone Hero.

**Stack:** Vite · Three.js (escena 3D, bloom) · fuentes autoalojadas (@fontsource) · Web Audio API · Supabase (Postgres, Storage, Realtime) · Netlify

## Qué hace

- **Look rock de los 2000:** escenario de bar en 3D (pared de ladrillo, muros de amplis, batería en tarima, truss con luces PAR cálidas, humo y pirotecnia en cada sección), mástil de palisandro con botones cromados y fuego al acertar. Menús de acero rayado con remaches y logo cromado.
- **Sonido de fallo** sintetizado (rasgueo desafinado y distorsionado con Karplus-Strong) y la pista de guitarra se silencia mientras fallas.
- **Rachas:** aviso cada 50 notas seguidas y pirotecnia cada 100.
- **Se adapta al dispositivo:** 5 cuerdas en PC, 4 en celular. Las notas naranjas se pliegan a la cuerda de al lado (`notesFor` en `src/chart.js`).
- **Teclas configurables** en Ajustes (por defecto `A S D F G`, también `1`–`5`).
- **Biblioteca en línea:** canciones guardadas en Supabase Storage, catálogo en Postgres.
- **Multijugador en tiempo real:** salas con código de 4 letras sobre Supabase Realtime (presence + broadcast). El anfitrión elige canción y dificultad, todos descargan, y el marcador de los rivales se ve en vivo. Si alguien juega desde el celular, la sala entera toca con 4 cuerdas para que sea justo. Botón **Invitar** (compartir o WhatsApp) con un enlace `#sala-ABCD` que abre el juego directo en la sala.
- **Dos jugadores en un mismo PC:** pantalla dividida con dos mástiles (cada uno con su cámara, sobre el mismo escenario), cada jugador con su dificultad, su poder estrella y su marcador, y al final quién ganó. Teclas por defecto `A S D F G` + Espacio y `H J K L Ñ` + Enter (poder estrella), configurables (se guardan por posición física, así sirven en teclados en español o en inglés).
- **Canción del día:** la misma canción para todos cada día (calendario de Colombia), elegida por el servidor entre las canciones con chart sin repetir las de los últimos 30 días. Clasificación del día por dificultad y cuerdas (como las demás), cuenta regresiva para la siguiente y racha de días seguidos (en el navegador). Tablas `daily` y `daily_scores` con las funciones `daily_today()` y `submit_daily()` (`supabase/daily.sql`), con las mismas validaciones anti-trampa que `submit-score`.
- **Modo Gira:** seis escenarios, del garaje al estadio, cada uno con su look en 3D (`R.setStage`). Una gira por dificultad, armada con la biblioteca: canciones ordenadas por notas por segundo y repartidas de fácil a difícil (`src/tour.js`). Cada escenario tiene 4 canciones y un bis: supera 3 y el público pide otra; supera el bis y se abre el siguiente escenario. Las estrellas son tus récords personales en esa dificultad.
- **Récords personales:** tu mejor resultado de cada canción y dificultad (en este navegador), con estrellas en la lista de canciones y en los botones de dificultad.
- **Se instala como app:** manifest con íconos; en Android/PC aparece «Instalar como app» y abre en pantalla completa.
- **Niveles automáticos desde un MP3:** para canciones que no tienen chart, el panel de subida acepta un MP3 y genera las 4 dificultades: detección de golpes (spectral flux), tempo por autocorrelación, seguimiento del pulso con programación dinámica (Ellis 2007), selección de notas por densidad y carriles que siguen el contorno melódico (`src/autochart.js`). Contra el chart hecho a mano de *Kryptonite*, el 82–86 % de las notas generadas en Fácil, Media y Difícil caen donde el humano puso una.
- **Canciones locales:** también puedes cargar una carpeta de Clone Hero (`notes.mid` o `notes.chart`) sin subir nada.
- **Puntaje:** cada nota vale según la dificultad (Fácil 25, Media 30, Difícil 40, Experto 50), por el multiplicador. El multiplicador sube un paso (×1 → ×4) cada 10 aciertos seguidos, y un fallo lo baja **un** paso, no a ×1. El poder estrella lo duplica. Así, tocar en una dificultad más alta paga aunque aciertes un poco menos: en simulaciones con las canciones de la biblioteca, Difícil al 85 % le gana a Media al 95 %, y Experto al 70 % también.
- Sincronía calibrable (con metrónomo), la guitarra se silencia cuando fallas, secciones de la canción, resultados con estrellas.

## Estructura

```
src/
  chart.js      lee notes.mid / notes.chart → formato propio (chart.json v1), pliegue 5→4
  game.js       lógica: ventanas de acierto, notas largas, puntaje (sin DOM)
  audio.js      Web Audio: stems sincronizados, latencia de salida, mute de guitarra
  renderer.js   escena Three.js
  net.js        Supabase: biblioteca y salas
  settings.js   ajustes por jugador (localStorage)
  main.js       menús, HUD, input, flujo multijugador
scripts/upload-songs.mjs   convierte y sube canciones
supabase/schema.sql        tabla + bucket
supabase/functions/admin-upload   Edge Function que firma subidas (protegida con código)
src/admin.js               conversión de canciones en el navegador (carpetas de Clone Hero o MP3 con etiquetas ID3)
src/autochart.js           generador automático de niveles
src/tour.js                modo Gira: escenarios, setlists por dificultad y progreso
```

## Puesta en marcha

1. **Supabase:** crea un proyecto en supabase.com. En *SQL Editor* pega y ejecuta `supabase/schema.sql`.
2. **Variables:** copia `.env.example` como `.env` y pon la URL, la clave `anon` y la `service_role` (*Project Settings → API*).
3. **Instalar y correr:**
   ```bash
   npm install
   npm run dev
   ```
4. **Subir canciones desde el navegador:** en Ajustes → *Subir canciones a la biblioteca* (o abre la página con `#admin`), escribe el código de administrador y elige una carpeta de canciones de Clone Hero. El navegador convierte cada canción (mezcla de pistas y MP3 con lamejs) y la sube a través de la Edge Function `admin-upload`, que firma las subidas con la service role sin exponerla.

   Si una carpeta trae solo Experto, el juego arma Fácil, Media y Difícil a partir de él (`src/reduce.js`). Si la canción ya estaba subida desde un MP3 (niveles automáticos), la versión con chart la reemplaza y borra la del MP3; esas canciones también se pueden borrar a mano desde el mismo panel. Un MP3 nunca reemplaza una canción que ya tiene chart.

   **O con el script** (convierte con ffmpeg, no hace falta instalarlo):
   ```bash
   npm run upload-songs -- "C:\Users\TU_USUARIO\Documents\Clone Hero\Songs"
   ```
   Recorre la carpeta y sus subcarpetas. Cada canción necesita `song.ini` + `notes.mid` o `notes.chart` + sus audios. Con `--dry` solo convierte (deja el resultado en `out/`), con `--force` reemplaza las que ya estaban.
5. **Netlify:** conecta el repo de GitHub. Build `npm run build`, carpeta `dist` (ya está en `netlify.toml`). En *Site configuration → Environment variables* agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. **La `service_role` nunca va en Netlify.**

## Formato chart.json (v1)

```json
{ "v": 1,
  "meta": { "name": "…", "artist": "…" },
  "sections": [[4.829, "Intro"]],
  "beats": [[0.0, 1], [0.52, 0]],
  "diffs": { "medium": { "lanes": [0,1,2,3], "notes": [[4.829, 1, 1.492]] } } }
```
Tiempos en segundos. Cada nota es `[tiempo, cuerda, duración]`; duración 0 = nota normal. Es el formato que generaría un futuro editor de niveles de la comunidad.

## Pendiente

Controles y guitarras USB (Gamepad API), editor de niveles para la comunidad, notas abiertas y HOPOs, cuentas de usuario.
