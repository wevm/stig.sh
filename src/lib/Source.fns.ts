/**
 * Thin TanStack Start server-function wrapper around `fetchDocument`. Route
 * loaders import this module; the bundler strips the handler body in the
 * client build, so the dynamic `import('./Source.fetch')` (and its
 * `cloudflare:workers` dependency) never reaches the browser.
 *
 * Worker-side code (raw `fetch` handlers, OG generator) should import from
 * `./Source.fetch` directly to avoid the AsyncLocalStorage requirement.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type * as Source from './Source'

const SourceSchema = z.union([
  z.object({
    kind: z.literal('github'),
    owner: z.string(),
    repo: z.string(),
    ref: z.string(),
    path: z.string(),
  }),
  z.object({
    kind: z.literal('repo'),
    owner: z.string(),
    repo: z.string(),
  }),
  z.object({
    kind: z.literal('gist'),
    user: z.string(),
    id: z.string(),
    file: z.string().optional(),
  }),
])

export const get = createServerFn({ method: 'POST' })
  .inputValidator(SourceSchema)
  .handler(async ({ data }) => {
    const { fetchDocument } = await import('./Source.fetch')
    return fetchDocument(data as Source.Source)
  })
