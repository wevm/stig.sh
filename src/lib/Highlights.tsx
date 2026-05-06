/**
 * Persistent text highlights synced to URL search params (`?h=...`).
 *
 * - Walks text nodes inside the target element to compute character offsets.
 * - Renders highlights via the CSS Custom Highlight API (`::highlight(...)`).
 * - Selecting text auto-adds a highlight; selecting it again toggles it off
 *   (symmetric-difference / XOR semantics).
 */

import { useEffect, useRef } from 'react'
import { useQueryState, createParser } from 'nuqs'

type Range2 = [number, number]
type TextNodeEntry = { node: Text; start: number; end: number }

const parseAsRanges = createParser<Range2[]>({
  parse: (v) => {
    if (!v) return []
    const out: Range2[] = []
    for (const segment of v.split(',')) {
      const parts = segment.split('-')
      if (parts.length !== 2) continue
      const a = Number(parts[0])
      const b = Number(parts[1])
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue
      out.push([a, b])
    }
    return out
  },
  serialize: (v) =>
    v
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
      .map(([a, b]) => `${a}-${b}`)
      .join(','),
  eq: (a, b) => a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]),
})

function queryRoot(targetSelector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(targetSelector)
}

export function Highlights({ targetSelector }: { targetSelector: string }) {
  const [ranges, setRanges] = useQueryState('h', parseAsRanges.withDefault([]))
  const rangesRef = useRef(ranges)
  const didScrollRef = useRef(false)

  // Keep the ref in sync without mutating during render.
  useEffect(() => {
    rangesRef.current = ranges
  }, [ranges])

  // Apply highlights via CSS Custom Highlight API.
  // Splits responsibilities: this effect re-applies whenever ranges change OR
  // the DOM mutates underneath us. The MutationObserver itself is only
  // (re)created when the target element changes — not on every range edit.
  useEffect(() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
    const root = queryRoot(targetSelector)
    if (!root) return

    const apply = () => {
      const nodes = getTextNodes(root)
      const liveRanges: Range[] = []
      for (const [start, end] of rangesRef.current) {
        const r = offsetsToRange(start, end, nodes)
        if (r) liveRanges.push(r)
      }
      if (liveRanges.length === 0) {
        CSS.highlights.delete('user-highlight')
      } else {
        CSS.highlights.set('user-highlight', new Highlight(...liveRanges))
      }
    }

    apply()
    const obs = new MutationObserver(apply)
    obs.observe(root, { childList: true, subtree: true, characterData: true })
    return () => obs.disconnect()
  }, [ranges, targetSelector])

  // Scroll to the first highlight on initial load.
  useEffect(() => {
    if (didScrollRef.current) return
    if (ranges.length === 0) return
    const root = queryRoot(targetSelector)
    if (!root) return
    const first = ranges[0]
    const range = offsetsToRange(first[0], first[1], getTextNodes(root))
    if (!range) return
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return
    didScrollRef.current = true
    const top = window.scrollY + rect.top - window.innerHeight / 3
    window.scrollTo({ top, behavior: 'smooth' })
  }, [ranges, targetSelector])

  // Toggle highlight on selection commit.
  useEffect(() => {
    const root = queryRoot(targetSelector)
    if (!root) return

    const commit = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
      const offsets = rangeToOffsets(range, getTextNodes(root))
      if (!offsets) return

      const next = toggleRange(rangesRef.current, offsets)
      setRanges(next.length === 0 ? null : next)
      sel.removeAllRanges()
    }

    // Defer so the selection has finalized.
    const onMouseUp = () => setTimeout(commit, 0)
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key === 'Shift') setTimeout(commit, 0)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [setRanges, targetSelector])

  return null
}

/** Walk all text nodes under `root`, recording their cumulative character offsets. */
function getTextNodes(root: Element): TextNodeEntry[] {
  const nodes: TextNodeEntry[] = []
  let offset = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    const len = text.data.length
    nodes.push({ node: text, start: offset, end: offset + len })
    offset += len
  }
  return nodes
}

function rangeToOffsets(range: Range, nodes: TextNodeEntry[]): Range2 | null {
  let start = -1
  let end = -1
  for (const { node, start: ns } of nodes) {
    if (range.startContainer === node) start = ns + range.startOffset
    if (range.endContainer === node) end = ns + range.endOffset
  }
  if (start === -1 || end === -1 || end <= start) return null
  return [start, end]
}

function offsetsToRange(start: number, end: number, nodes: TextNodeEntry[]): Range | null {
  const range = document.createRange()
  let foundStart = false
  for (const { node, start: ns, end: ne } of nodes) {
    if (!foundStart && start >= ns && start <= ne) {
      range.setStart(node, start - ns)
      foundStart = true
    }
    if (foundStart && end >= ns && end <= ne) {
      range.setEnd(node, end - ns)
      return range
    }
  }
  return null
}

/**
 * Compute the symmetric difference between `existing` ranges and a new range.
 * Positions covered by exactly one of the inputs end up in the result.
 */
function toggleRange(existing: Range2[], [rs, re]: Range2): Range2[] {
  const boundaries = new Set<number>([rs, re])
  for (const [s, e] of existing) {
    boundaries.add(s)
    boundaries.add(e)
  }
  const points = [...boundaries].sort((a, b) => a - b)

  const out: Range2[] = []
  let segStart: number | null = null

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    // Test membership at the start of segment [a, b).
    const inExisting = existing.some(([s, e]) => a >= s && a < e)
    const inNew = a >= rs && a < re
    const inXor = inExisting !== inNew

    if (inXor) {
      if (segStart === null) segStart = a
    } else if (segStart !== null) {
      out.push([segStart, a])
      segStart = null
    }
  }
  if (segStart !== null) {
    out.push([segStart, points[points.length - 1]])
  }

  return out
}
