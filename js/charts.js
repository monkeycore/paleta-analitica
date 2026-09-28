// Gráficos SVG de vista previa, con un estilo parecido a los de Workspace:
// rejilla gris tenue, ejes discretos, leyenda con cuadrados y tooltip al pasar.

const NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const CHANNELS = ['Búsqueda de pago', 'Natural', 'Directo', 'Redes sociales', 'Email', 'Display', 'Afiliados', 'Referidos', 'Push', 'SMS', 'Vídeo', 'Podcast', 'Prensa', 'Radio', 'Exterior', 'Apps', 'Chat', 'Tienda', 'Otros', 'Sin clasificar'];

function el(name, attrs = {}, children = []) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

// Datos pseudoaleatorios deterministas.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const fmt = (n) => n.toLocaleString('es-ES');

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 2) * 2 * p;
}

function tooltip(container) {
  let tip = container.querySelector('.chart-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; container.append(tip); }
  return {
    show(evt, html) {
      tip.innerHTML = html;
      tip.hidden = false;
      const box = container.getBoundingClientRect();
      const x = evt.clientX - box.left, y = evt.clientY - box.top;
      tip.style.left = `${Math.min(x + 12, box.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 0)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

const swatchHtml = (color, label, value) => `<span class="tip-row"><i style="background:${color}"></i>${label}<b>${value}</b></span>`;

function legend(container, palette) {
  const ul = document.createElement('ul');
  ul.className = 'chart-legend';
  palette.forEach((c, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${c}"></i>${CHANNELS[i % CHANNELS.length]}`;
    ul.append(li);
  });
  container.append(ul);
}

// Barras verticales: una categoría por color (como una tabla improvisada con varias filas).
export function renderBarChart(container, palette) {
  container.replaceChildren();
  const W = 480, H = 260, m = { t: 12, r: 8, b: 28, l: 44 };
  const r = rng(7);
  const values = palette.map((_, i) => Math.round((1 - i / (palette.length + 2)) * 42000 + r() * 9000));
  const max = niceMax(Math.max(...values));
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Gráfico de barras con la paleta' });
  for (let k = 0; k <= 4; k++) {
    const y = m.t + ih - (ih * k) / 4;
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: k ? 'grid' : 'axis' }));
    const t = el('text', { x: m.l - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' });
    t.textContent = fmt((max * k) / 4 / 1000) + (k ? 'k' : '');
    svg.append(t);
  }
  const band = iw / palette.length;
  const bw = Math.min(40, band * 0.62);
  const tip = tooltip(container);
  palette.forEach((c, i) => {
    const h = (values[i] / max) * ih;
    const x = m.l + band * i + (band - bw) / 2;
    const y = m.t + ih - h;
    const rad = Math.min(4, bw / 2, h);
    // Barra con las esquinas superiores redondeadas y la base recta sobre el eje.
    const d = `M${x},${m.t + ih}V${y + rad}Q${x},${y} ${x + rad},${y}H${x + bw - rad}Q${x + bw},${y} ${x + bw},${y + rad}V${m.t + ih}Z`;
    const bar = el('path', { d, fill: c, class: 'mark' });
    const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' });
    hit.addEventListener('pointermove', (e) => tip.show(e, swatchHtml(c, CHANNELS[i % CHANNELS.length], `${fmt(values[i])} visitas`)));
    hit.addEventListener('pointerleave', () => tip.hide());
    svg.append(bar, hit);
    const t = el('text', { x: m.l + band * i + band / 2, y: H - 10, class: 'tick', 'text-anchor': 'middle' });
    t.textContent = String(i + 1);
    svg.append(t);
  });
  container.append(svg);
  legend(container, palette);
}

// Líneas: una serie por color a lo largo de 12 meses.
export function renderLineChart(container, palette) {
  container.replaceChildren();
  const W = 480, H = 260, m = { t: 12, r: 12, b: 28, l: 44 };
  const r = rng(21);
  const series = palette.map((_, i) => {
    let v = 10 + (palette.length - i) * 5 + r() * 8;
    return MONTHS.map(() => (v = Math.max(2, v + (r() - 0.45) * 7)));
  });
  const max = niceMax(Math.max(...series.flat()));
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const X = (j) => m.l + (iw * j) / (MONTHS.length - 1);
  const Y = (v) => m.t + ih - (v / max) * ih;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Gráfico de líneas con la paleta' });
  for (let k = 0; k <= 4; k++) {
    const y = m.t + ih - (ih * k) / 4;
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: k ? 'grid' : 'axis' }));
    const t = el('text', { x: m.l - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' });
    t.textContent = fmt(Math.round((max * k) / 4)) + (k ? 'k' : '');
    svg.append(t);
  }
  MONTHS.forEach((mo, j) => {
    if (j % 2) return;
    const t = el('text', { x: X(j), y: H - 10, class: 'tick', 'text-anchor': 'middle' });
    t.textContent = mo;
    svg.append(t);
  });
  const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' });
  svg.append(cross);
  series.forEach((pts, i) => {
    svg.append(el('polyline', { points: pts.map((v, j) => `${X(j)},${Y(v)}`).join(' '), fill: 'none', stroke: palette[i], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'mark' }));
  });
  const tip = tooltip(container);
  const overlay = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
  overlay.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const j = Math.max(0, Math.min(MONTHS.length - 1, Math.round(((px - m.l) / iw) * (MONTHS.length - 1))));
    cross.setAttribute('x1', X(j)); cross.setAttribute('x2', X(j)); cross.setAttribute('visibility', 'visible');
    const rows = series.map((pts, i) => ({ i, v: pts[j] })).sort((a, b) => b.v - a.v)
      .map(({ i, v }) => swatchHtml(palette[i], CHANNELS[i % CHANNELS.length], `${v.toFixed(1)}k`)).join('');
    tip.show(e, `<strong>${MONTHS[j]}</strong>${rows}`);
  });
  overlay.addEventListener('pointerleave', () => { tip.hide(); cross.setAttribute('visibility', 'hidden'); });
  svg.append(overlay);
  container.append(svg);
  legend(container, palette);
}

// Donut con separación de 2 px entre segmentos y total en el centro.
export function renderDonutChart(container, palette) {
  container.replaceChildren();
  const S = 260, R = 110, r0 = 70, cx = S / 2, cy = S / 2;
  const rand = rng(3);
  const values = palette.map((_, i) => Math.round((palette.length - i) * 900 + rand() * 1200));
  const total = values.reduce((a, b) => a + b, 0);
  const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': 'Gráfico de anillo con la paleta', class: 'donut' });
  const tip = tooltip(container);
  let a0 = -Math.PI / 2;
  const pt = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  values.forEach((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${pt(R, a0)}A${R},${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r0, a1)}A${r0},${r0} 0 ${large} 0 ${pt(r0, a0)}Z`;
    const seg = el('path', { d, fill: palette[i], class: 'mark seg' });
    seg.addEventListener('pointermove', (e) => tip.show(e, swatchHtml(palette[i], CHANNELS[i % CHANNELS.length], `${fmt(v)} (${((v / total) * 100).toFixed(1)} %)`)));
    seg.addEventListener('pointerleave', () => tip.hide());
    svg.append(seg);
    a0 = a1;
  });
  const t1 = el('text', { x: cx, y: cy - 2, class: 'donut-total', 'text-anchor': 'middle' });
  t1.textContent = fmt(total);
  const t2 = el('text', { x: cx, y: cy + 18, class: 'tick', 'text-anchor': 'middle' });
  t2.textContent = 'Visitas';
  svg.append(t1, t2);
  container.append(svg);
  legend(container, palette);
}

export function renderAllCharts(palette, { bar, line, donut }) {
  if (!palette.length) { [bar, line, donut].forEach((c) => c.replaceChildren()); return; }
  renderBarChart(bar, palette);
  renderLineChart(line, palette);
  renderDonutChart(donut, palette);
}
