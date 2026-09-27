# Worker proxy (Cloudflare)

El navegador no puede descargar webs de terceros por CORS. Este Worker recibe una URL, la descarga y la devuelve con `Access-Control-Allow-Origin`.

```
GET https://paleta-proxy.<tu-subdominio>.workers.dev/?url=https://www.ejemplo.com
```

- Solo `GET` (y `OPTIONS` para el preflight).
- Solo URLs `http`/`https` y no se permiten hosts internos (`localhost`, IPs privadas…).
- Solo contenido de texto (HTML, CSS, XML). Otros tipos devuelven 415.
- Timeout (`TIMEOUT_MS`, 10 s por defecto → 504) y tamaño máximo (`MAX_BYTES`, 3 MB → 413).
- El código de estado de la web de origen se devuelve tal cual y también en la cabecera `X-Upstream-Status`, para que la web pueda detectar un 403 o una página antibots. Los errores del propio proxy llevan la cabecera `X-Proxy-Error` y un JSON `{ "error": "..." }`.
- Cloudflare cachea las respuestas de origen `CACHE_TTL` segundos (1 h por defecto).

## Desplegar con Wrangler

Necesitas una cuenta de Cloudflare (el plan gratuito basta) y Node 18 o superior.

```bash
cd worker
npx wrangler login          # abre el navegador para autorizar
npx wrangler deploy         # publica el Worker
```

Wrangler muestra la URL publicada, algo como `https://paleta-proxy.<tu-subdominio>.workers.dev`. Ponla en `js/config.js`:

```js
export const WORKER_URL = 'https://paleta-proxy.<tu-subdominio>.workers.dev';
```

### Limitar quién puede usarlo

En `wrangler.toml`, cambia `ALLOWED_ORIGINS` por el dominio de tu GitHub Pages (varios separados por comas) y vuelve a desplegar:

```toml
ALLOWED_ORIGINS = "https://usuario.github.io"
```

Así otras webs no podrán usar tu Worker desde el navegador. Para probar en local añade también `http://localhost:8000`.

### Probar en local

```bash
cd worker
npx wrangler dev            # http://localhost:8787/?url=https://example.com
```

## Limitaciones

Muchas webs grandes (con Cloudflare, Akamai, DataDome…) bloquean las peticiones desde centros de datos y devuelven 403 o una página de verificación. La web lo detecta y propone subir un pantallazo. No se intenta sortear esas protecciones.
