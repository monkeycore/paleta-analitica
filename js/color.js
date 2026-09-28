// Utilidades de color: conversión sRGB ⇄ OKLab/OKLCH, contraste WCAG,
// distancia perceptual y simulación de daltonismo. Sin dependencias; funciona
// en el navegador y en Node (lo usa tools/extract-brands.mjs).

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export const rgbToLinear = (rgb) => rgb.map((v) => toLinear(v / 255));

export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export const rgbToOklab = (rgb) => linearToOklab(rgbToLinear(rgb));
export const hexToOklab = (hex) => rgbToOklab(hexToRgb(hex));

export function oklabToOklch([L, a, b]) {
  const C = Math.hypot(a, b);
  const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

export function oklchToOklab([L, C, H]) {
  const h = (H * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

export const hexToOklch = (hex) => oklabToOklch(hexToOklab(hex));

const inGamut = (lin) => lin.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

// OKLCH → hex. Si el color cae fuera de sRGB, reduce el croma manteniendo
// tono y luminosidad (búsqueda binaria).
export function oklchToHex([L, C, H]) {
  let lin = oklabToLinear(oklchToOklab([L, C, H]));
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(oklchToOklab([L, mid, H])))) lo = mid; else hi = mid;
    }
    lin = oklabToLinear(oklchToOklab([L, lo, H]));
  }
  return rgbToHex(lin.map((c) => toGamma(clamp01(c)) * 255));
}

export function relativeLuminance(hex) {
  const [r, g, b] = rgbToLinear(hexToRgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Distancia euclídea en OKLab × 100 (≈ ΔE perceptual; 1 unidad ≈ diferencia apenas visible).
export function deltaE(hexA, hexB, cvd) {
  const a = cvd ? linearToOklab(simulateCvd(hexA, cvd)) : hexToOklab(hexA);
  const b = cvd ? linearToOklab(simulateCvd(hexB, cvd)) : hexToOklab(hexB);
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export const oklabDistance = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Machado, Oliveira & Fernandes (2009), severidad 1.0, en RGB lineal.
const CVD_MATRICES = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const CVD_TYPES = Object.keys(CVD_MATRICES);

export function simulateCvd(hex, type) {
  const [r, g, b] = rgbToLinear(hexToRgb(hex));
  return CVD_MATRICES[type].map((row) => clamp01(row[0] * r + row[1] * g + row[2] * b));
}

// Un color es "neutro" si casi no tiene croma o es casi blanco / casi negro.
export function isNeutral(hex, { minChroma = 0.035, minL = 0.18, maxL = 0.96 } = {}) {
  const [L, C] = hexToOklch(hex);
  return C < minChroma || L < minL || L > maxL;
}

// Texto legible (negro o blanco) sobre un color de fondo.
export const readableTextOn = (hex) => (contrastRatio(hex, '#000000') >= contrastRatio(hex, '#FFFFFF') ? '#000000' : '#FFFFFF');

// ---------- Parser de colores CSS ----------

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp01(s); l = clamp01(l);
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const num = (v, scale = 1) => (String(v).endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v));

function parseAngle(v) {
  const x = parseFloat(v);
  if (/turn$/.test(v)) return x * 360;
  if (/rad$/.test(v)) return (x * 180) / Math.PI;
  if (/grad$/.test(v)) return x * 0.9;
  return x;
}

// Expresión que localiza colores dentro de un texto CSS.
export const CSS_COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(\s*[^()]*\)/gi;

// Convierte una cadena de color CSS a hex (sin alfa). Devuelve null si no se
// reconoce o si es casi transparente.
export function parseCssColor(str) {
  const s = String(str).trim().toLowerCase();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 4 && parseInt(h[3], 16) < 8) return null;
    if (h.length === 8 && parseInt(h.slice(6), 16) < 128) return null;
    return normalizeHex(s);
  }
  const m = s.match(/^(rgba?|hsla?|oklch)\((.*)\)$/);
  if (!m) return null;
  const parts = m[2].replace(/\s*\/\s*/, ' / ').split(/[\s,]+/).filter(Boolean);
  const slash = parts.indexOf('/');
  let alpha = 1;
  let comps = parts;
  if (slash >= 0) { alpha = num(parts[slash + 1]); comps = parts.slice(0, slash); }
  else if (parts.length === 4) { alpha = num(parts[3]); comps = parts.slice(0, 3); }
  if (comps.length !== 3 || comps.some((c) => c.startsWith('var') || c === 'none')) return null;
  if (!(alpha >= 0.5)) return null;
  let rgb;
  if (m[1].startsWith('rgb')) rgb = comps.map((c) => num(c, 255));
  else if (m[1].startsWith('hsl')) rgb = hslToRgb(parseAngle(comps[0]), num(comps[1], 1) / (comps[1].endsWith('%') ? 1 : 100), num(comps[2], 1) / (comps[2].endsWith('%') ? 1 : 100));
  else return oklchToHex([num(comps[0], 1), num(comps[1], 0.4), parseAngle(comps[2])]);
  if (rgb.some((v) => Number.isNaN(v))) return null;
  return rgbToHex(rgb);
}
