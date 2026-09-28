// Generación y validación de paletas categóricas a partir de colores de marca.
// Se trabaja en OKLCH: los colores nuevos se eligen de una rejilla de tonos y
// luminosidades, de forma voraz, maximizando la distancia (OKLab ΔE) a los ya
// elegidos, con daltonismo incluido, y exigiendo contraste con el fondo.

import { normalizeHex, hexToOklch, oklchToHex, deltaE, contrastRatio, CVD_TYPES } from './color.js';
import { PALETTE_CONFIG } from './config.js';

const hueDistance = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

function minCvdDistance(a, b) {
  return Math.min(deltaE(a, b, 'protan'), deltaE(a, b, 'deutan'));
}

// Candidatos: rejilla OKLCH dentro de la banda de luminosidad y con contraste suficiente.
function buildCandidates(fixed, { mode, cfg }) {
  const chromas = fixed.map((h) => hexToOklch(h)[1]).filter((c) => c >= 0.05).sort((a, b) => a - b);
  const median = chromas.length ? chromas[Math.floor(chromas.length / 2)] : 0.15;
  const targetC = Math.min(0.22, Math.max(0.12, median));
  const brandHues = fixed.map((h) => hexToOklch(h)).filter(([, c]) => c >= 0.05).map(([, , h]) => h);

  const [lMin, lMax] = cfg.lightness;
  const out = [];
  for (let H = 0; H < 360; H += 6) {
    if (mode === 'armonica' && brandHues.length) {
      // Tonos cercanos a la marca, a sus complementarios y a la tríada.
      const anchors = brandHues.flatMap((h) => [h, h + 180, h + 120, h + 240].map((x) => x % 360));
      if (!anchors.some((a) => hueDistance(a, H) <= 35)) continue;
    }
    for (let L = lMin + 0.02; L <= lMax; L += 0.04) {
      for (const C of [...new Set([targetC, targetC * 0.75, 0.2])]) {
        const hex = oklchToHex([L, C, H]);
        const [, realC] = hexToOklch(hex);
        if (realC < cfg.minChroma) continue;
        if (contrastRatio(hex, cfg.background) < cfg.minContrast) continue;
        out.push(hex);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Genera una paleta. Los colores `fixed` (marca o elegidos a mano) van primero y
 * no se modifican; el resto se genera hasta llegar a `size`.
 * @param {string[]} fixed
 * @param {{size?: number, mode?: 'distinta'|'armonica'}} opts
 */
export function generatePalette(fixed, { size = PALETTE_CONFIG.size, mode = 'distinta', cfg = PALETTE_CONFIG } = {}) {
  const selected = [];
  for (const hex of fixed.map(normalizeHex).filter(Boolean)) {
    if (!selected.includes(hex)) selected.push(hex);
  }
  if (selected.length >= size) return selected.slice(0, size);

  let pool = buildCandidates(selected, { mode, cfg });
  if (pool.length < size) pool = buildCandidates(selected, { mode: 'distinta', cfg });

  // Si no hay semilla, se parte del candidato más cercano a un azul de datos clásico.
  if (!selected.length) {
    pool.sort((a, b) => deltaE(a, '#1473E6') - deltaE(b, '#1473E6'));
    selected.push(pool.shift());
  }

  const minNormal = new Map(pool.map((c) => [c, Infinity]));
  const minCvd = new Map(pool.map((c) => [c, Infinity]));
  const update = (added) => {
    for (const c of pool) {
      minNormal.set(c, Math.min(minNormal.get(c), deltaE(c, added)));
      minCvd.set(c, Math.min(minCvd.get(c), minCvdDistance(c, added)));
    }
  };
  selected.forEach(update);

  while (selected.length < size && pool.length) {
    let best = null, bestScore = -Infinity;
    for (const c of pool) {
      const dn = minNormal.get(c), dc = minCvd.get(c);
      // Prioridad: superar el mínimo en visión normal; después, separación con daltonismo.
      const score = Math.min(dn, cfg.minDeltaE * 2) + 0.8 * Math.min(dc, cfg.cvdDeltaE * 3) + (dn >= cfg.minDeltaE ? 100 : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    selected.push(best);
    pool = pool.filter((c) => c !== best);
    update(best);
  }
  return selected;
}

/**
 * Revisa una paleta y devuelve avisos: contraste con el fondo, pares demasiado
 * parecidos en visión normal y pares que se confunden con daltonismo.
 */
export function analyzePalette(palette, cfg = PALETTE_CONFIG) {
  const colors = palette.map((hex) => {
    const [L, C, H] = hexToOklch(hex);
    const contrast = contrastRatio(hex, cfg.background);
    return { hex, L, C, H, contrast, lowContrast: contrast < cfg.minContrast };
  });
  const closePairs = [];
  const cvdPairs = [];
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      const d = deltaE(palette[i], palette[j]);
      if (d < cfg.minDeltaE) closePairs.push({ i, j, d });
      else {
        const worst = CVD_TYPES.map((t) => ({ t, d: deltaE(palette[i], palette[j], t) })).sort((a, b) => a.d - b.d)[0];
        if (worst.d < cfg.cvdDeltaE) cvdPairs.push({ i, j, d: worst.d, type: worst.t });
      }
    }
  }
  let minPair = Infinity;
  for (let i = 0; i < palette.length; i++) for (let j = i + 1; j < palette.length; j++) minPair = Math.min(minPair, deltaE(palette[i], palette[j]));
  return { colors, closePairs, cvdPairs, minPair };
}

export const CVD_LABELS = { protan: 'protanopia', deutan: 'deuteranopia', tritan: 'tritanopia' };
