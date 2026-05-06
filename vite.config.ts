import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { defineConfig, type Plugin } from 'vite-plus'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
  },

  plugins: [
    bytesImport(),
    patchSsrCreateRequire(),
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config

/**
 * Cloudflare Workers don't expose a meaningful `import.meta.url` for non-entry
 * chunks. Bundlers emit `var __require = createRequire(import.meta.url)` at
 * the top of helper chunks (notably the one that proxies CJS deps like
 * `langium` pulled in by mermaid), and that line throws at module evaluation
 * because `createRequire(undefined)` rejects.
 *
 * The reachable callers (`__require("util")` etc.) live in chunks that are
 * only loaded by the dynamic `import('mermaid')` inside a `useEffect` — never
 * on the server — so substituting the URL with a harmless literal is safe:
 * the helper chunk loads cleanly, and the never-executed `__require(...)`
 * calls stay never-executed.
 */
function patchSsrCreateRequire(): Plugin {
  return {
    name: 'patch-ssr-createrequire',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue
        if (!file.code.includes('createRequire(import.meta.url)')) continue
        file.code = file.code.replaceAll(
          'createRequire(import.meta.url)',
          'createRequire("file:///worker.js")',
        )
      }
    },
  }
}

/** Vite plugin that resolves `?bytes` imports to inline Uint8Array. */
function bytesImport(): Plugin {
  return {
    name: 'bytes-import',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.endsWith('?bytes')) return
      const filePath = id.slice(0, -6)
      const resolved = importer ? resolve(dirname(importer), filePath) : resolve(filePath)
      return '\0bytes:' + resolved
    },
    load(id) {
      if (!id.startsWith('\0bytes:')) return
      const file = id.slice(7)
      const buf = readFileSync(file)
      return `export default new Uint8Array([${buf.join(',')}]);`
    },
  }
}
