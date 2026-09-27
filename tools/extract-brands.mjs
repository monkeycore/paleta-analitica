#!/usr/bin/env node
// Ejecuta el extractor de la web (js/extract-url.js) sobre las marcas de
// data/brands.json y actualiza sus colores. En Node no hay CORS, así que
// descarga las páginas directamente, sin pasar por el Worker.
//
// Uso:
//   node tools/extract-brands.mjs                 # solo muestra resultados
//   node tools/extract-brands.mjs --write         # guarda en data/brands.json
//   node tools/extract-brands.mjs --only kfc,bbva # solo esas marcas
//
// Las marcas con "status": "verificado" nunca cambian de colores; solo se
// actualiza su bloque "extracted" como referencia. Las demás reciben los
// colores detectados y siguen como "pendiente" hasta que alguien los revise.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractColorsFromUrl } from '../js/extract-url.js';
import { PALETTE_CONFIG } from '../js/config.js';

const FILE = fileURLToPath(new URL('../data/brands.json', import.meta.url));
const MAX_BYTES = 3 * 1024 * 1024;

const args = process.argv.slice(2);
const write = args.includes('--write');
const onlyArg = args[args.indexOf('--only') + 1];
const only = args.includes('--only') && onlyArg ? new Set(onlyArg.split(',')) : null;

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,text/css,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new Error('Respuesta demasiado grande');
  return { status: res.status, text: new TextDecoder().decode(buf), finalUrl: res.url || url };
}

const today = new Date().toISOString().slice(0, 10);
const data = JSON.parse(await readFile(FILE, 'utf8'));
const rows = [];

for (const brand of data.brands) {
  if (only && !only.has(brand.id)) continue;
  if (!brand.url) { rows.push([brand.name, '—', 'sin URL']); continue; }
  process.stdout.write(`${brand.name}… `);
  try {
    const result = await extractColorsFromUrl(brand.url, { fetchText });
    brand.extracted = {
      date: today,
      url: result.url,
      stylesheets: `${result.stats.stylesheetsLoaded}/${result.stats.stylesheetsFound}`,
      colors: result.colors.slice(0, 8).map(({ hex, score, sources }) => ({ hex, score, sources })),
    };
    const picked = result.colors.slice(0, PALETTE_CONFIG.maxBrandColors).map((c) => c.hex);
    if (brand.status !== 'verificado') {
      const previous = brand.colors.filter((h) => !picked.includes(h));
      brand.alternatives = [...new Set([...(brand.alternatives || []), ...previous])].filter((h) => !picked.includes(h));
      brand.colors = picked;
      brand.status = 'pendiente';
      brand.source = { type: 'extractor', refs: [result.url], date: today };
    }
    rows.push([brand.name, picked.join(' '), brand.status === 'verificado' ? 'verificado (sin cambios)' : 'ok']);
    console.log(picked.join(' '));
  } catch (err) {
    brand.extracted = { date: today, error: `${err.code || 'error'}: ${err.message}` };
    rows.push([brand.name, '—', `${err.code || 'error'}: ${err.message}`]);
    console.log(`falla (${err.code || err.message})`);
  }
}

console.log();
console.table(rows.map(([marca, colores, estado]) => ({ marca, colores, estado })));

if (write) {
  await writeFile(FILE, JSON.stringify(data, null, 2) + '\n');
  console.log(`Guardado en ${FILE}. Revisa los colores y marca "status": "verificado" en los que estén bien.`);
} else {
  console.log('Modo prueba: no se ha guardado nada. Añade --write para actualizar data/brands.json.');
}
