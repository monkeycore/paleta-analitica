// Extracción de colores desde una web. El análisis se hace con expresiones
// regulares sobre el texto (sin DOM) para poder reutilizarlo en Node desde
// tools/extract-brands.mjs. La descarga se inyecta: en el navegador pasa por el
// Worker (CORS); en Node es un fetch directo.

import { CSS_COLOR_RE, parseCssColor, isNeutral, deltaE, hexToOklch } from './color.js';
import { WORKER_URL, EXTRACT_CONFIG } from './config.js';

export class ExtractError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code; // 'config' | 'invalid-url' | 'blocked' | 'http' | 'network' | 'timeout' | 'too-large' | 'no-colors'
    this.detail = detail;
  }
}

// Pesos por origen del color.
const WEIGHTS = {
  themeColor: 12,
  brandVar: 6,   // --primary, --brand, --accent…
  colorVar: 2,   // --color-*, --clr-*…
  otherVar: 1.2,
  svg: 1.5,      // fill/stroke en SVG en línea (a menudo el logo)
  css: 1,
};

const BRAND_VAR_RE = /(primary|brand|main|accent|secondary|corporate|corporativo|theme|principal|highlight|key)/i;
const COLOR_VAR_RE = /(^--(color|colour|clr|c)-|color|colour)/i;

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new ExtractError('invalid-url', 'Escribe una URL.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new ExtractError('invalid-url', 'La URL no es válida.'); }
  if (!/^https?:$/.test(u.protocol)) throw new ExtractError('invalid-url', 'Solo se admiten URLs http o https.');
  return u.href;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};

const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Analiza el HTML y devuelve colores directos + hojas de estilo que descargar.
export function parseHtml(html, baseUrl) {
  const entries = [];
  const stylesheets = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');

  for (const tag of clean.match(/<meta\b[^>]*>/gi) || []) {
    const name = (attr(tag, 'name') || '').toLowerCase();
    if (name === 'theme-color' || name === 'msapplication-tilecolor') {
      const hex = parseCssColor(attr(tag, 'content') || '');
      if (hex) entries.push({ hex, weight: WEIGHTS.themeColor, source: 'theme-color' });
    }
  }

  for (const tag of clean.match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase().split(/\s+/);
    const as = (attr(tag, 'as') || '').toLowerCase();
    const isSheet = rel.includes('stylesheet') || (rel.includes('preload') && as === 'style');
    const media = (attr(tag, 'media') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (!isSheet || !href || media === 'print') continue;
    try {
      const abs = new URL(decodeEntities(href), baseUrl).href;
      if (!stylesheets.includes(abs)) stylesheets.push(abs);
    } catch { /* href inválido */ }
  }

  for (const m of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    entries.push(...analyzeCss(m[1], 'estilo en línea'));
  }

  for (const m of clean.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    entries.push(...analyzeCss(decodeEntities(m[2] ?? m[3]), 'atributo style'));
  }

  // fill / stroke / stop-color de SVG en línea.
  for (const m of clean.matchAll(/\s(?:fill|stroke|stop-color)\s*=\s*["']([^"']+)["']/gi)) {
    const hex = parseCssColor(m[1]);
    if (hex) entries.push({ hex, weight: WEIGHTS.svg, source: 'SVG en línea' });
  }

  return { entries, stylesheets };
}

// Colores de un texto CSS. Las variables personalizadas pesan según su nombre.
export function analyzeCss(css, source = 'hoja de estilo') {
  const entries = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rest = text.replace(/(--[\w-]+)\s*:\s*([^;{}]+)/g, (_, name, value) => {
    const weight = BRAND_VAR_RE.test(name) ? WEIGHTS.brandVar : COLOR_VAR_RE.test(name) ? WEIGHTS.colorVar : WEIGHTS.otherVar;
    for (const raw of value.match(CSS_COLOR_RE) || []) {
      const hex = parseCssColor(raw);
      if (hex) entries.push({ hex, weight, source: `variable ${name}` });
    }
    return '';
  });
  for (const raw of rest.match(CSS_COLOR_RE) || []) {
    const hex = parseCssColor(raw);
    if (hex) entries.push({ hex, weight: WEIGHTS.css, source });
  }
  return entries;
}

// Agrupa por color, descarta neutros, fusiona casi-duplicados y ordena por peso.
export function rankColors(entries, { max = 12 } = {}) {
  const map = new Map();
  for (const e of entries) {
    if (isNeutral(e.hex)) continue;
    const item = map.get(e.hex) || { hex: e.hex, score: 0, count: 0, sources: new Set() };
    item.score += e.weight;
    item.count++;
    item.sources.add(e.source);
    map.set(e.hex, item);
  }
  const sorted = [...map.values()].sort((a, b) => b.score - a.score);
  const merged = [];
  for (const item of sorted) {
    const near = merged.find((m) => deltaE(m.hex, item.hex) < 5);
    if (near) {
      near.score += item.score;
      near.count += item.count;
      item.sources.forEach((s) => near.sources.add(s));
    } else merged.push(item);
  }
  return merged
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((m) => ({ hex: m.hex, score: Math.round(m.score * 10) / 10, count: m.count, sources: [...m.sources].slice(0, 4), chroma: hexToOklch(m.hex)[1] }));
}

// Señales de páginas de desafío antibots / bloqueo (Cloudflare, Akamai, Imperva, DataDome, PerimeterX…).
const CHALLENGE_PATTERNS = [
  /<title>\s*(just a moment|un momento|attention required|access denied|acceso denegado|pardon our interruption|are you a robot|security check)/i,
  /cf-browser-verification|cf_chl_|challenges\.cloudflare\.com|cf-turnstile/i,
  /_Incapsula_Resource|incapsula incident/i,
  /captcha-delivery\.com|datadome/i,
  /px-captcha|perimeterx/i,
  /errors\.edgesuite\.net|Reference\s+#\d+\.[0-9a-f]+/i,
  /awswaf|aws-waf-token/i,
];

export function detectBlock(status, html) {
  if (status === 403 || status === 401 || status === 429 || status === 503) {
    return `La web ha respondido con el código ${status}.`;
  }
  if (html && html.length < 200000 && CHALLENGE_PATTERNS.some((re) => re.test(html))) {
    return 'La web ha devuelto una página de verificación antibots en lugar del contenido.';
  }
  return null;
}

// Descarga a través del Worker. Devuelve { status, text, finalUrl }.
export async function fetchViaWorker(url, { signal } = {}) {
  if (!WORKER_URL || /TU-SUBDOMINIO/.test(WORKER_URL)) {
    throw new ExtractError('config', 'Falta configurar la URL del Worker en js/config.js (WORKER_URL).');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXTRACT_CONFIG.requestTimeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort());
  let res;
  try {
    res = await fetch(`${WORKER_URL.replace(/\/$/, '')}/?url=${encodeURIComponent(url)}`, { signal: ctrl.signal });
  } catch (err) {
    if (ctrl.signal.aborted) throw new ExtractError('timeout', 'La descarga ha tardado demasiado.');
    throw new ExtractError('network', 'No se ha podido contactar con el Worker.', String(err));
  } finally {
    clearTimeout(timer);
  }
  const proxyError = res.headers.get('X-Proxy-Error');
  if (proxyError) {
    let message = proxyError;
    try { message = (await res.json()).error || message; } catch { /* cuerpo no JSON */ }
    const code = res.status === 413 ? 'too-large' : res.status === 504 ? 'timeout' : 'network';
    throw new ExtractError(code, message);
  }
  const status = Number(res.headers.get('X-Upstream-Status')) || res.status;
  return { status, text: await res.text(), finalUrl: res.headers.get('X-Final-Url') || url };
}

/**
 * Extrae los colores de una web.
 * @param {string} input URL escrita por el usuario
 * @param {{fetchText?: Function, onProgress?: Function}} opts
 */
export async function extractColorsFromUrl(input, { fetchText = fetchViaWorker, onProgress = () => {} } = {}) {
  const url = normalizeUrl(input);
  onProgress('Descargando la página…');
  const page = await fetchText(url);
  const blocked = detectBlock(page.status, page.text);
  if (blocked) throw new ExtractError('blocked', blocked, { status: page.status });
  if (page.status >= 400) throw new ExtractError('http', `La web ha respondido con el código ${page.status}.`);

  const { entries, stylesheets } = parseHtml(page.text, page.finalUrl || url);
  const sheets = stylesheets.slice(0, EXTRACT_CONFIG.maxStylesheets);
  let loaded = 0;
  const failed = [];
  onProgress(`Descargando ${sheets.length} hojas de estilo…`);
  const results = await Promise.allSettled(sheets.map((s) => fetchText(s)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.status < 400) {
      loaded++;
      entries.push(...analyzeCss(r.value.text, 'hoja de estilo'));
    } else failed.push(sheets[i]);
  });

  const colors = rankColors(entries);
  if (!colors.length) {
    throw new ExtractError('no-colors', 'No se han encontrado colores de marca en la página (puede que se generen con JavaScript).');
  }
  return {
    url: page.finalUrl || url,
    colors,
    stats: { stylesheetsFound: stylesheets.length, stylesheetsLoaded: loaded, stylesheetsFailed: failed.length },
  };
}
