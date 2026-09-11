import type { CSSProperties } from 'react'
import { useId } from 'react'
import mythhandSvg from '../assets/brand/mythhand.svg?raw'

// The logo's geometry is read out of the brand file rather than written here.
// The brand is not licensed with the code (see REUSE.toml), so its paths live
// only in `assets/brand/mythhand.svg`; this component draws each of them twice
// to split and glitch the mark. viewBox 0 0 1339 150, as in that file.
const MYTHHAND_PATHS = [...mythhandSvg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1])

interface LogoSvgProps {
  fillOverlay?: number
  splitOffset?: number
  glitchY?: number
  color?: string
  style?: CSSProperties
}

// LogoSvg — лого с опциональным клипом для split-эффекта.
export default function LogoSvg({
  fillOverlay = 0,
  splitOffset = 0,
  glitchY = 0,
  color = '#ffffff',
  style,
}: LogoSvgProps) {
  const id = useId()
  const topClipId = `${id}-top`
  const botClipId = `${id}-bot`

  return (
    <svg
      viewBox="0 0 1339 150"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      style={style}
      role="img"
      aria-label="MythHand"
    >
      <defs>
        <clipPath id={topClipId}>
          <rect x="-2000" y="-200" width="5339" height="275" />
        </clipPath>
        <clipPath id={botClipId}>
          <rect x="-2000" y="75" width="5339" height="275" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${topClipId})`} transform={`translate(${-splitOffset}, ${-glitchY})`}>
        {MYTHHAND_PATHS.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: MYTHHAND_PATHS is a fixed constant array (never reordered), index is a stable key
          <path key={`t-${i}`} d={d} fill={color} />
        ))}
      </g>

      <g clipPath={`url(#${botClipId})`} transform={`translate(${splitOffset}, ${glitchY})`}>
        {MYTHHAND_PATHS.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: MYTHHAND_PATHS is a fixed constant array (never reordered), index is a stable key
          <path key={`b-${i}`} d={d} fill={color} />
        ))}
      </g>

      {fillOverlay > 0 && (
        <rect x="0" y="0" width="1339" height="150" fill="#ffffff" opacity={fillOverlay} />
      )}
    </svg>
  )
}
