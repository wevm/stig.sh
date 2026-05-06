/**
 * `stig.json` — optional per-repo configuration consumed at render time.
 *
 * Lives at the repo root and travels with the source ref, so different
 * branches/tags/commits can have different config. Only loaded for `github`
 * and `repo` sources — gists are already self-describing via siblings.
 *
 * All fields are optional. Unknown fields are ignored (forward-compatible).
 */

export type SidebarEntry = {
  /** Display text shown in the sidebar. */
  text: string
  /** Repo-relative path to a markdown file (e.g. `docs/setup.md`). */
  path: string
}

export type StigConfig = {
  /** Override the page/OG title. Defaults to the first H1 in the document. */
  title?: string
  /** Override the OG/meta description. Defaults to the first ~200 chars of the rendered content. */
  description?: string
  /** Explicit sidebar entries. Repo-only (gists list siblings automatically). */
  sidebar?: SidebarEntry[]
}

/**
 * Tolerant validator. Returns null for non-objects so a malformed `stig.json`
 * never breaks the page — we just fall back to the implicit defaults.
 */
export function parse(value: unknown): StigConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const out: StigConfig = {}

  if (typeof v.title === 'string' && v.title.trim()) out.title = v.title.trim()
  if (typeof v.description === 'string' && v.description.trim())
    out.description = v.description.trim()

  if (Array.isArray(v.sidebar)) {
    const sidebar: SidebarEntry[] = []
    for (const raw of v.sidebar) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Record<string, unknown>
      const text = typeof entry.text === 'string' ? entry.text.trim() : ''
      const path = typeof entry.path === 'string' ? entry.path.trim() : ''
      if (!text || !path) continue
      sidebar.push({ text, path: path.replace(/^\/+/, '') })
    }
    if (sidebar.length > 0) out.sidebar = sidebar
  }

  return out
}

const CONFIG_PATH = 'stig.json'

/**
 * Fetch `stig.json` from a github repo at a given ref. Returns null if the
 * file is absent or can't be parsed — never throws. Errors here must not
 * fail the document render.
 */
export async function fetchForRepo(
  args: { owner: string; repo: string; ref: string },
  headers: Record<string, string>,
): Promise<StigConfig | null> {
  const { owner, repo, ref } = args

  // ── Local dev override ─────────────────────────────────────────────────
  // Uncomment to inject a fixture for any repo while iterating locally,
  // skipping the network round-trip. Remove before deploying.
  //
  // if (import.meta.env.DEV) {
  //   return parse({
  //     title: 'Local stig.json fixture',
  //     sidebar: [
  //       { text: 'README', path: 'README.md' },
  //       { text: 'Tasks', path: 'tasks/index.md' },
  //     ],
  //   })
  // }
  // ───────────────────────────────────────────────────────────────────────

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${CONFIG_PATH}?ref=${encodeURIComponent(
    ref,
  )}`
  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch {
    return null
  }
  if (!res.ok) return null

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return null
  }
  if (!body || typeof body !== 'object') return null
  const data = body as { content?: string; encoding?: string }
  if (!data.content || data.encoding !== 'base64') return null

  let json: unknown
  try {
    const binary = atob(data.content.replace(/\n/g, ''))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    json = JSON.parse(new TextDecoder('utf-8').decode(bytes))
  } catch {
    return null
  }

  return parse(json)
}
