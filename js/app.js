import { WORKSPACE_FORMAT, PALETTE_CONFIG } from './config.js';
import { normalizeHex, readableTextOn, contrastRatio } from './color.js';
import { generatePalette, analyzePalette, CVD_LABELS } from './palette.js';
import { extractColorsFromImage } from './extract-image.js';
import { extractColorsFromUrl, ExtractError } from './extract-url.js';
import { renderAllCharts } from './charts.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  detected: [],   // [{hex, label}]
  brand: [],      // hex de marca seleccionados
  palette: [],    // [{hex, brand: bool}]
  mode: 'distinta',
  size: PALETTE_CONFIG.size,
  title: '',
};

// ---------- Utilidades ----------

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copiado');
}

export function formatForWorkspace(hexes, f = WORKSPACE_FORMAT) {
  return hexes.slice(0, f.maxColors).map((h) => {
    let s = h.replace('#', '');
    s = f.uppercase ? s.toUpperCase() : s.toLowerCase();
    return (f.hashPrefix ? '#' : '') + s;
  }).join(f.separator);
}

function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

// ---------- Paleta ----------

function regenerate() {
  const hexes = generatePalette(state.brand, { size: state.size, mode: state.mode });
  state.palette = hexes.map((hex) => ({ hex, brand: state.brand.includes(hex) }));
  render();
}

function fillPalette() {
  const current = state.palette.map((p) => p.hex);
  const hexes = generatePalette(current, { size: state.size, mode: state.mode });
  state.palette = hexes.map((hex) => ({ hex, brand: state.palette.find((p) => p.hex === hex)?.brand || false }));
  render();
}

function loadColors(brandHexes, detected, title) {
  state.detected = detected;
  state.brand = brandHexes.slice(0, PALETTE_CONFIG.maxBrandColors);
  state.title = title || '';
  regenerate();
}

// Elige los colores de marca entre los detectados: los primeros, saltando casi-duplicados.
function pickBrand(colors) {
  return colors.slice(0, PALETTE_CONFIG.maxBrandColors).map((c) => c.hex);
}

// ---------- Render ----------

function render() {
  renderDetected();
  renderPalette();
  renderChecks();
  const hexes = state.palette.map((p) => p.hex);
  renderAllCharts(hexes, { bar: $('#chart-bar'), line: $('#chart-line'), donut: $('#chart-donut') });
  $('#output-text').textContent = hexes.length ? formatForWorkspace(hexes) : '—';
  $('#copy-button').disabled = !hexes.length;
  $('#palette-title').textContent = state.title ? `· ${state.title}` : '';
  saveHash();
}

function renderDetected() {
  const list = $('#detected-list');
  list.replaceChildren();
  const all = [...state.detected];
  for (const hex of state.brand) if (!all.some((d) => d.hex === hex)) all.push({ hex, label: 'a mano' });
  for (const c of all) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(state.brand.includes(c.hex)));
    b.innerHTML = `<i style="background:${c.hex}"></i><span>${c.hex}</span>${c.label ? `<small>${c.label}</small>` : ''}`;
    b.title = c.title || '';
    b.addEventListener('click', () => toggleBrand(c.hex));
    li.append(b);
    list.append(li);
  }
  $('#detected-empty').hidden = all.length > 0;
}

function toggleBrand(hex) {
  if (state.brand.includes(hex)) state.brand = state.brand.filter((h) => h !== hex);
  else if (state.brand.length >= PALETTE_CONFIG.maxBrandColors) {
    toast(`Máximo ${PALETTE_CONFIG.maxBrandColors} colores de marca`);
    return;
  } else state.brand = [...state.brand, hex];
  regenerate();
}

let dragIndex = null;

function renderPalette() {
  const list = $('#palette-list');
  list.replaceChildren();
  $('#palette-empty').hidden = state.palette.length > 0;
  state.palette.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'swatch';
    li.draggable = true;
    const ink = readableTextOn(p.hex);
    const contrast = contrastRatio(p.hex, PALETTE_CONFIG.background);
    li.innerHTML = `
      <div class="swatch-color" style="background:${p.hex};color:${ink}" title="Arrastra para reordenar">
        <span class="swatch-index">${i + 1}</span>
        ${p.brand ? '<span class="swatch-tag">marca</span>' : ''}
      </div>
      <div class="swatch-body">
        <input class="swatch-hex" type="text" value="${p.hex}" maxlength="7" aria-label="Color ${i + 1} en hexadecimal" spellcheck="false">
        <div class="swatch-meta">
          <span class="${contrast < PALETTE_CONFIG.minContrast ? 'bad' : ''}" title="Contraste con fondo blanco">${contrast.toFixed(1)}:1</span>
          <span class="swatch-actions">
            <input type="color" value="${p.hex.toLowerCase()}" aria-label="Elegir color ${i + 1}" title="Cambiar color">
            <button type="button" class="icon-btn" data-act="left" aria-label="Mover a la izquierda" ${i === 0 ? 'disabled' : ''}>←</button>
            <button type="button" class="icon-btn" data-act="right" aria-label="Mover a la derecha" ${i === state.palette.length - 1 ? 'disabled' : ''}>→</button>
            <button type="button" class="icon-btn" data-act="remove" aria-label="Quitar color">✕</button>
          </span>
        </div>
      </div>`;

    const hexInput = li.querySelector('.swatch-hex');
    const commit = (value) => {
      const hex = normalizeHex(value);
      if (!hex) { hexInput.value = p.hex; toast('Hex no válido'); return; }
      if (hex === p.hex) return;
      state.palette[i] = { hex, brand: false };
      render();
    };
    hexInput.addEventListener('change', () => commit(hexInput.value));
    hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexInput.blur(); });
    const picker = li.querySelector('input[type="color"]');
    picker.addEventListener('change', () => commit(picker.value));

    li.querySelector('[data-act="left"]').addEventListener('click', () => move(i, i - 1));
    li.querySelector('[data-act="right"]').addEventListener('click', () => move(i, i + 1));
    li.querySelector('[data-act="remove"]').addEventListener('click', () => {
      state.palette.splice(i, 1);
      render();
    });

    li.addEventListener('dragstart', (e) => {
      if (e.target.closest('input')) { e.preventDefault(); return; }
      dragIndex = i;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', p.hex);
    });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); dragIndex = null; });
    li.addEventListener('dragover', (e) => { if (dragIndex !== null) { e.preventDefault(); li.classList.add('drop-target'); } });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drop-target');
      if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
    });
    list.append(li);
  });
}

function move(from, to) {
  if (to < 0 || to >= state.palette.length) return;
  const [item] = state.palette.splice(from, 1);
  state.palette.splice(to, 0, item);
  render();
}

const pairHtml = (a, b) => `<span class="pair"><i style="background:${a}"></i><i style="background:${b}"></i></span>`;

function renderChecks() {
  const box = $('#palette-checks');
  box.replaceChildren();
  if (!state.palette.length) return;
  const hexes = state.palette.map((p) => p.hex);
  const a = analyzePalette(hexes);
  const items = [];
  const low = a.colors.filter((c) => c.lowContrast);
  if (low.length) {
    items.push(['warn', `${low.length === 1 ? 'Un color tiene' : `${low.length} colores tienen`} poco contraste con el fondo blanco (&lt; ${PALETTE_CONFIG.minContrast}:1): ${low.map((c) => `<b>${c.hex}</b> (${c.contrast.toFixed(1)}:1)`).join(', ')}. Úsalos con etiquetas o en series secundarias.`]);
  } else items.push(['ok', `Todos los colores contrastan con el fondo blanco (≥ ${PALETTE_CONFIG.minContrast}:1).`]);

  if (a.closePairs.length) {
    const list = a.closePairs.map(({ i, j, d }) => `${pairHtml(hexes[i], hexes[j])} ${i + 1} y ${j + 1} (ΔE ${d.toFixed(1)})`).join(', ');
    items.push(['bad', `Colores demasiado parecidos (ΔE &lt; ${PALETTE_CONFIG.minDeltaE}): ${list}.`]);
  } else items.push(['ok', `Todos los colores se distinguen entre sí (ΔE mínimo ${a.minPair.toFixed(1)}).`]);

  if (a.cvdPairs.length) {
    const list = a.cvdPairs.map(({ i, j, d, type }) => `${pairHtml(hexes[i], hexes[j])} ${i + 1} y ${j + 1} (${CVD_LABELS[type]}, ΔE ${d.toFixed(1)})`).join(', ');
    items.push(['warn', `Pares que pueden confundirse con daltonismo: ${list}. Evita ponerlos juntos.`]);
  } else items.push(['ok', 'Sin confusiones importantes simulando daltonismo.']);

  if (hexes.length > WORKSPACE_FORMAT.maxColors) {
    items.push(['warn', `Workspace admite ${WORKSPACE_FORMAT.maxColors} colores; se copiarán solo los primeros.`]);
  }
  for (const [cls, html] of items) {
    const p = document.createElement('p');
    p.className = `check ${cls}`;
    p.innerHTML = `<span>${html}</span>`;
    box.append(p);
  }
}

// ---------- Estado en la URL (para compartir) ----------

function saveHash() {
  const hexes = state.palette.map((p) => p.hex.slice(1)).join('-');
  const brand = state.brand.map((h) => h.slice(1)).join('-');
  const params = new URLSearchParams();
  if (hexes) params.set('p', hexes);
  if (brand) params.set('m', brand);
  if (state.title) params.set('t', state.title);
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

function loadHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const palette = (params.get('p') || '').split('-').map(normalizeHex).filter(Boolean);
  if (!palette.length) return false;
  state.brand = (params.get('m') || '').split('-').map(normalizeHex).filter(Boolean);
  state.title = params.get('t') || '';
  state.detected = state.brand.map((hex) => ({ hex }));
  state.palette = palette.map((hex) => ({ hex, brand: state.brand.includes(hex) }));
  state.size = Math.min(WORKSPACE_FORMAT.maxColors, Math.max(3, palette.length));
  $('#size-select').value = state.size;
  return true;
}

// ---------- Imagen ----------

async function handleImage(file) {
  const status = $('#image-status');
  if (!file || !file.type.startsWith('image/')) { setStatus(status, 'El archivo no es una imagen.', true); return; }
  const preview = $('#image-preview');
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  setStatus(status, 'Analizando la imagen…');
  try {
    const { colors } = await extractColorsFromImage(file);
    if (!colors.length) {
      setStatus(status, 'No se han encontrado colores de marca: la imagen es casi toda gris, blanca o negra.', true);
      return;
    }
    setStatus(status, `${colors.length} colores detectados.`);
    const detected = colors.map((c) => ({ hex: c.hex, label: `${Math.max(1, Math.round(c.share * 100))} %`, title: 'Porcentaje de la imagen' }));
    loadColors(pickBrand(colors), detected, file.name && file.name !== 'image.png' ? file.name : 'imagen');
    clearActiveBrand();
    $('#detected-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    setStatus(status, 'No se ha podido leer la imagen.', true);
  }
}

function setupImageInput() {
  const zone = $('#dropzone');
  const input = $('#file-input');
  input.addEventListener('change', () => handleImage(input.files[0]));
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    zone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    handleImage(e.dataTransfer.files[0]);
  });
  // Pegar una imagen en cualquier parte de la página.
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    handleImage(item.getAsFile());
  });
}

// ---------- URL ----------

function setupUrlInput() {
  const form = $('#url-form');
  const status = $('#url-status');
  const button = $('#url-button');
  const blocked = $('#url-blocked');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    blocked.hidden = true;
    button.disabled = true;
    try {
      const result = await extractColorsFromUrl($('#url-input').value, { onProgress: (m) => setStatus(status, m) });
      const { stylesheetsLoaded, stylesheetsFound, stylesheetsFailed } = result.stats;
      setStatus(status, `${result.colors.length} colores detectados · ${stylesheetsLoaded} de ${stylesheetsFound} hojas de estilo analizadas${stylesheetsFailed ? ` (${stylesheetsFailed} no se pudieron descargar)` : ''}.`);
      const detected = result.colors.map((c) => ({ hex: c.hex, label: c.sources[0], title: `Puntuación ${c.score} · ${c.count} apariciones\n${c.sources.join('\n')}` }));
      loadColors(pickBrand(result.colors), detected, new URL(result.url).hostname.replace(/^www\./, ''));
      clearActiveBrand();
      $('#detected-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (!(err instanceof ExtractError)) console.error(err);
      if (err.code === 'blocked') {
        setStatus(status, '');
        $('#url-blocked-text').textContent = `${err.message} Muchas webs grandes bloquean las descargas automáticas.`;
        blocked.hidden = false;
      } else {
        setStatus(status, err instanceof ExtractError ? err.message : 'Error inesperado al analizar la web.', true);
      }
    } finally {
      button.disabled = false;
    }
  });
  $('#goto-image').addEventListener('click', () => {
    $('#dropzone').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#dropzone').focus({ preventScroll: true });
    $('#file-input').click();
  });
}

// ---------- Galería ----------

let brands = [];

function clearActiveBrand() {
  document.querySelectorAll('.brand-card.active').forEach((c) => c.classList.remove('active'));
}

async function setupGallery() {
  const gallery = $('#gallery');
  try {
    const res = await fetch('data/brands.json');
    const data = await res.json();
    brands = data.brands || [];
  } catch (err) {
    console.error(err);
    gallery.innerHTML = '<li class="empty">No se ha podido cargar la galería.</li>';
    return;
  }
  // La paleta se genera al cargar con el mismo algoritmo, salvo que la marca traiga una fija.
  for (const b of brands) {
    b.colors = b.colors.map(normalizeHex).filter(Boolean);
    b.palette = (b.palette?.length ? b.palette.map(normalizeHex).filter(Boolean) : generatePalette(b.colors, { size: PALETTE_CONFIG.size }));
  }
  brands.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  renderGallery('');
  $('#gallery-search').addEventListener('input', (e) => renderGallery(e.target.value));
}

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function renderGallery(query) {
  const gallery = $('#gallery');
  gallery.replaceChildren();
  const q = norm(query.trim());
  const list = brands.filter((b) => !q || norm(b.name).includes(q));
  if (!list.length) { gallery.innerHTML = '<li class="empty">Ninguna marca coincide.</li>'; return; }
  for (const b of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brand-card';
    if (state.title === b.name) btn.classList.add('active');
    const pending = b.status !== 'verificado';
    btn.innerHTML = `
      <span class="brand-name"><span>${b.name}</span>${pending ? '<span class="badge" title="Colores pendientes de revisar">pendiente</span>' : ''}</span>
      <span class="brand-strip" aria-hidden="true">${b.palette.map((h) => `<i class="${b.colors.includes(h) ? 'brand' : ''}" style="background:${h}"></i>`).join('')}</span>`;
    btn.setAttribute('aria-label', `Cargar la paleta de ${b.name}`);
    btn.addEventListener('click', () => {
      state.detected = b.colors.map((hex) => ({ hex }));
      state.brand = b.colors.slice(0, PALETTE_CONFIG.maxBrandColors);
      state.title = b.name;
      state.palette = b.palette.slice(0, state.size).map((hex) => ({ hex, brand: b.colors.includes(hex) }));
      if (state.palette.length < state.size) { fillPalette(); } else render();
      clearActiveBrand();
      btn.classList.add('active');
      $('#palette-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    li.append(btn);
    gallery.append(li);
  }
}

// ---------- Arranque ----------

function setupControls() {
  const sizeSelect = $('#size-select');
  for (let n = 3; n <= WORKSPACE_FORMAT.maxColors; n++) {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sizeSelect.append(o);
  }
  sizeSelect.value = state.size;
  sizeSelect.addEventListener('change', () => {
    state.size = Number(sizeSelect.value);
    if (state.palette.length > state.size) { state.palette = state.palette.slice(0, state.size); render(); }
    else if (state.palette.length) fillPalette();
  });
  $('#mode-select').addEventListener('change', (e) => { state.mode = e.target.value; if (state.palette.length) regenerate(); });
  $('#regen-button').addEventListener('click', regenerate);
  $('#fill-button').addEventListener('click', fillPalette);
  $('#copy-button').addEventListener('click', () => copyText($('#output-text').textContent));
  $('#manual-brand').addEventListener('submit', (e) => {
    e.preventDefault();
    const hex = normalizeHex($('#manual-color').value);
    if (!state.detected.some((d) => d.hex === hex)) state.detected.push({ hex, label: 'a mano' });
    if (!state.brand.includes(hex) && state.brand.length < PALETTE_CONFIG.maxBrandColors) state.brand.push(hex);
    regenerate();
  });
  $('#max-brand').textContent = PALETTE_CONFIG.maxBrandColors;
  const f = WORKSPACE_FORMAT;
  $('#format-hint').textContent = `Formato actual: separador «${f.separator}», ${f.hashPrefix ? 'con' : 'sin'} «#», máximo ${f.maxColors} colores (se cambia en js/config.js).`;
}

function init() {
  setupControls();
  setupImageInput();
  setupUrlInput();
  loadHash();
  render();
  setupGallery();
}

init();
