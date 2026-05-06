/**
 * Make images in the document body zoomable on click. Uses the same pan +
 * wheel-zoom modal as Mermaid diagrams.
 *
 * Skips images that:
 *   - Are wrapped in an `<a>` (already a navigation target — typically badges)
 *   - Are smaller than ~200px wide (likely inline icons, not figures)
 */

import { useEffect } from 'react'
import { openZoom } from './Zoom'

const MIN_ZOOMABLE_WIDTH = 200
const MARK = 'data-zoom-bound'

export function ImageZoom({ targetSelector }: { targetSelector: string }) {
  useEffect(() => {
    const root = document.querySelector(targetSelector)
    if (!root) return

    const bind = () => {
      const imgs = root.querySelectorAll<HTMLImageElement>(`img:not([${MARK}])`)
      for (const img of imgs) {
        if (img.closest('a')) {
          img.setAttribute(MARK, 'skip')
          continue
        }

        // For natural-size detection we may need to wait for load.
        const attach = () => {
          const w = img.naturalWidth || img.width
          if (w < MIN_ZOOMABLE_WIDTH) {
            img.setAttribute(MARK, 'skip')
            return
          }
          img.setAttribute(MARK, 'true')
          img.classList.add('doc-image-zoomable')
          img.title = 'Click to expand'
          img.addEventListener('click', () => {
            openZoom({ kind: 'image', src: img.currentSrc || img.src, alt: img.alt })
          })
        }

        if (img.complete && img.naturalWidth > 0) attach()
        else img.addEventListener('load', attach, { once: true })
      }
    }

    bind()
    const obs = new MutationObserver(bind)
    obs.observe(root, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [targetSelector])

  return null
}
