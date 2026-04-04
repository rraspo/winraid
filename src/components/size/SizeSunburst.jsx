import React from 'react'
import { hierarchy, Partition } from '@visx/hierarchy'
import { Arc } from '@visx/shape'
import { formatSize } from '../../utils/format'
import styles from './SizeSunburst.module.css'

export const PALETTE = [
  '#5BA4F5', '#3DD68C', '#FFB547', '#FF4D4D',
  '#a78bfa', '#fb7185', '#34d399', '#fbbf24',
]

/**
 * Normalise the tree so that each node's `_size` represents only its "own"
 * unaccounted bytes (sizeKb minus the sum of direct children's sizeKb).
 * Leaf nodes get their full sizeKb. This prevents double-counting when building
 * the visx Partition hierarchy.
 *
 * Note: when the scan stops before reaching all subtrees (MAX_DEPTH limit),
 * a partially-scanned node's sizeKb may exceed its discovered children's sum.
 * The remainder is attributed to `_size` (its "own" unscanned bytes) — which
 * means it will appear as a small arc in the chart even though that space is
 * in subdirectories the scan did not visit. This is a known trade-off of the
 * level-limited scan approach.
 */
function normalise(node) {
  if (!node.children || node.children.length === 0) {
    return { ...node, _size: node.sizeKb }
  }
  const childSum = node.children.reduce((s, c) => s + c.sizeKb, 0)
  return {
    ...node,
    _size: Math.max(0, node.sizeKb - childSum),
    children: node.children.map(normalise),
  }
}

/** Walk the tree depth-first to find the node whose path matches. */
function findNode(node, path) {
  if (node.path === path) return node
  for (const c of node.children ?? []) {
    const found = findNode(c, path)
    if (found) return found
  }
  return null
}

// Assign colour by the depth-1 ancestor index so a subtree shares a hue.
function arcColour(node) {
  const ancestors = node.ancestors()
  // ancestors[0] = self, last = root; depth-1 child is ancestors[ancestors.length - 2]
  const topChild = ancestors[ancestors.length - 2]
  if (!topChild || !topChild.parent) return PALETTE[0]
  const idx = topChild.parent.children.indexOf(topChild)
  const depth = node.depth
  const base  = PALETTE[idx % PALETTE.length]
  // Fade slightly with depth for visual layering
  const opacity = Math.max(0.35, 0.9 - (depth - 1) * 0.15)
  return base + Math.round(opacity * 255).toString(16).padStart(2, '0')
}

const SizeSunburst = React.memo(function SizeSunburst({
  data,
  width,
  height,
  focusedPath,
  onArcClick,
  onCenterClick,
}) {
  const radius = Math.min(width, height) / 2 - 4
  const holeR  = radius * 0.28

  const displayData = focusedPath ? (findNode(data, focusedPath) ?? data) : data
  const normalised  = normalise(displayData)

  const root = hierarchy(normalised)
    .sum((d) => d._size)
    .sort((a, b) => b.value - a.value)

  return (
    <svg width={width} height={height} className={styles.svg}>
      <g transform={`translate(${width / 2},${height / 2})`}>
        <Partition root={root} size={[2 * Math.PI, radius ** 2]}>
          {(partitioned) =>
            partitioned.descendants().slice(1).map((node) => {
              const innerR = Math.sqrt(node.y0)
              const outerR = Math.sqrt(node.y1)
              if (outerR - innerR < 1) return null
              const parentValue = node.parent?.value ?? root.value
              const pct = parentValue > 0 ? Math.round((node.value / parentValue) * 100) : 0
              const titleText = `${node.data.name} — ${formatSize(node.data.sizeKb * 1024)} (${pct}% of parent)`
              return (
                <Arc
                  key={node.data.path}
                  startAngle={node.x0}
                  endAngle={node.x1}
                  innerRadius={innerR}
                  outerRadius={outerR}
                  cornerRadius={2}
                  padAngle={0.008}
                  fill={arcColour(node)}
                  data-path={node.data.path}
                  title={titleText}
                  className={styles.arc}
                  onClick={() => onArcClick?.(node.data)}
                />
              )
            })
          }
        </Partition>

        {/* Center hole — click navigates back up */}
        <circle
          r={holeR}
          fill="var(--bg)"
          data-role="center"
          className={styles.centerHole}
          onClick={onCenterClick}
        />
        <text
          textAnchor="middle"
          fill="var(--text)"
          fontSize={12}
          fontWeight={600}
          dy={-3}
          style={{ pointerEvents: 'none' }}
        >
          {formatSize(displayData.sizeKb * 1024)}
        </text>
        <text
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize={10}
          dy={11}
          style={{ pointerEvents: 'none' }}
        >
          total
        </text>
      </g>
    </svg>
  )
})
export default SizeSunburst
