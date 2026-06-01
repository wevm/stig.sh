import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { lazy, Suspense } from 'react'

import appCss from '../styles.css?url'

const DevTools = import.meta.env.DEV
  ? lazy(async () => {
      // Load both panels in parallel — sequential awaits would create a
      // request waterfall (`async-parallel`).
      const [mod, routerMod] = await Promise.all([
        import('@tanstack/react-devtools'),
        import('@tanstack/react-router-devtools'),
      ])
      return {
        default: () => (
          <mod.TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <routerMod.TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ),
      }
    })
  : null

/**
 * Synchronously apply `data-theme` / `data-scheme` from URL search params
 * BEFORE first paint, so pages loaded with e.g. `?theme=system-ui` don't
 * flash the default scientific theme and then swap fonts after hydration.
 *
 * stig.json-driven defaults still arrive after the loader resolves and are
 * applied in the route's `useEffect`, but those rarely diverge from the
 * built-in defaults so the flash there is negligible.
 */
const initThemeScript = `(function(){try{
  var p=new URLSearchParams(location.search);
  var t=p.get('theme'),s=p.get('scheme');
  var r=document.documentElement;
  if(t==='geist'||t==='scientific')r.dataset.theme=t;
  if(s==='dark'||s==='light'||s==='light dark')r.dataset.scheme=s;
}catch(_){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'stig' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'stylesheet', href: appCss },
      // Preload the two CMU weights used for nearly all body + heading text
      // in the scientific theme. With `font-display: optional` (in
      // styles.css), the font has ~100ms after first paint to be available
      // before the page commits to the serif fallback for the session —
      // preloading wins that race. Applied at the root so the index page
      // gets the custom font too.
      {
        rel: 'preload',
        href: '/fonts/cmunrm.ttf',
        as: 'font',
        type: 'font/ttf',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: '/fonts/cmunbx.ttf',
        as: 'font',
        type: 'font/ttf',
        crossOrigin: 'anonymous',
      },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      // Geist + Geist Mono — only used by `?theme=geist`, but loaded
      // unconditionally so theme overrides apply without a font swap on
      // first paint. `display=swap` (rather than `optional`) ensures Geist
      // renders even on a cold first paint.
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap',
      },
      // JetBrains Mono — used by the scientific theme for code blocks.
      // Stays on `optional` to avoid the late code-block font swap.
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=optional',
      },
    ],
    scripts: [{ children: initThemeScript }],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  return (
    <NuqsAdapter>
      <Outlet />
    </NuqsAdapter>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {DevTools && (
          <Suspense>
            <DevTools />
          </Suspense>
        )}
        <Scripts />
      </body>
    </html>
  )
}
