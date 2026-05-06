/** Server functions for fetching and rendering a Source. */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import * as Markdown from './Markdown'
import * as Source from './Source'
import * as StigConfig from './StigConfig'

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

/**
 * A single sidebar entry. Used for both multi-file gists (auto-generated from
 * file list) and github/repo sources (driven by `stig.json`'s `sidebar`).
 */
export type Sibling = {
  /** Display text — filename for gists, custom label from `stig.json` for repos. */
  text: string
  /** Whether this entry is the one currently being rendered. */
  current: boolean
  /** Internal stig.sh path. */
  path: string
}

export type Document = {
  source: Source.Source
  /** Resolved filename being rendered (mostly relevant for gists). */
  filename: string
  /** Markdown content. */
  content: string
  /** Rendered HTML. */
  html: string
  /** Title — config override > first H1 > gist description > filename. */
  title: string
  /** Plain-text description (first ~160 chars), or config override. */
  description: string
  /** Resolved commit SHA (used for cache key + display). */
  sha: string
  /** Human-facing source URL. */
  sourceUrl: string
  /** ISO date of the most recent change to this document. */
  date: string | null
  /** Sidebar entries (gist siblings or repo `stig.json` sidebar). */
  siblings: Sibling[] | null
}

async function kv(): Promise<KVNamespace> {
  const { env } = await import('cloudflare:workers')
  return env.STIG_KV
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'stig',
  }
  // GITHUB_TOKEN is optional; without it we are limited to 60 req/h per IP.
  // Read it lazily so this module also works at build time.
  return h
}

async function withToken(headers: Record<string, string>): Promise<Record<string, string>> {
  try {
    const { env } = await import('cloudflare:workers')
    const token = (env as unknown as { GITHUB_TOKEN?: string }).GITHUB_TOKEN
    if (token) return { ...headers, Authorization: `Bearer ${token}` }
  } catch {}
  return headers
}

/**
 * Common shape returned by every fetcher. Gist-only fields default to null
 * for the github / repo paths so the call site never needs a cast.
 */
type Fetched = {
  content: string
  sha: string
  filename: string
  date: string | null
  description: string | null
  siblings: Sibling[] | null
}

/** Fetch a markdown file from GitHub via the contents API (gives us SHA + content in one call). */
async function fetchGithub(s: Source.GitHubSource): Promise<Fetched> {
  const path = s.path.split('/').map(encodeURIComponent).join('/')
  const ref = encodeURIComponent(s.ref)
  const headers = await withToken(ghHeaders())

  const [contentRes, commitRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}?ref=${ref}`, {
      headers,
    }),
    fetch(
      `https://api.github.com/repos/${s.owner}/${s.repo}/commits?path=${path}&sha=${ref}&per_page=1`,
      { headers },
    ),
  ])

  if (!contentRes.ok) {
    if (contentRes.status === 404)
      throw new Error(`File not found on GitHub: ${s.owner}/${s.repo}@${s.ref}/${s.path}`)
    throw new Error(`GitHub API error (${contentRes.status}) fetching ${s.path}`)
  }
  const data = (await contentRes.json()) as {
    content?: string
    encoding?: string
    sha: string
    name: string
  }
  if (!data.content || data.encoding !== 'base64')
    throw new Error('Unexpected GitHub response shape')

  let date: string | null = null
  if (commitRes.ok) {
    const commits = (await commitRes.json()) as Array<{
      commit?: { committer?: { date?: string } }
    }>
    date = commits[0]?.commit?.committer?.date ?? null
  }

  const binary = atob(data.content.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return {
    content: new TextDecoder('utf-8').decode(bytes),
    sha: data.sha,
    filename: data.name,
    date,
    description: null,
    siblings: null,
  }
}

/** Fetch a repo's README from its default branch. */
async function fetchRepo(s: Source.GitHubRepoSource): Promise<Fetched> {
  const headers = await withToken(ghHeaders())
  const res = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}/readme`, {
    headers,
  })
  if (!res.ok) {
    if (res.status === 404) throw new Error(`No README found in ${s.owner}/${s.repo}`)
    throw new Error(`GitHub API error (${res.status}) fetching repo README`)
  }
  const data = (await res.json()) as {
    content?: string
    encoding?: string
    sha: string
    name: string
    path: string
  }
  if (!data.content || data.encoding !== 'base64')
    throw new Error('Unexpected GitHub response shape')

  // Look up the most recent commit affecting the README path.
  let date: string | null = null
  const commitRes = await fetch(
    `https://api.github.com/repos/${s.owner}/${s.repo}/commits?path=${data.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}&per_page=1`,
    { headers },
  )
  if (commitRes.ok) {
    const commits = (await commitRes.json()) as Array<{
      commit?: { committer?: { date?: string } }
    }>
    date = commits[0]?.commit?.committer?.date ?? null
  }

  const binary = atob(data.content.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return {
    content: new TextDecoder('utf-8').decode(bytes),
    sha: data.sha,
    filename: data.name,
    date,
    description: null,
    siblings: null,
  }
}

/** Fetch a gist via the gists API (returns selected file + sibling list). */
async function fetchGist(s: Source.GistSource): Promise<Fetched> {
  const url = `https://api.github.com/gists/${s.id}`
  const headers = await withToken(ghHeaders())
  const res = await fetch(url, { headers })
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Gist not found: ${s.user}/${s.id}`)
    throw new Error(`GitHub API error (${res.status}) fetching gist`)
  }
  const data = (await res.json()) as {
    history: Array<{ version: string; committed_at?: string }>
    files: Record<string, { filename: string; content: string; language: string | null }>
    updated_at?: string
    description?: string | null
  }
  const sha = data.history?.[0]?.version ?? 'unknown'
  const date = data.history?.[0]?.committed_at ?? data.updated_at ?? null
  const description = (data.description ?? '').trim() || null

  const files = Object.values(data.files)
  if (files.length === 0) throw new Error('Gist has no files')

  // Pick the file to render: explicit > first markdown > first file.
  const picked = (() => {
    if (s.file) {
      const exact = files.find((f) => f.filename === s.file)
      if (!exact) throw new Error(`File "${s.file}" not found in gist`)
      return exact
    }
    return files.find((f) => Source.isMarkdownPath(f.filename)) ?? files[0]
  })()

  // Only renderable (markdown) files appear in the sidebar — preserved in API
  // (authored) order. Non-markdown files in a gist are unrenderable here, so
  // listing them would produce dead links.
  const markdownFiles = files.filter((f) => Source.isMarkdownPath(f.filename))
  const siblings: Sibling[] | null =
    markdownFiles.length > 1
      ? markdownFiles.map((f) => ({
          text: f.filename,
          current: f.filename === picked.filename,
          path: `/${s.user}/${s.id}/${encodeURIComponent(f.filename)}`,
        }))
      : null

  return {
    content: picked.content,
    sha,
    filename: picked.filename,
    date,
    description,
    siblings,
  }
}

/** Strip non-text from HTML for OG/meta description. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalise CRLF → LF so all our regexes can use \n cleanly. */
function normalize(md: string): string {
  return md.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** Strip the most common markdown inline syntax to plain text. */
function plainifyMarkdown(s: string): string {
  return (
    s
      // ![alt](url) → '' (drop image syntax entirely; alt text is rarely the title)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // `code` → code
      .replace(/`([^`]+)`/g, '$1')
      // **bold** / __bold__ → bold
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      // *em* / _em_ → em
      .replace(/(\*|_)(.+?)\1/g, '$2')
      // HTML entities used as separators (&middot;, &mdash;, &nbsp;)
      .replace(/&middot;|&bull;|&mdash;|&ndash;/gi, '·')
      .replace(/&nbsp;/gi, ' ')
      // Inline HTML tags
      .replace(/<[^>]+>/g, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Replace the contents of fenced code blocks (```/~~~) with blank lines.
 * Preserves line numbering so anchored regexes still match. Without this,
 * a `# heading` inside a shell example would be misread as the document H1.
 */
function blankFencedCode(md: string): string {
  return md.replace(/^([ \t]{0,3})(```+|~~~+)[^\n]*\n([\s\S]*?)(?:^\1\2[ \t]*$|\z)/gm, (m) =>
    m.replace(/[^\n]/g, ''),
  )
}

/** Extract the first markdown H1's text content (atx `# …` or setext underlined). */
function extractTitleFromMarkdown(md: string): string | null {
  const normalized = blankFencedCode(normalize(md))
  // Skip optional YAML frontmatter
  const body = normalized.replace(/^---\n[\s\S]*?\n---\n*/, '')
  // Skip leading whitespace/HTML comments
  const trimmed = body.replace(/^(?:\s|<!--[\s\S]*?-->)*/, '')

  let raw: string | null = null
  // ATX: `# Title`
  const atx = trimmed.match(/^# +(.+?)\s*#*\s*$/m)
  if (atx) raw = atx[1]
  else {
    // Setext: `Title\n====`
    const setext = trimmed.match(/^([^\n]+)\n=+\s*$/m)
    if (setext) raw = setext[1]
  }
  if (!raw) return null

  // The H1 line may contain trailing badges/links separated by `·` or `|`.
  // Keep only the segment before any such separator, then plainify.
  const head = raw.split(/\s+(?:·|·|&middot;|&bull;|\||—|–)\s+/)[0] ?? raw
  const plain = plainifyMarkdown(head)
  return plain || plainifyMarkdown(raw) || null
}

/**
 * Strip the leading H1 (and any preceding YAML frontmatter) from the markdown
 * so the title isn't repeated below the frontmatter we render ourselves.
 */
function stripLeadingTitle(md: string): string {
  let body = normalize(md).replace(/^---\n[\s\S]*?\n---\n*/, '')
  // Strip a leading ATX H1 if present
  body = body.replace(/^(?:\s|<!--[\s\S]*?-->\s*)*# +.+\n+/, '')
  // Strip a setext H1 if present (Title\n====\n)
  body = body.replace(/^[^\n]+\n=+\s*\n+/, '')
  return body
}

const TYPE_KEY = 'doc:html'
const TYPE_VERSION = 'v17'

function fetchSource(source: Source.Source): Promise<Fetched> {
  switch (source.kind) {
    case 'github':
      return fetchGithub(source)
    case 'repo':
      return fetchRepo(source)
    case 'gist':
      return fetchGist(source)
  }
}

function cacheIdentity(source: Source.Source, filename: string): string {
  switch (source.kind) {
    case 'github':
      return `${source.owner}/${source.repo}/${source.path}`
    case 'repo':
      return `${source.owner}/${source.repo}/${filename}`
    case 'gist':
      return `${source.id}/${filename}`
  }
}

/**
 * Build sidebar siblings from a `stig.json` `sidebar`. For github/repo sources
 * the sidebar paths are repo-relative; we resolve them through `Source.toPath`
 * so the resulting links match the canonical stig route shape.
 */
function siblingsFromConfig(
  source: Source.Source,
  config: StigConfig.StigConfig | null,
  currentPath: string,
): Sibling[] | null {
  if (!config?.sidebar || config.sidebar.length === 0) return null
  if (source.kind === 'gist') return null

  const ref = source.kind === 'github' ? source.ref : 'HEAD'
  return config.sidebar.map((entry) => {
    const target: Source.GitHubSource = {
      kind: 'github',
      owner: source.owner,
      repo: source.repo,
      ref,
      path: entry.path,
    }
    return {
      text: entry.text,
      current: entry.path === currentPath,
      path: `/${Source.toPath(target)}`,
    }
  })
}

/** Fetch + render the document, with KV caching keyed by source SHA. */
export const get = createServerFn({ method: 'POST' })
  .inputValidator(SourceSchema)
  .handler(async ({ data }) => {
    const source = data as Source.Source

    // Fetch the document and its `stig.json` (when applicable) in parallel.
    // Config fetch failures never block the doc — `fetchForRepo` returns null
    // on any error, so a missing/broken config just falls back to defaults.
    const headers = await withToken(ghHeaders())
    const configPromise: Promise<StigConfig.StigConfig | null> =
      source.kind === 'github'
        ? StigConfig.fetchForRepo({ owner: source.owner, repo: source.repo, ref: source.ref }, headers)
        : source.kind === 'repo'
          ? StigConfig.fetchForRepo({ owner: source.owner, repo: source.repo, ref: 'HEAD' }, headers)
          : Promise.resolve(null)

    const [fetched, config] = await Promise.all([fetchSource(source), configPromise])

    const title =
      config?.title ??
      extractTitleFromMarkdown(fetched.content) ??
      fetched.description ??
      fetched.filename

    const cacheKey = [
      TYPE_KEY,
      source.kind,
      cacheIdentity(source, fetched.filename),
      fetched.sha,
      TYPE_VERSION,
    ].join(':')

    const store = await kv()
    let html = (await store.get(cacheKey)) ?? null
    if (!html) {
      const body = stripLeadingTitle(fetched.content)
      html = await Markdown.render(body, { context: source })
      await store.put(cacheKey, html, { expirationTtl: 7 * 24 * 60 * 60 })
    }

    const description = config?.description ?? stripHtml(html).slice(0, 200)

    // Config-driven sidebar takes precedence over auto-generated gist siblings
    // (gists won't have config but the precedence is well-defined either way).
    const currentRepoPath = source.kind === 'github' ? source.path : fetched.filename
    const siblings = siblingsFromConfig(source, config, currentRepoPath) ?? fetched.siblings

    return {
      source,
      filename: fetched.filename,
      content: fetched.content,
      html,
      title,
      description,
      sha: fetched.sha,
      sourceUrl: Source.sourceUrl(source),
      date: fetched.date,
      siblings,
    } satisfies Document
  })
