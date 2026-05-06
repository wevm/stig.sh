/** OG image components — business card style. */

export function OgIndex() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        width: '100%',
        height: '100%',
        background: '#fdfdfd',
        padding: '64px 72px',
        fontFamily: 'CMU Serif',
      }}
    >
      <div
        style={{
          fontSize: '120px',
          fontWeight: 700,
          color: '#111',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        stig
      </div>

      <div
        style={{
          display: 'flex',
          marginTop: '32px',
          fontSize: '28px',
          color: '#555',
          lineHeight: 1.5,
          maxWidth: '800px',
        }}
      >
        Render any GitHub markdown file or gist as a beautiful article.
      </div>
    </div>
  )
}

export function OgCard({ title, source }: { title: string; source: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        width: '100%',
        height: '100%',
        background: '#fdfdfd',
        padding: '64px 72px',
        fontFamily: 'CMU Serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '48px',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          color: '#555',
          fontSize: '26px',
          letterSpacing: '0.03em',
        }}
      >
        stig
      </div>

      <div
        style={{
          fontSize: '52px',
          fontWeight: 700,
          color: '#111',
          lineHeight: 1.2,
          textAlign: 'center',
          maxWidth: '100%',
        }}
      >
        {title}
      </div>

      <div
        style={{
          display: 'flex',
          marginTop: '32px',
          fontSize: '22px',
          color: '#555',
          fontStyle: 'italic',
        }}
      >
        {source}
      </div>
    </div>
  )
}
