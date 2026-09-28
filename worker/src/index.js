// Proxy CORS mínimo para Paleta Analítica.
//   GET /?url=https://www.ejemplo.com  →  contenido de esa URL con Access-Control-Allow-Origin
// Solo GET, solo http(s), solo contenido de texto (HTML/CSS), con timeout y límite de tamaño.
// El código de estado de la web de origen se devuelve tal cual y en X-Upstream-Status;
// los errores del propio proxy llevan la cabecera X-Proxy-Error.

const DEFAULTS = {
  TIMEOUT_MS: 10000,
  MAX_BYTES: 3 * 1024 * 1024,
  ALLOWED_ORIGINS: '*', // lista separada por comas, p. ej. "https://usuario.github.io"
  CACHE_TTL: 3600,
};

const ALLOWED_TYPES = /^(text\/|application\/(xhtml\+xml|xml)|$)/i;

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULTS.ALLOWED_ORIGINS).split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'X-Upstream-Status, X-Final-Url, X-Proxy-Error',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function proxyError(request, env, status, code, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8', 'X-Proxy-Error': code },
  });
}

// Evita que se use el proxy contra direcciones internas.
function isForbiddenHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  return false;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method !== 'GET') return proxyError(request, env, 405, 'method', 'Solo se admite GET.');

    const allowed = (env.ALLOWED_ORIGINS || DEFAULTS.ALLOWED_ORIGINS).split(',').map((s) => s.trim());
    const origin = request.headers.get('Origin');
    if (origin && !allowed.includes('*') && !allowed.includes(origin)) {
      return proxyError(request, env, 403, 'origin', 'Origen no permitido.');
    }

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return proxyError(request, env, 400, 'invalid-url', 'Falta el parámetro url o no es válido.'); }
    if (!/^https?:$/.test(url.protocol)) return proxyError(request, env, 400, 'invalid-url', 'Solo se admiten URLs http o https.');
    if (isForbiddenHost(url.hostname)) return proxyError(request, env, 400, 'invalid-url', 'Host no permitido.');

    const timeoutMs = Number(env.TIMEOUT_MS) || DEFAULTS.TIMEOUT_MS;
    const maxBytes = Number(env.MAX_BYTES) || DEFAULTS.MAX_BYTES;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let upstream;
    try {
      upstream = await fetch(url.href, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,text/css,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.7',
        },
        cf: { cacheTtl: Number(env.CACHE_TTL) || DEFAULTS.CACHE_TTL, cacheEverything: true },
      });
    } catch (err) {
      clearTimeout(timer);
      if (ctrl.signal.aborted) return proxyError(request, env, 504, 'timeout', `La web no ha respondido en ${timeoutMs / 1000} s.`);
      return proxyError(request, env, 502, 'fetch', 'No se ha podido descargar la URL.');
    }

    const type = (upstream.headers.get('Content-Type') || '').split(';')[0].trim();
    if (!ALLOWED_TYPES.test(type)) {
      clearTimeout(timer);
      upstream.body?.cancel();
      return proxyError(request, env, 415, 'type', `Tipo de contenido no admitido: ${type}.`);
    }
    const declared = Number(upstream.headers.get('Content-Length'));
    if (declared && declared > maxBytes) {
      clearTimeout(timer);
      upstream.body?.cancel();
      return proxyError(request, env, 413, 'too-large', 'La respuesta supera el tamaño máximo.');
    }

    // Leer el cuerpo con límite de tamaño (Content-Length puede faltar o mentir).
    const chunks = [];
    let size = 0;
    try {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return proxyError(request, env, 413, 'too-large', 'La respuesta supera el tamaño máximo.');
        }
        chunks.push(value);
      }
    } catch {
      if (ctrl.signal.aborted) return proxyError(request, env, 504, 'timeout', `La web no ha respondido en ${timeoutMs / 1000} s.`);
      return proxyError(request, env, 502, 'fetch', 'Error al leer la respuesta.');
    } finally {
      clearTimeout(timer);
    }

    const body = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { body.set(c, offset); offset += c.byteLength; }

    const nullBody = [101, 204, 205, 304].includes(upstream.status);
    return new Response(nullBody ? null : body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(request, env),
        'Content-Type': upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'X-Upstream-Status': String(upstream.status),
        'X-Final-Url': upstream.url || url.href,
        'Cache-Control': 'public, max-age=600',
        'X-Content-Type-Options': 'nosniff',
        // Si alguien abre el proxy directamente en el navegador, la página no ejecuta nada.
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    });
  },
};
