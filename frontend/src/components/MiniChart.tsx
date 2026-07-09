interface ChartProps {
  headers: string[]
  rows: string[][]
}

function parseNum(s: string): number | null {
  const clean = s.replace(/[,،٬\s]/g, '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
  const n = parseFloat(clean)
  return isNaN(n) ? null : n
}

function isNumericCol(rows: string[][], colIdx: number): boolean {
  const vals = rows.map((r) => r[colIdx] ?? '')
  const nonEmpty = vals.filter((v) => v.trim() !== '')
  if (nonEmpty.length === 0) return false
  return nonEmpty.filter((v) => parseNum(v) !== null).length / nonEmpty.length >= 0.6
}

export default function MiniChart({ headers, rows }: ChartProps) {
  if (rows.length === 0) return null

  // Find label column (first non-numeric) and first numeric column
  const numericFlags = headers.map((_, i) => isNumericCol(rows, i))
  const labelIdx = numericFlags.findIndex((v) => !v)
  const valueIdx = numericFlags.findIndex((v) => v)

  if (valueIdx === -1) return null

  const labels = rows.map((r) => r[labelIdx !== -1 ? labelIdx : valueIdx])
  const values = rows.map((r) => parseNum(r[valueIdx]) ?? 0)
  const maxVal = Math.max(...values, 1)

  const barH = 22
  const barGap = 6
  const labelW = 130
  const barMaxW = 240
  const numW = 70
  const chartW = labelW + barMaxW + numW
  const chartH = rows.length * (barH + barGap) + 8
  const valueColLabel = headers[valueIdx] || ''

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/30 p-3">
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">{valueColLabel}</p>
      <svg
        width={chartW}
        height={chartH}
        dir="ltr"
        className="block"
        style={{ minWidth: chartW }}
      >
        {rows.map((_, i) => {
          const barW = maxVal > 0 ? Math.max((values[i] / maxVal) * barMaxW, values[i] > 0 ? 2 : 0) : 0
          const y = i * (barH + barGap) + 4
          const displayVal = values[i].toLocaleString('fa-IR')
          return (
            <g key={i}>
              <text
                x={labelW - 6}
                y={y + barH / 2 + 4}
                textAnchor="end"
                fontSize="11"
                fill="currentColor"
                className="fill-foreground/70"
              >
                {labels[i]?.slice(0, 18)}
              </text>
              <rect
                x={labelW}
                y={y}
                width={barW}
                height={barH}
                rx="3"
                className="fill-primary opacity-75"
              />
              <text
                x={labelW + barW + 5}
                y={y + barH / 2 + 4}
                fontSize="11"
                fill="currentColor"
                className="fill-foreground/60"
              >
                {displayVal}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function parseMarkdownTable(content: string): { headers: string[]; rows: string[][] } | null {
  const lines = content.split('\n')
  let tableStart = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().match(/^\|.+\|/)) {
      tableStart = i
      break
    }
  }
  if (tableStart === -1) return null

  // Next line should be separator (|---|)
  const sepLine = lines[tableStart + 1]?.trim()
  if (!sepLine || !/^\|[\s\-:|]+\|/.test(sepLine)) return null

  const parseCells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())

  const headers = parseCells(lines[tableStart])
  if (headers.length === 0) return null

  const rows: string[][] = []
  for (let i = tableStart + 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('|')) break
    const cells = parseCells(line)
    if (cells.length > 0) rows.push(cells)
  }

  if (rows.length === 0) return null
  return { headers, rows }
}

export function tableToCSV(headers: string[], rows: string[][]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))]
  return '﻿' + lines.join('\n')
}
