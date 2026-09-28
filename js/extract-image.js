// Extracción de colores desde una imagen, todo en el navegador:
// canvas → píxeles → descartar transparentes, fondo y neutros → k-means en OKLab.

import { rgbToOklab, oklabToLinear, rgbToHex, oklabToOklch, oklabDistance } from './color.js';
import { EXTRACT_CONFIG } from './config.js';

// Carga un File/Blob como imagen y devuelve los píxeles reducidos.
export async function imageFileToPixels(file, maxSide = EXTRACT_CONFIG.imageMaxSide) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* p. ej. SVG: se usa <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractColorsFromImage(file, opts) {
  const px = await imageFileToPixels(file);
  return extractColorsFromPixels(px, opts);
}

// Semilla fija para que el mismo archivo dé siempre el mismo resultado.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Colores dominantes del borde de la imagen: se consideran fondo.
function detectBackground(data, width, height) {
  const buckets = new Map();
  let total = 0;
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
    total++;
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { add(0, y); add(width - 1, y); }
  // Un color de borde es fondo si ocupa al menos un 15 % del perímetro.
  return [...buckets.values()]
    .filter((b) => b.n / total >= 0.15)
    .map((b) => rgbToOklab([b.r / b.n, b.g / b.n, b.b / b.n]));
}

function isNeutralLab(lab) {
  const [L, C] = oklabToOklch(lab);
  return C < 0.04 || L < 0.2 || L > 0.96;
}

// Núcleo de la extracción. `data` es un RGBA plano (ImageData.data).
export function extractColorsFromPixels({ data, width, height }, { k = EXTRACT_CONFIG.kmeansK, maxColors = 8 } = {}) {
  const background = detectBackground(data, width, height);
  const points = [];
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    opaque++;
    const lab = rgbToOklab([data[i], data[i + 1], data[i + 2]]);
    if (isNeutralLab(lab)) continue;
    if (background.some((bg) => oklabDistance(bg, lab) < 6)) continue;
    points.push(lab);
  }
  if (!opaque || points.length / opaque < 0.002 || points.length < 12) {
    return { colors: [], chromaticShare: opaque ? points.length / opaque : 0 };
  }

  const clusters = kmeans(points, Math.min(k, points.length), mulberry32(points.length));

  // Fusionar grupos casi iguales.
  clusters.sort((a, b) => b.n - a.n);
  const merged = [];
  for (const c of clusters) {
    const near = merged.find((m) => oklabDistance(m.center, c.center) < 7);
    if (near) {
      const n = near.n + c.n;
      near.center = near.center.map((v, i) => (v * near.n + c.center[i] * c.n) / n);
      near.n = n;
    } else merged.push({ ...c });
  }

  const colors = merged
    .filter((c) => c.n / points.length >= 0.01)
    .map((c) => {
      const lin = oklabToLinear(c.center).map((v) => Math.min(1, Math.max(0, v)));
      const rgb = lin.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
      const chroma = oklabToOklch(c.center)[1];
      return {
        hex: rgbToHex(rgb),
        share: c.n / opaque,
        // Puntuación: presencia, con un pequeño empuje a los colores saturados.
        score: (c.n / points.length) * (0.6 + Math.min(chroma, 0.25) * 2),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxColors);

  return { colors, chromaticShare: points.length / opaque };
}

function kmeans(points, k, rand, iterations = 20) {
  // Inicialización k-means++.
  const centers = [points[Math.floor(rand() * points.length)]];
  const dist = new Float64Array(points.length).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const d = sqDist(points[i], last);
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    if (sum === 0) break;
    let r = rand() * sum;
    let idx = 0;
    for (; idx < points.length - 1; idx++) { r -= dist[idx]; if (r <= 0) break; }
    centers.push(points[idx]);
  }

  const assign = new Int32Array(points.length);
  let sums, counts;
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = sqDist(points[i], centers[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best || it === 0) { assign[i] = best; changed = true; }
    }
    sums = centers.map(() => [0, 0, 0]);
    counts = new Array(centers.length).fill(0);
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      s[0] += points[i][0]; s[1] += points[i][1]; s[2] += points[i][2];
      counts[assign[i]]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (counts[c]) centers[c] = sums[c].map((v) => v / counts[c]);
    }
    if (!changed) break;
  }
  return centers.map((center, i) => ({ center, n: counts[i] })).filter((c) => c.n > 0);
}

const sqDist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
