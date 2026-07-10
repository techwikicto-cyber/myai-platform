import { type SVGProps } from 'react'

/** Product logo — line-art horned owl with orange wing and crown. */
export default function OwlLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden className="size-8 shrink-0" {...props}>
      <g stroke="#35302A" strokeWidth="4.4" strokeLinejoin="round" strokeLinecap="round">
        {/* ear tufts */}
        <path d="M52.5 12.5 C50 4, 40.5 2.5, 36 11.5" />
        <path d="M63.5 12.5 C66 4, 75.5 2.5, 80 11.5" />
        {/* feet dome */}
        <path d="M41.5 96 A 13.5 10.5 0 0 1 68.5 96 Z" fill="#FFFFFF" />
        {/* body */}
        <path
          d="M47 39.5 L22.5 78.5 C33 86.5, 54 87.5, 63 82.5 C73.5 76, 77 56, 70.5 41 C62.5 44, 54 42.8, 47 39.5 Z"
          fill="#FFFFFF"
        />
        {/* wing */}
        <path
          d="M45.5 44 L24 76.5 C33.5 78.5, 44.5 73, 49.5 64.5 C54 56.5, 53 48.8, 48 44.8 Z"
          fill="#F5713B"
          strokeWidth="3.8"
        />
        {/* shoulder swoosh */}
        <path
          d="M51 42.7 C59.5 45.5, 63.5 52.5, 61.5 60 C60 65, 55.5 67.8, 51.8 67 C55.5 63, 57 57.5, 55.2 52.3 C53.5 47.5, 50 44.5, 46.5 43.4 Z"
          fill="#F5713B"
          strokeWidth="3.4"
        />
        {/* head */}
        <circle cx="58" cy="29.5" r="16.5" fill="#FFFFFF" />
        {/* crown */}
        <path
          d="M45 21.5 Q58 9.5, 71 21.5 Q64.5 24, 60.5 29 Q58 32, 55.5 29 Q51.5 24, 45 21.5 Z"
          fill="#F5713B"
          strokeWidth="3.4"
        />
        {/* beak */}
        <path d="M58 34 L58 39" strokeWidth="3.6" />
      </g>
      {/* wing stripe */}
      <path
        d="M31 69.5 C38.5 67.5, 44 61, 46.8 53"
        stroke="#FFFFFF"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      {/* eyes */}
      <circle cx="51" cy="32" r="3" fill="#35302A" />
      <circle cx="65" cy="32" r="3" fill="#35302A" />
    </svg>
  )
}
