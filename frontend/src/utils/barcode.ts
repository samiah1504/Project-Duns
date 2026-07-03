/**
 * Minimal CODE128-C barcode generator (no external deps).
 * Renders to a canvas and returns a PNG data URL.
 * CODE128-C encodes digit pairs (perfect for 15-digit IMEIs).
 */

// CODE128 symbol table: each entry = [b1,s1,b2,s2,b3,s3] module widths
// Indices 0-105 are value symbols; 106 = STOP bar pattern
const T: number[][] = [
  [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
  [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
  [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
  [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
  [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
  [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
  [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
  [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
  [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
  [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
  [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
  [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
  [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
  [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
  [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
  [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
  [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
  [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
  [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
  [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
  [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
  [2,1,1,2,3,2],
]
// STOP: 2,3,3,1,1,1,2
const STOP = [2,3,3,1,1,1,2]
const START_C = 105

export function drawCode128(canvas: HTMLCanvasElement, text: string, opts?: {
  height?: number; scale?: number; margin?: number
}): void {
  const height = opts?.height ?? 60
  const scale  = opts?.scale  ?? 2
  const margin = opts?.margin ?? 8

  // Build CODE128-C symbol sequence (encodes digit pairs)
  const symbols: number[] = [START_C]
  let i = 0
  // If odd length, pad with leading zero is unusual; we'll handle last single digit via subset B
  // For IMEI (15 digits), last digit encoded as Code-B via switch code 100
  let s = text.replace(/\D/g, '') // digits only
  // If odd digits, encode last one in subset B
  let lastDigit: number | null = null
  if (s.length % 2 !== 0) {
    lastDigit = parseInt(s[s.length - 1])
    s = s.slice(0, -1)
  }
  for (i = 0; i < s.length; i += 2) {
    symbols.push(parseInt(s.slice(i, i + 2)))
  }
  if (lastDigit !== null) {
    symbols.push(100) // switch to Code B
    symbols.push(16 + lastDigit) // Code B value for digit (space=0..digit 0=16..digit 9=25)
  }

  // Checksum
  let check = START_C
  symbols.slice(1).forEach((v, idx) => { check += v * (idx + 1) })
  symbols.push(check % 103)

  // Calculate total modules
  let totalModules = 0
  for (const sym of symbols) totalModules += T[sym].reduce((a, b) => a + b, 0)
  totalModules += STOP.reduce((a, b) => a + b, 0)

  const w = totalModules * scale + margin * 2
  const h = height + margin * 2
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#000000'

  let x = margin
  const drawSymbol = (pattern: number[]) => {
    for (let j = 0; j < pattern.length; j++) {
      const modules = pattern[j] * scale
      if (j % 2 === 0) ctx.fillRect(x, margin, modules, height) // bar
      x += modules
    }
  }
  for (const sym of symbols) drawSymbol(T[sym])
  drawSymbol(STOP)
}

export function barcodeDataURL(value: string): string {
  try {
    const canvas = document.createElement('canvas')
    drawCode128(canvas, value)
    return canvas.toDataURL('image/png')
  } catch {
    return ''
  }
}
