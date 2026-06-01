import { createFileRoute, Link, notFound, redirect } from '@tanstack/react-router'
import { parseAsBoolean, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useEffect, useMemo, useState } from 'react'
import * as Config from '#/lib/Config'
import { Highlights } from '#/lib/Highlights'
import { ImageZoom } from '#/lib/ImageZoom'
import { Mermaid } from '#/lib/Mermaid'
import * as Source from '#/lib/Source'
import * as SourceFns from '#/lib/Source.fns'
import type { Scheme, Theme } from '#/lib/StigConfig'

const schemeParser = parseAsStringLiteral(['dark', 'light', 'light dark'] as const)
const themeParser = parseAsStringLiteral(['geist', 'scientific'] as const)

export const Route = createFileRoute('/$')({
  loader: async ({ params }) => {
    const splat = params._splat ?? ''
    const source = Source.fromPath(splat)
    if (!source) throw notFound()
    // For github file paths that aren't markdown (LICENSE, source files, etc.)
    // redirect to the canonical github.com URL — stig only renders markdown.
    if (source.kind === 'github' && !Source.isMarkdownPath(source.path)) {
      throw redirect({ href: Source.sourceUrl(source) })
    }
    // Same rule for explicit gist files: a non-markdown file in a gist is
    // unrenderable here, so send users to view it on github.com.
    if (source.kind === 'gist' && source.file && !Source.isMarkdownPath(source.file)) {
      throw redirect({ href: Source.sourceUrl(source) })
    }
    const doc = await SourceFns.get({ data: source })
    return doc
  },
  head: ({ loaderData }) => {
    const doc = loaderData
    if (!doc) return { meta: [] }
    const url = `${Config.baseUrl}/${Source.toPath(doc.source)}`
    const ogPath = `/og/${encodeURIComponent(Source.toPath(doc.source))}.png`
    return {
      meta: [
        { title: doc.title },
        { name: 'description', content: doc.description.slice(0, 160) },
        { property: 'og:type', content: 'article' },
        { property: 'og:title', content: doc.title },
        { property: 'og:description', content: doc.description.slice(0, 160) },
        { property: 'og:url', content: url },
        { property: 'og:image', content: `${Config.baseUrl}${ogPath}` },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: `${Config.baseUrl}${ogPath}` },
      ],
      // Font preloads + Google Fonts links live in `__root.tsx` so the
      // index page also gets them. Doc page only adds doc-specific links.
      links: [
        { rel: 'canonical', href: url },
        {
          rel: 'stylesheet',
          href: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
        },
      ],
    }
  },
  component: DocPage,
  notFoundComponent: NotFound,
  errorComponent: ErrorView,
})

function DocPage() {
  const doc = Route.useLoaderData()
  const headings = useMemo(() => extractHeadings(doc.html), [doc.html])

  // Search params override `stig.json`, which overrides the built-in defaults.
  // `null` from nuqs means the param wasn't set — fall through to config/default.
  const [headerParam] = useQueryState('header', parseAsBoolean)
  const [schemeParam] = useQueryState('scheme', schemeParser)
  const [themeParam] = useQueryState('theme', themeParser)
  const [tocParam] = useQueryState('toc', parseAsBoolean)

  // `'light dark'` honours the user's `prefers-color-scheme` (CSS-driven).
  const scheme: Scheme = schemeParam ?? doc.scheme ?? 'light dark'
  const showHeader = headerParam ?? doc.header ?? true
  const showToc = tocParam ?? doc.toc ?? true
  const theme: Theme = themeParam ?? doc.theme ?? 'scientific'

  useEffect(() => {
    const root = document.documentElement
    const previousScheme = root.dataset.scheme
    const previousTheme = root.dataset.theme
    root.dataset.scheme = scheme
    root.dataset.theme = theme
    return () => {
      if (previousScheme === undefined) delete root.dataset.scheme
      else root.dataset.scheme = previousScheme
      if (previousTheme === undefined) delete root.dataset.theme
      else root.dataset.theme = previousTheme
    }
  }, [scheme, theme])

  return (
    <div className="doc-layout">
      <FileList files={doc.siblings} />
      <main className="doc-article">
        <article>
          {showHeader && (
            <header className="doc-frontmatter">
              <h1>{doc.title}</h1>
              <p style={{ fontSize: '0.85em' }}>
                {doc.date && <span>{formatDate(doc.date)}</span>}
                {doc.date && ' · '}
                <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
                  View on GitHub
                </a>
              </p>
            </header>
          )}

          <div className="doc-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </article>
      </main>
      {showToc && <TableOfContents headings={headings} />}
      <Highlights targetSelector=".doc-body" />
      <Mermaid targetSelector=".doc-body" />
      <ImageZoom targetSelector=".doc-body" />
    </div>
  )
}

function NotFound() {
  return (
    <main className="doc-article">
      <div className="doc-frontmatter">
        <h1>Not found</h1>
        <p>That URL doesn't look like a GitHub markdown file or gist we can render.</p>
      </div>
      <div className="doc-body">
        <p>
          <Link to="/">← back to stig</Link>
        </p>
      </div>
    </main>
  )
}

function ErrorView({ error }: { error: Error }) {
  return (
    <main className="doc-article">
      <div className="doc-frontmatter">
        <h1>Couldn't render</h1>
        <p>{error.message}</p>
      </div>
      <div className="doc-body">
        <p>
          <Link to="/">← back to stig</Link>
        </p>
      </div>
    </main>
  )
}

type Sibling = { current: boolean; path: string; text: string }

function FileList({ files }: { files: Sibling[] | null }) {
  if (!files || files.length < 2) return null
  return (
    <aside className="doc-files" aria-label="Sidebar">
      <div className="doc-files-inner">
        <p className="doc-files-title">Contents</p>
        <ol className="doc-files-list">
          {files.map((f) => (
            <li key={f.path} className={`doc-files-item${f.current ? ' is-active' : ''}`}>
              <Link to={f.path} title={f.text}>
                {f.text}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

type Heading = { id: string; text: string; level: number }
type NumberedHeading = Heading & { number: string }

// Hoisted regexes — created once per module load instead of per call.
const HEADING_RE = /<h([23])\s+[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g
const TAG_RE = /<[^>]+>/g
const WS_RE = /\s+/g

function extractHeadings(html: string): Heading[] {
  const out: Heading[] = []
  for (const m of html.matchAll(HEADING_RE)) {
    const text = m[3].replace(TAG_RE, '').replace(WS_RE, ' ').trim()
    if (!text) continue
    out.push({ id: m[2], text, level: Number(m[1]) })
  }
  return out
}

function numberHeadings(headings: Heading[]): NumberedHeading[] {
  let h2Index = 0
  let h3Index = 0
  return headings.map((h) => {
    if (h.level === 2) {
      h2Index += 1
      h3Index = 0
      return { ...h, number: `${h2Index}` }
    }
    h3Index += 1
    return { ...h, number: `${h2Index}.${h3Index}` }
  })
}

function TableOfContents({ headings }: { headings: Heading[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const numbered = useMemo(() => numberHeadings(headings), [headings])

  useEffect(() => {
    if (headings.length === 0) return

    const update = () => {
      const offset = 120
      const scrollBottom = window.scrollY + window.innerHeight
      if (scrollBottom >= document.documentElement.scrollHeight - 4) {
        setActiveId(headings[headings.length - 1].id)
        return
      }
      let current: string | null = null
      for (const h of headings) {
        const el = document.getElementById(h.id)
        if (!el) continue
        if (el.getBoundingClientRect().top - offset <= 0) current = h.id
        else break
      }
      setActiveId(current ?? headings[0].id)
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [headings])

  if (headings.length < 2) return null

  return (
    <aside className="doc-toc" aria-label="Table of contents">
      <div className="doc-toc-inner">
        <p className="doc-toc-title">Contents</p>
        <ol className="doc-toc-list">
          {numbered.map((h) => (
            <li
              key={h.id}
              className={`doc-toc-item doc-toc-l${h.level}${activeId === h.id ? ' is-active' : ''}`}
            >
              <a href={`#${h.id}`}>
                <span className="doc-toc-num">{h.number}</span>
                <span className="doc-toc-text">{h.text}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
