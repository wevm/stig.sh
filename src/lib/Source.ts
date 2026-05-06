/**
 * Parse, normalize and re-encode GitHub markdown source URLs.
 *
 * Two source kinds map onto stig.sh paths via host-swap:
 *
 *   github.com/<owner>/<repo>/blob/<ref>/<path>  ↔  /<owner>/<repo>/blob/<ref>/<path>
 *   gist.github.com/<user>/<id>                  ↔  /<user>/<id>
 *
 * Disambiguation on the stig.sh side is by path shape (gist ids are 20+ hex chars).
 */

export type GitHubSource = {
  kind: 'github'
  owner: string
  repo: string
  ref: string
  path: string
}

/** Shorthand `<owner>/<repo>` — resolves to README.md of default branch. */
export type GitHubRepoSource = {
  kind: 'repo'
  owner: string
  repo: string
}

export type GistSource = {
  kind: 'gist'
  user: string
  id: string
  /** Optional specific filename within the gist. */
  file?: string
}

export type Source = GitHubSource | GitHubRepoSource | GistSource

const GIST_ID_RE = /^[0-9a-f]{20,}$/i

/** Markdown file extensions that stig can render. */
export const MARKDOWN_EXT_RE = /\.(md|mdx|markdown)$/i

/** True when `path` ends with a renderable markdown extension. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXT_RE.test(path)
}

/**
 * github.com path segments that are NOT user/org names. These are top-level
 * site features and should never be treated as `<owner>/<repo>` shorthand.
 */
const RESERVED_GITHUB_PATHS = new Set([
  'about',
  'collections',
  'contact',
  'enterprise',
  'events',
  'explore',
  'features',
  'home',
  'issues',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'signup',
  'site',
  'sponsors',
  'stars',
  'topics',
  'trending',
  'users',
  'watching',
])

/** True if the path segment looks like a gist id (long hex string). */
export function isGistId(s: string): boolean {
  return GIST_ID_RE.test(s)
}

/** Convert a `#file-foo-md` anchor to its filename `foo.md` (best-effort). */
function anchorToFile(anchor: string): string | undefined {
  const m = anchor.match(/^#?file-(.+)$/)
  if (!m) return undefined
  // The fragment replaces dots with dashes. We replace the LAST dash with a
  // dot to recover an extension. Imperfect but covers the common case.
  const name = m[1]
  const idx = name.lastIndexOf('-')
  if (idx < 0) return name
  return name.slice(0, idx) + '.' + name.slice(idx + 1)
}

/**
 * Parse any github.com / gist.github.com / *.githubusercontent.com URL into a
 * `Source`. Also accepts shorthand path forms like `<owner>/<repo>` or
 * `<user>/<gistid>` (with or without a `github.com/` / `gist.github.com/`
 * prefix). Returns null on malformed input.
 */
export function parse(input: string): Source | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // Not a full URL — fall back to stig.sh path parsing, optionally stripping
    // a bare `github.com/` or `gist.github.com/` host prefix.
    const stripped = trimmed
      .replace(/^\/+/, '')
      .replace(/^(?:www\.)?(?:github\.com|gist\.github\.com)\//, '')
    return fromPath(stripped)
  }

  const host = url.hostname.toLowerCase()
  const segs = url.pathname.split('/').filter(Boolean)

  // gist.github.com/<user>/<id>[#file-…]
  if (host === 'gist.github.com') {
    if (segs.length < 2) return null
    const [user, id] = segs
    if (!isGistId(id)) return null
    const file = url.hash ? anchorToFile(url.hash) : undefined
    return { kind: 'gist', user, id, file }
  }

  // gist.githubusercontent.com/<user>/<id>/raw/<commit>/<file>
  if (host === 'gist.githubusercontent.com') {
    if (segs.length < 2) return null
    const [user, id] = segs
    if (!isGistId(id)) return null
    const file = segs[4] ? decodeURIComponent(segs.slice(4).join('/')) : undefined
    return { kind: 'gist', user, id, file }
  }

  // github.com/<owner>/<repo>                                → repo shorthand
  // github.com/<owner>/<repo>/(blob|raw)/<ref>/<path>        → file
  if (host === 'github.com' || host === 'www.github.com') {
    if (segs.length === 2) {
      const [owner, repo] = segs
      if (RESERVED_GITHUB_PATHS.has(owner)) return null
      return { kind: 'repo', owner, repo }
    }
    if (segs.length < 5) return null
    const [owner, repo, kind, ref, ...rest] = segs
    if (kind !== 'blob' && kind !== 'raw') return null
    const path = decodeURIComponent(rest.join('/'))
    if (!path) return null
    return { kind: 'github', owner, repo, ref, path }
  }

  // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
  if (host === 'raw.githubusercontent.com') {
    if (segs.length < 4) return null
    const [owner, repo, ref, ...rest] = segs
    const path = decodeURIComponent(rest.join('/'))
    if (!path) return null
    return { kind: 'github', owner, repo, ref, path }
  }

  return null
}

/** Produce the canonical stig.sh path (no leading slash). */
export function toPath(s: Source): string {
  if (s.kind === 'github') {
    return `${s.owner}/${s.repo}/blob/${encodeURIComponent(s.ref)}/${s.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`
  }
  if (s.kind === 'repo') return `${s.owner}/${s.repo}`
  return s.file ? `${s.user}/${s.id}/${encodeURIComponent(s.file)}` : `${s.user}/${s.id}`
}

/**
 * Parse a stig.sh splat (path without leading slash) back into a Source.
 * Returns null when the path doesn't match any known shape.
 */
export function fromPath(splat: string): Source | null {
  const segs = splat.split('/').filter(Boolean).map(decodeURIComponent)
  if (segs.length < 2) return null

  // 2-segment or 3-segment with a gist-id second segment → gist
  if (isGistId(segs[1])) {
    const [user, id, ...rest] = segs
    return {
      kind: 'gist',
      user,
      id,
      file: rest.length ? rest.join('/') : undefined,
    }
  }

  // <owner>/<repo> shorthand → README of default branch
  if (segs.length === 2) {
    const [owner, repo] = segs
    if (RESERVED_GITHUB_PATHS.has(owner)) return null
    return { kind: 'repo', owner, repo }
  }

  // <owner>/<repo>/blob|raw/<ref>/<path…>
  if (segs.length >= 5 && (segs[2] === 'blob' || segs[2] === 'raw')) {
    const [owner, repo, , ref, ...rest] = segs
    return { kind: 'github', owner, repo, ref, path: rest.join('/') }
  }

  // <owner>/<repo>/<ref>/<path…> (raw shape, no blob keyword) — only if it
  // looks like a markdown file. Avoids false-positives for unrelated URLs.
  if (segs.length >= 4) {
    const [owner, repo, ref, ...rest] = segs
    const path = rest.join('/')
    if (isMarkdownPath(path)) {
      return { kind: 'github', owner, repo, ref, path }
    }
  }

  return null
}

/** Fetchable raw URL for the markdown content. */
export function rawUrl(s: Source): string {
  if (s.kind === 'github') {
    return `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${encodeURIComponent(
      s.ref,
    )}/${s.path.split('/').map(encodeURIComponent).join('/')}`
  }
  if (s.kind === 'repo') return `https://github.com/${s.owner}/${s.repo}`
  // For gists, we resolve the actual file via the API. This is only used for
  // a fallback if the gist API fetch fails.
  return `https://gist.github.com/${s.user}/${s.id}`
}

/** Human-facing GitHub URL for the "View on GitHub" link. */
export function sourceUrl(s: Source): string {
  if (s.kind === 'github') {
    return `https://github.com/${s.owner}/${s.repo}/blob/${encodeURIComponent(s.ref)}/${s.path}`
  }
  if (s.kind === 'repo') return `https://github.com/${s.owner}/${s.repo}`
  const base = `https://gist.github.com/${s.user}/${s.id}`
  return s.file ? `${base}#file-${s.file.replace(/\./g, '-')}` : base
}

/** Short label for the breadcrumb / OG card (e.g. `github.com/foo/bar`). */
export function shortLabel(s: Source): string {
  if (s.kind === 'github' || s.kind === 'repo') return `github.com/${s.owner}/${s.repo}`
  return `gist.github.com/${s.user}`
}
