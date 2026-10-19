# Corde — reglas para premios y cosméticos

Cuando hagas premios, skins o cualquier cosa visual (notas, llamas, público, mástiles, cuerdas, poder estrella, nombres, rachas):

1. **Primero revisa lo que ya existe** en `src/skins.js` y `src/shop.js`. Lo nuevo no se puede parecer a nada de lo que ya hay.
2. **Que se distinga por la forma, no solo por el color.** Si se llama caramelo, tiene forma de caramelo. Si son luciérnagas, vuelan. Si son celulares, parecen celulares. Un cambio de color solo vale para los ítems baratos.
3. **Que se mueva con la música** cuando se pueda: al ritmo, en cada golpe, más fuerte en las partes intensas.
4. **Premios de logros, gira y racha: más especiales que lo que se compra.** Estilo rockero y serio, nada infantil.
5. **Pruébalo con capturas de Playwright** en la vista previa de la tienda y compáralo lado a lado con lo que ya existe. Si dos se parecen, rediseña antes de publicar.
6. **La tarjeta de la tienda también tiene que mostrar la forma** del premio.
7. **Que no tape el juego:** nada encima del mástil ni de las notas, y que corra bien en celular.

## Dónde está cada cosa

- Catálogo de la tienda (nombre, precio, descripción, premio): `src/shop.js`. Los precios y premios que valen son los de la tabla `shop_items` en Supabase; un ítem nuevo necesita su fila ahí (con su `.sql` en `supabase/`).
- Cómo se ve cada skin: `src/skins.js` (`NECKS`, `GEMS`, `FLAMES`, `STRINGS`, `STARS`, `CROWDS`).
- Formas de las notas (`gemShape`) y de las llamas (`FLAME_FORMS`, `flameFrames`): `src/renderer.js`.
- El público (lo que sostiene, luciérnagas, gatos, estroboscopio): `src/stagecrew.js`, `createCrowd`.
- Tarjetas de la tienda: `fillSwatch` en `src/main.js` y las clases `.sw-*`, `.g-*`, `.fa-*`, `.cw-*` en `src/style.css`.
- Vista previa para capturas: `openShopAt(cat, id)` y `selectShopItem(id)` en `src/main.js` muestran el ítem en el escenario detrás de la tienda.
