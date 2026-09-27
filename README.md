# Paleta Analítica

Web estática que genera paletas de colores para la **paleta personalizada de proyecto de Adobe Analytics Workspace** a partir de los colores de una marca.

1. **Extrae colores** de una imagen (pantallazo o logo) o de una URL.
2. **Genera una paleta** de 8 colores: los de marca primero y el resto calculados en OKLCH.
3. **Comprueba** que los colores se distinguen entre sí y contrastan con el fondo blanco.
4. **Muestra una vista previa** con gráficos de barras, líneas y anillo parecidos a los de Workspace.
5. **Copia la lista de hex** en un clic, en el formato de Workspace.

Incluye una galería de marcas conocidas con su paleta ya generada.

HTML, CSS y JavaScript (módulos ES) sin framework ni build: funciona tal cual en GitHub Pages.

## Estructura

```
index.html
css/styles.css
js/
  config.js          ← constantes: URL del Worker, formato de Workspace, umbrales
  color.js           ← conversiones sRGB/OKLab/OKLCH, contraste, ΔE, daltonismo, parser CSS
  extract-image.js   ← extracción desde imagen (canvas + k-means en OKLab)
  extract-url.js     ← extracción desde URL (HTML + hojas de estilo, vía Worker)
  palette.js         ← generación y validación de la paleta
  charts.js          ← gráficos SVG de vista previa
  app.js             ← interfaz
data/brands.json     ← marcas de la galería
tools/extract-brands.mjs ← ejecuta el extractor sobre las webs de las marcas
worker/              ← proxy CORS para Cloudflare Workers (ver worker/README.md)
```

## Puesta en marcha

### En local

Los módulos ES no funcionan abriendo el archivo con `file://`; hace falta un servidor:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

### En GitHub Pages

Settings → Pages → *Deploy from a branch* → rama y carpeta `/ (root)`. No hay paso de build.

### Extracción desde URL

Necesita el Worker desplegado (instrucciones en [`worker/README.md`](worker/README.md)) y su URL en `js/config.js`:

```js
export const WORKER_URL = 'https://paleta-proxy.<tu-subdominio>.workers.dev';
```

Sin Worker, la extracción desde imagen y la galería funcionan igual.

## Configuración (`js/config.js`)

### Formato de Workspace — **pendiente de verificar**

```js
export const WORKSPACE_FORMAT = {
  maxColors: 20,      // número máximo de colores que acepta la paleta
  separator: ', ',    // separador entre colores
  hashPrefix: true,   // incluir "#"
  uppercase: true,
};
```

Los valores son una suposición: compruébalos en Workspace (Proyecto › Paleta de colores › Personalizada) y ajústalos aquí. El selector de número de colores y la salida se adaptan solos.

### Umbrales de la paleta

| Constante | Valor | Qué controla |
|---|---|---|
| `minDeltaE` | 15 | Distancia mínima entre cualquier par de colores (OKLab ΔE × 100). Por debajo se marca como error. |
| `cvdDeltaE` | 8 | Distancia mínima simulando protanopia, deuteranopia y tritanopia. Por debajo, aviso. |
| `minContrast` | 3 | Contraste WCAG mínimo con el fondo (3:1 para elementos gráficos). |
| `lightness` | 0.43–0.77 | Banda de luminosidad OKLCH de los colores generados. |
| `minChroma` | 0.10 | Croma mínimo de los colores generados (evita grises). |

## Cómo funciona

### Desde imagen

Todo ocurre en el navegador. La imagen se reduce a unos 220 px y se dibuja en un canvas. Se descartan los píxeles transparentes, los neutros (croma OKLCH bajo, casi blancos o casi negros) y los colores que dominan el borde de la imagen (el fondo). Los píxeles que quedan se agrupan con k-means++ en OKLab, se fusionan los grupos casi iguales y se ordenan por presencia, con un pequeño extra para los colores saturados. Admite arrastrar, elegir archivo o pegar con Ctrl+V.

### Desde URL

La página se descarga a través del Worker y se analiza:

- `<meta name="theme-color">` (el peso más alto),
- variables CSS: más peso si el nombre contiene `primary`, `brand`, `accent`, `secondary`, `main`… y algo menos si es `--color-*`,
- bloques `<style>`, atributos `style` y `fill`/`stroke` de los SVG en línea (a menudo el logo),
- hasta 12 hojas de estilo enlazadas (`<link rel="stylesheet">`), también a través del Worker.

Se reconocen `#hex`, `rgb()`, `hsl()` y `oklch()`. Los colores se ordenan por frecuencia ponderada y se descartan blancos, negros y grises. Si la web responde 401, 403, 429 o 503, o devuelve una página de verificación antibots (Cloudflare, Akamai, Imperva, DataDome, PerimeterX, AWS WAF), se muestra un aviso y se propone subir un pantallazo.

### Generación de la paleta

Los colores de marca elegidos (hasta 3) van primero y no se tocan. El resto se escoge de una rejilla de candidatos en OKLCH (tonos cada 6°, varias luminosidades y crómas) que cumplen la banda de luminosidad, el croma mínimo y el contraste con blanco. La selección es voraz: en cada paso se añade el candidato más alejado de los ya elegidos, primero en visión normal y después simulando daltonismo (Machado et al. 2009).

- **Máxima distinción**: usa todo el círculo cromático.
- **Armónica con la marca**: limita los tonos a los cercanos a la marca, sus complementarios y su tríada.

Después se puede reordenar (arrastrando o con las flechas), quitar, cambiar cualquier color (hex o selector), cambiar el número de colores, **Regenerar** desde los colores de marca o **Completar** los huecos sin tocar los actuales. El estado se guarda en la URL (`#p=…`), así que se puede compartir el enlace.

## Galería de marcas

Los datos están en `data/brands.json`:

```json
{
  "id": "ikea",
  "name": "IKEA",
  "url": "https://www.ikea.com/es/es/",
  "colors": ["#0058A3", "#FFDA1A"],
  "status": "pendiente",
  "source": { "type": "agregador", "refs": ["https://…"], "date": "2026-09-27" },
  "alternatives": ["#FBDA0C"],
  "notes": "…"
}
```

- `colors`: colores de marca en orden (máximo 3). La paleta de 8 se genera al cargar con el mismo algoritmo. Si quieres fijarla, añade `"palette": [...]`.
- `status`: `pendiente` o `verificado`. Las pendientes llevan una etiqueta en la galería.
- `source.type`: `extractor` (sacado con el extractor sobre la web), `guia-oficial` o `agregador` (webs de terceros que recopilan colores de marca).

Para añadir una marca, añade un objeto a `brands` con al menos `id`, `name` y `colors`.

### Estado de los datos actuales

**Todas las marcas están como `pendiente`.** El entorno donde se preparó el proyecto no tenía acceso a las webs de las marcas (la red las bloqueaba), así que no se pudo ejecutar el extractor sobre ellas. Los colores actuales salen de fuentes públicas localizadas por búsqueda web (guías de marca oficiales cuando las había; si no, webs que recopilan colores de marca), con las referencias en `source.refs` y las discrepancias en `alternatives` y `notes`.

Para sacarlos con el extractor, desde un ordenador con acceso normal a internet:

```bash
node tools/extract-brands.mjs              # prueba: muestra lo que detecta
node tools/extract-brands.mjs --write      # guarda en data/brands.json
node tools/extract-brands.mjs --only kfc,bbva --write
```

El script usa el mismo código que la web (`js/extract-url.js`), pero sin Worker. Para cada marca guarda los colores detectados en `extracted`. En las que no están verificadas, sustituye `colors` por los 3 primeros detectados y mueve los anteriores a `alternatives`. Las marcas `verificado` no se tocan. Las webs que bloquean la descarga quedan con el error anotado. Revisa el resultado a mano y cambia `status` a `verificado` en las que estén bien.

Prioridad de revisión: Mercadona (las fuentes se contradicen), MediaMarkt, McDonald's y Coca-Cola (varios valores), y CaixaBank e Iberdrola (faltan colores secundarios).
