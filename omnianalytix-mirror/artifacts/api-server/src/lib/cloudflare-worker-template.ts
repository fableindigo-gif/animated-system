export function generateWorkerScript(): string {
  return `
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const PROXY_MAP = {
  '/gtag/': 'https://www.googletagmanager.com/gtag/',
  '/gtm.js': 'https://www.googletagmanager.com/gtm.js',
  '/g/collect': 'https://www.google-analytics.com/g/collect',
  '/j/collect': 'https://www.google-analytics.com/j/collect',
  '/analytics.js': 'https://www.google-analytics.com/analytics.js',
}

async function handleRequest(request) {
  const url = new URL(request.url)
  const path = url.pathname

  let targetBase = null
  let rewritePath = path

  for (const [prefix, upstream] of Object.entries(PROXY_MAP)) {
    if (path.startsWith(prefix) || path === prefix.replace(/\\/$/, '')) {
      const upstreamUrl = new URL(upstream)
      targetBase = upstreamUrl.origin
      rewritePath = upstreamUrl.pathname + path.slice(prefix.replace(/\\/$/, '').length)
      break
    }
  }

  if (!targetBase) {
    return new Response('Not Found', { status: 404 })
  }

  const targetUrl = targetBase + rewritePath + url.search

  const proxyHeaders = new Headers(request.headers)
  proxyHeaders.set('Host', new URL(targetBase).hostname)
  proxyHeaders.delete('Cookie')

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: proxyHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow',
  })

  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('Cache-Control', 'public, max-age=3600, s-maxage=3600')
  responseHeaders.set('X-Tag-Gateway', 'first-party')
  responseHeaders.delete('Set-Cookie')
  responseHeaders.set('Access-Control-Allow-Origin', '*')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}
`.trim();
}
