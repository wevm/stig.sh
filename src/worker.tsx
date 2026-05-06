import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { ImageResponse } from 'takumi-js/response'
import wasmModule, { initSync, Renderer } from 'takumi-js/wasm'
import { OgCard, OgIndex } from './lib/Og'
import * as Source from './lib/Source'
import * as SourceFetch from './lib/Source.fetch'
// @ts-expect-error bytes import
import cmunrmData from '../public/fonts/cmunrm-clean.ttf?bytes'
// @ts-expect-error bytes import
import cmunbxData from '../public/fonts/cmunbx-clean.ttf?bytes'
// @ts-expect-error bytes import
import cmunslData from '../public/fonts/cmunsl-clean.ttf?bytes'

initSync(wasmModule)
const renderer = new Renderer({
  fonts: [
    { name: 'CMU Serif', data: cmunrmData, weight: 400, style: 'normal' },
    { name: 'CMU Serif', data: cmunbxData, weight: 700, style: 'normal' },
    { name: 'CMU Serif', data: cmunslData, weight: 400, style: 'italic' },
  ],
})

const handler = createStartHandler(defaultStreamHandler)

const ogCacheHeaders = {
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    // /og/index.png → landing-page OG image
    if (url.pathname === '/og/index.png') {
      return new ImageResponse(<OgIndex />, {
        width: 1200,
        height: 630,
        renderer,
        headers: ogCacheHeaders,
      })
    }

    // /og/<encoded-path>.png → per-document OG image
    const ogMatch = url.pathname.match(/^\/og\/(.+)\.png$/)
    if (ogMatch) {
      try {
        const splat = decodeURIComponent(ogMatch[1])
        const source = Source.fromPath(splat)
        if (!source) return new Response('Not found', { status: 404 })

        const cacheKey = `og:png:${splat}`
        const cached = await env.STIG_KV.get(cacheKey, 'arrayBuffer')
        if (cached)
          return new Response(cached, {
            headers: { ...ogCacheHeaders, 'Content-Type': 'image/png' },
          })

        const doc = await SourceFetch.fetchDocument(source)
        const res = new ImageResponse(
          <OgCard title={doc.title} source={Source.shortLabel(source)} />,
          { width: 1200, height: 630, renderer, headers: ogCacheHeaders },
        )

        const buf = await res.clone().arrayBuffer()
        await env.STIG_KV.put(cacheKey, buf, { expirationTtl: 7 * 24 * 60 * 60 })
        return res
      } catch (e) {
        console.error('[og]', e)
        return new Response('OG generation failed', { status: 500 })
      }
    }

    const response = await handler(request)
    if (request.method === 'GET' && response.status === 200) {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400')
      return new Response(response.body, { status: response.status, headers })
    }
    return response
  },
} satisfies ExportedHandler<Env>
