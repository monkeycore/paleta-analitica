// Configuración de la aplicación. Todo lo que puede necesitar ajustarse está aquí.

// URL del Cloudflare Worker que actúa de proxy CORS (ver worker/README.md).
// Déjala vacía para desactivar la extracción desde URL.
export const WORKER_URL = 'https://paleta-proxy.TU-SUBDOMINIO.workers.dev';

// Formato de la paleta personalizada de Adobe Analytics Workspace.
// PENDIENTE DE VERIFICAR contra Workspace (Proyecto > Paleta de colores > Personalizada).
export const WORKSPACE_FORMAT = {
  maxColors: 20,      // número máximo de colores que acepta la paleta
  separator: ', ',    // separador entre colores
  hashPrefix: true,   // incluir "#" delante de cada hex
  uppercase: true,    // hex en mayúsculas
};

// Parámetros de generación y validación de la paleta.
export const PALETTE_CONFIG = {
  size: 8,                 // colores por defecto
  maxBrandColors: 3,       // colores de marca que se usan como semilla
  // Distancias en OKLab × 100 (umbrales del validador de paletas categóricas).
  minDeltaE: 15,           // mínimo entre cualquier par de colores (visión normal)
  cvdDeltaE: 8,            // mínimo recomendado entre pares simulando daltonismo
  minContrast: 3,          // contraste WCAG mínimo contra el fondo (elementos gráficos)
  background: '#ffffff',   // fondo contra el que se mide el contraste
  lightness: [0.43, 0.77], // banda OKLCH L para los colores generados
  minChroma: 0.10,         // croma OKLCH mínimo de los colores generados
};

// Extracción de colores.
export const EXTRACT_CONFIG = {
  imageMaxSide: 220,       // lado máximo al reducir la imagen antes de agruparla
  kmeansK: 10,
  maxStylesheets: 12,      // hojas de estilo enlazadas que se descargan como máximo
  requestTimeoutMs: 15000,
};
