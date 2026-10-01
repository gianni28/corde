# Corde

Juego de ritmo multijugador en el navegador, inspirado en Guitar Hero. Se toca con el teclado en PC (5 cuerdas) o con los dedos en el celular (4 cuerdas), con canciones en formato Clone Hero.

**Stack:** Vite · Three.js (escena 3D, bloom) · fuentes autoalojadas (@fontsource) · Web Audio API · Supabase (Postgres, Storage, Realtime) · Netlify

## Qué hace

- **Look rock de los 2000:** escenario de bar en 3D (pared de ladrillo, muros de amplis, batería en tarima, truss con luces PAR cálidas, humo y pirotecnia en cada sección), mástil de palisandro con botones cromados y fuego al acertar. Menús de acero rayado con remaches y logo cromado.
- **Sonido de fallo** sintetizado (rasgueo desafinado y distorsionado con Karplus-Strong) y la pista de guitarra se silencia mientras fallas.
- **Rachas:** aviso cada 50 notas seguidas y pirotecnia cada 100.
- **Se adapta al dispositivo:** 5 cuerdas en PC, 4 en celular. Las notas naranjas se pliegan a la cuerda de al lado (`notesFor` en `src/chart.js`).
- **Teclas configurables** en Ajustes (por defecto `D F J K L`, también `1`–`5`).
- **Biblioteca en línea:** canciones guardadas en Supabase Storage, catálogo en Postgres.
- **Multijugador en tiempo real:** salas con código de 4 letras sobre Supabase Realtime (presence + broadcast). El anfitrión elige canción y dificultad, todos descargan, y el marcador de los rivales se ve en vivo. Si alguien juega desde el celular, la sala entera toca con 4 cuerdas para que sea justo.
- **Canciones locales:** también puedes cargar una carpeta de Clone Hero (`notes.mid` o `notes.chart`) sin subir nada.
- Sincronía calibrable, la guitarra se silencia cuando fallas, multiplicador ×4, secciones de la canción, resultados con estrellas.

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
```

## Puesta en marcha

1. **Supabase:** crea un proyecto en supabase.com. En *SQL Editor* pega y ejecuta `supabase/schema.sql`.
2. **Variables:** copia `.env.example` como `.env` y pon la URL, la clave `anon` y la `service_role` (*Project Settings → API*).
3. **Instalar y correr:**
   ```bash
   npm install
   npm run dev
   ```
4. **Subir canciones** (convierte con ffmpeg, no hace falta instalarlo):
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

Star power, editor de niveles para la comunidad, notas abiertas y HOPOs, cuentas de usuario y tabla de récords.
