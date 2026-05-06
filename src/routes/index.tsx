import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as Config from '#/lib/Config'
import * as Source from '#/lib/Source'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'stig — render any GitHub markdown file' },
      {
        name: 'description',
        content:
          'Paste any GitHub markdown URL or gist and stig renders it as a beautiful, scientific-paper-style article.',
      },
      { name: 'robots', content: 'index,follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: 'stig — render any GitHub markdown file' },
      {
        property: 'og:description',
        content:
          'Paste any GitHub markdown URL or gist and stig renders it as a beautiful, scientific-paper-style article.',
      },
      { property: 'og:url', content: `${Config.baseUrl}/` },
      { property: 'og:image', content: `${Config.baseUrl}/og/index.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: `${Config.baseUrl}/og/index.png` },
      { name: 'twitter:title', content: 'stig — render any GitHub markdown file' },
    ],
    links: [{ rel: 'canonical', href: `${Config.baseUrl}/` }],
  }),
  component: Index,
})

const examples: Array<{ label: string; url: string }> = [
  {
    label: 'rust-lang/rfcs · async/await',
    url: 'https://github.com/rust-lang/rfcs/blob/master/text/2394-async_await.md',
  },
  {
    label: 'vuejs/rfcs · Composition API',
    url: 'https://github.com/vuejs/rfcs/blob/master/active-rfcs/0013-composition-api.md',
  },
  {
    label: 'ethereum/EIPs · EIP-7702',
    url: 'https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md',
  },
  {
    label: 'reactjs/rfcs · React Hooks',
    url: 'https://github.com/reactjs/rfcs/blob/main/text/0068-react-hooks.md',
  },
]

function Index() {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function go(input: string) {
    setError(null)
    const trimmed = input.trim()
    if (!trimmed) return
    const source = Source.parse(trimmed)
    if (!source) {
      setError('Not a recognised GitHub or gist URL.')
      return
    }
    void navigate({ to: '/$', params: { _splat: Source.toPath(source) } })
  }

  return (
    <main className="doc-article index-page">
      <div className="doc-frontmatter">
        <h1>stig</h1>
        <p>
          Paste any GitHub markdown file or gist URL — get back a clean, scientific-paper-style
          rendering.
        </p>
      </div>

      <div className="doc-body">
        <form
          className="index-form"
          onSubmit={(e) => {
            e.preventDefault()
            go(value)
          }}
        >
          <input
            ref={inputRef}
            className="index-form-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="wevm/curl.md"
            spellCheck={false}
          />
          <button className="index-form-submit" type="submit">
            Render
          </button>
        </form>
        {error && <p className="index-form-error">{error}</p>}

        <h2>How it works</h2>
        <p>
          Take any of the URLs below, replace the host with <code>stig.sh</code>, and you get the
          rendered version. The path stays exactly the same.
        </p>
        <pre className="index-mapping">
          <code>
            <span className="index-mapping-host">github.com</span>
            <span className="index-mapping-path">/foo/bar/blob/main/README.md</span>
            {'\n↓\n'}
            <span className="index-mapping-host">stig.sh</span>
            <span className="index-mapping-path">/foo/bar/blob/main/README.md</span>
            {'\n\n'}
            <span className="index-mapping-host">raw.githubusercontent.com</span>
            <span className="index-mapping-path">/foo/bar/main/x.md</span>
            {'\n↓\n'}
            <span className="index-mapping-host">stig.sh</span>
            <span className="index-mapping-path">/foo/bar/main/x.md</span>
            {'\n\n'}
            <span className="index-mapping-host">gist.github.com</span>
            <span className="index-mapping-path">/alice/abc123…def</span>
            {'\n↓\n'}
            <span className="index-mapping-host">stig.sh</span>
            <span className="index-mapping-path">/alice/abc123…def</span>
          </code>
        </pre>

        <h2>Try one</h2>
        <ul>
          {examples.map((ex) => {
            const source = Source.parse(ex.url)
            if (!source) return null
            return (
              <li key={ex.url}>
                <a
                  href={`/${Source.toPath(source)}`}
                  onClick={(e) => {
                    e.preventDefault()
                    go(ex.url)
                  }}
                >
                  {ex.label}
                </a>
              </li>
            )
          })}
        </ul>

        <h2>Configuration</h2>
        <p>
          Drop a <code>stig.json</code> at the root of your repo (alongside <code>README.md</code>)
          to customize how stig renders your docs. All fields are optional and the file is fetched
          fresh on every render, with no rebuild step.
        </p>

        <table className="index-config">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Default</th>
              <th>Effect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>title</code>
              </td>
              <td>
                <code>string</code>
              </td>
              <td>first H1</td>
              <td>Override the page / OG title</td>
            </tr>
            <tr>
              <td>
                <code>description</code>
              </td>
              <td>
                <code>string</code>
              </td>
              <td>first ~200 chars</td>
              <td>Override the OG / meta description</td>
            </tr>
            <tr>
              <td>
                <code>sidebar</code>
              </td>
              <td>
                <code>{'{text, path}[]'}</code>
              </td>
              <td></td>
              <td>Custom left-margin nav (paths are repo-relative)</td>
            </tr>
          </tbody>
        </table>

        <p>Example:</p>
        <pre>
          <code>{`{
  "title": "My Project",
  "description": "A short tagline for OG cards.",
  "sidebar": [
    { "text": "Introduction", "path": "README.md" },
    { "text": "Setup",        "path": "docs/setup.md" },
    { "text": "API",          "path": "docs/api.md" }
  ]
}`}</code>
        </pre>

        <p>
          Different branches / tags can have different config. stig fetches{' '}
          <code>stig.json</code> at the same ref as the document being rendered. Gists are
          self-describing (their file list becomes the sidebar automatically), so config there is
          ignored.
        </p>
      </div>
    </main>
  )
}
