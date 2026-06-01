/** Unified pipeline: remark → rehype with Shiki (JS engine) and KaTeX. */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import { createHighlighter, type Highlighter } from 'shiki'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import type { Element, Text } from 'hast'
import * as Source from './Source'

let highlighterPromise: Promise<Highlighter> | null = null
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [
        'bash',
        'c',
        'cpp',
        'css',
        'go',
        'html',
        'java',
        'javascript',
        'jsx',
        'json',
        'markdown',
        'python',
        'rust',
        'solidity',
        'sql',
        'svelte',
        'toml',
        'tsx',
        'typescript',
        'vue',
        'yaml',
      ],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

/**
 * Resolve common code-fence short names to their canonical Shiki language ID.
 * Shiki's `getLoadedLanguages()` returns canonical IDs only — without this
 * map, `js`/`ts`/`sh`/`md` blocks would silently fall back to plain text.
 */
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  py: 'python',
  rs: 'rust',
  sol: 'solidity',
  'c++': 'cpp',
  htm: 'html',
}

function rehypeShiki() {
  return async (tree: import('hast').Root) => {
    const highlighter = await getHighlighter()
    const { visit } = await import('unist-util-visit')

    visit(tree, 'element', (node: Element, index, parent) => {
      if (
        node.tagName !== 'pre' ||
        !node.children[0] ||
        (node.children[0] as Element).tagName !== 'code'
      )
        return

      const codeEl = node.children[0] as Element
      const className = ((codeEl.properties?.className as string[]) ?? []).find((c) =>
        c.startsWith('language-'),
      )
      const lang = className?.replace('language-', '') ?? 'text'
      const code = (codeEl.children[0] as Text)?.value ?? ''

      // Mermaid blocks are rendered client-side. Emit a `<pre class="mermaid">`
      // containing the raw source — the Mermaid component picks them up.
      if (lang === 'mermaid') {
        if (parent && typeof index === 'number') {
          ;(parent.children as unknown[])[index] = {
            type: 'element',
            tagName: 'pre',
            properties: { className: ['mermaid'] },
            children: [{ type: 'text', value: code }],
          }
        }
        return
      }

      const loadedLangs = highlighter.getLoadedLanguages()
      const aliased = LANG_ALIASES[lang.toLowerCase()] ?? lang
      const resolvedLang = loadedLangs.includes(aliased) ? aliased : 'text'

      // Defensive: even with the alias map, an exotic language could slip
      // through and throw. Falling back to plain text keeps the page rendering.
      // Dual-theme output: shiki emits both palettes as CSS variables
      // (`--shiki-light`, `--shiki-dark` and their `*-bg` counterparts) and
      // writes no inline `color` so the page's `[data-color-scheme]` rules
      // (and the `prefers-color-scheme` media query for `light dark`) decide
      // which palette to use. A single cached HTML string serves all schemes.
      let highlighted: string
      try {
        highlighted = highlighter.codeToHtml(code, {
          defaultColor: false,
          lang: resolvedLang,
          themes: { dark: 'github-dark', light: 'github-light' },
        })
      } catch {
        highlighted = highlighter.codeToHtml(code, {
          defaultColor: false,
          lang: 'text',
          themes: { dark: 'github-dark', light: 'github-light' },
        })
      }

      if (parent && typeof index === 'number') {
        ;(parent.children as unknown[])[index] = {
          type: 'raw',
          value: highlighted,
        }
      }
    })
  }
}

/**
 * Strip `<source>` elements that target `prefers-color-scheme: dark` so the
 * `<img>` fallback (light variant) always renders. stig has a fixed light
 * theme — without this, dark-mode users see the dark logo on a light page.
 */
function rehypeStripDarkSources() {
  return async (tree: import('hast').Root) => {
    const { visit } = await import('unist-util-visit')
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'source') return
      const media = (node.properties?.media as string | undefined) ?? ''
      if (!/prefers-color-scheme:\s*dark/i.test(media)) return
      if (parent && typeof index === 'number') {
        ;(parent.children as unknown[]).splice(index, 1)
        return index
      }
    })
  }
}

/**
 * Copy numeric `width` / `height` HTML attributes into inline `style` so they
 * win over Tailwind's preflight (`img { height: auto; max-width: 100% }`),
 * which would otherwise force every image to its intrinsic size.
 */
function rehypeImageDimensions() {
  return async (tree: import('hast').Root) => {
    const { visit } = await import('unist-util-visit')
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'img') return
      const props = node.properties
      if (!props) return
      const styles: string[] = props.style ? [String(props.style).replace(/;?\s*$/, '')] : []
      const numeric = (v: unknown): string | null => {
        if (typeof v === 'number' && Number.isFinite(v)) return `${v}px`
        if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return `${v}px`
        return null
      }
      const w = numeric(props.width)
      const h = numeric(props.height)
      if (w) styles.push(`width: ${w}`)
      if (h) styles.push(`height: ${h}`)
      if (styles.length > 0) props.style = styles.join('; ')
    })
  }
}

/**
 * Rewrite `<a href>` URLs that point to a known GitHub markdown file or gist
 * so they stay inside stig. Absolute URLs are routed via `Source.parse`. If a
 * `context` source is supplied, relative `.md` links are resolved against it.
 */
function rehypeRewriteGithubLinks(opts: { context?: Source.Source } = {}) {
  return async (tree: import('hast').Root) => {
    const { visit } = await import('unist-util-visit')
    const ctx = opts.context

    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties?.href
      if (typeof href !== 'string' || !href) return

      // Absolute URL → try Source.parse, but only rewrite when the target is
      // something stig can actually render (markdown file, gist, or repo
      // README). Avoid hijacking links to LICENSE, /issues, sub-orgs, etc.
      if (/^https?:\/\//i.test(href)) {
        const [base, hash] = href.split('#')
        const parsed = Source.parse(base)
        if (!parsed) return
        if (!isRenderable(parsed)) return
        node.properties!.href = `/${Source.toPath(parsed)}${hash ? `#${hash}` : ''}`
        return
      }

      // Relative link — only rewrite if we know the source repo. Both
      // markdown and non-markdown links get rewritten; the catch-all route
      // renders markdown directly and redirects everything else to GitHub,
      // so the URL stays clean and shareable on stig.
      if (!ctx || (ctx.kind !== 'github' && ctx.kind !== 'repo')) return
      // Skip protocol-relative, mailto:, fragments
      if (/^([a-z]+:|\/\/|#|\?)/i.test(href)) return

      const [rel, hash] = href.split('#')
      const ref = ctx.kind === 'github' ? ctx.ref : 'HEAD'
      const srcDir = ctx.kind === 'github' ? ctx.path.split('/').slice(0, -1).join('/') : '' // repo shorthand → README is at root

      let resolvedPath: string | null
      if (rel.startsWith('/')) {
        // Root-relative within the repo
        resolvedPath = rel.replace(/^\/+/, '')
      } else {
        resolvedPath = resolveRelativePath(srcDir, rel)
      }
      if (!resolvedPath) return

      const target: Source.GitHubSource = {
        kind: 'github',
        owner: ctx.owner,
        repo: ctx.repo,
        ref,
        path: resolvedPath,
      }
      node.properties!.href = `/${Source.toPath(target)}${hash ? `#${hash}` : ''}`
    })
  }
}

/** True if stig can actually render the target (don't hijack LICENSE links etc). */
function isRenderable(s: Source.Source): boolean {
  if (s.kind === 'gist' || s.kind === 'repo') return true
  return Source.isMarkdownPath(s.path)
}

/** Resolve `./foo` / `../bar.md` against a base directory, returning a normalised path. */
function resolveRelativePath(baseDir: string, rel: string): string | null {
  const baseSegs = baseDir ? baseDir.split('/').filter(Boolean) : []
  const relSegs = rel.split('/')
  for (const seg of relSegs) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (baseSegs.length === 0) return null
      baseSegs.pop()
    } else baseSegs.push(seg)
  }
  return baseSegs.join('/')
}

/**
 * Convert GitHub-style alert blockquotes into semantic callout divs:
 *
 *   > [!NOTE]
 *   > body text
 *
 * becomes `<div class="doc-callout doc-callout-note">` with a leading title.
 * Supports NOTE / TIP / IMPORTANT / WARNING / CAUTION.
 */
function rehypeGithubAlerts() {
  const RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:\n|$)/i
  return async (tree: import('hast').Root) => {
    const { visit } = await import('unist-util-visit')
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'blockquote') return

      // First element child should be a <p> whose first text node carries the marker.
      const firstP = node.children.find(
        (c): c is Element => c.type === 'element' && (c as Element).tagName === 'p',
      )
      if (!firstP) return
      const firstChild = firstP.children[0]
      if (!firstChild || firstChild.type !== 'text') return
      const m = (firstChild as Text).value.match(RE)
      if (!m) return
      const type = m[1].toLowerCase()

      // Strip the marker (and the line break that followed it) from the text.
      const remainder = (firstChild as Text).value.slice(m[0].length).replace(/^\n+/, '')
      if (remainder) {
        ;(firstChild as Text).value = remainder
      } else {
        firstP.children.shift()
        if (firstP.children.length === 0) {
          const idx = node.children.indexOf(firstP)
          if (idx >= 0) node.children.splice(idx, 1)
        }
      }

      // Replace the blockquote with a styled callout div.
      node.tagName = 'div'
      node.properties = {
        ...node.properties,
        className: ['doc-callout', `doc-callout-${type}`],
      }
      node.children.unshift({
        type: 'element',
        tagName: 'p',
        properties: { className: ['doc-callout-title'] },
        children: [{ type: 'text', value: type.charAt(0).toUpperCase() + type.slice(1) }],
      })
    })
  }
}

function rehypeHeadingIds() {
  return async (tree: import('hast').Root) => {
    const { visit } = await import('unist-util-visit')
    const seen = new Map<string, number>()
    visit(tree, 'element', (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return
      const text = getTextContent(node)
      const base = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
      if (!base) return
      const count = seen.get(base) ?? 0
      const id = count === 0 ? base : `${base}-${count}`
      seen.set(base, count + 1)
      node.properties = node.properties ?? {}
      node.properties.id = id
      node.properties.className = [
        ...((node.properties.className as string[]) ?? []),
        'heading-anchor',
      ]
      node.children = [
        {
          type: 'element',
          tagName: 'a',
          properties: {
            href: `#${id}`,
            className: ['heading-link'],
            'aria-label': `Link to ${text}`,
          },
          children: node.children,
        },
      ]
    })
  }
}

function getTextContent(node: Element): string {
  let text = ''
  for (const child of node.children) {
    if (child.type === 'text') text += (child as Text).value
    else if (child.type === 'element') text += getTextContent(child as Element)
  }
  return text
}

function isMathExpression(code: string): boolean {
  if (!code.includes('×')) return false
  if (/[{};]|==|!=|=>|->|&&|\|\||\./.test(code)) return false
  if (!/\d/.test(code)) return false
  return true
}

function codeToLatex(code: string): string {
  return code
    .replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (w) => {
      return `\\text{${w.replace(/_/g, '\\_')}}`
    })
    .replace(/×/g, ' \\times ')
    .replace(/(\d),(\d)/g, '$1{,}$2')
}

function preprocess(md: string): string {
  return md
    .replace(/(^|[^\\`])\$(\d)/gm, (_m, pre, digit) => `${pre}\\$${digit}`)
    .replace(/`([^`]+)`/g, (_m, code) => {
      if (isMathExpression(code)) return `$${codeToLatex(code)}$`
      return _m
    })
    .replace(/(?<![`$])(\d+)\^(-?\d+)(?![}`])/g, (_, base, exp) => {
      return `$${base}^{${exp}}$`
    })
}

/** Render markdown to HTML. */
export async function render(
  markdown: string,
  options: { context?: Source.Source } = {},
): Promise<string> {
  const processed = preprocess(markdown)

  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: true })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeShiki)
    .use(rehypeGithubAlerts)
    .use(rehypeHeadingIds)
    .use(rehypeRaw)
    .use(rehypeStripDarkSources)
    .use(rehypeImageDimensions)
    .use(rehypeRewriteGithubLinks, { context: options.context })
    .use(rehypeStringify)
    .process(processed)

  return String(result)
}
