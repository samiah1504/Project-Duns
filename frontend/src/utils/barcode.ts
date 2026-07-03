/**
 * CODE128-C barcode as inline SVG (no canvas, no external deps).
 * CODE128-C encodes digit pairs — perfect for 15-digit IMEIs.
 */

// Symbol table: index = code value, value = [b1,s1,b2,s2,b3,s3] module widths
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
  [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1], // 100-102
  [2,1,1,4,1,2],[2,1,1,2,1,4],[2,1,1,2,3,2], // 103=START_A, 104=START_B, 105=START_C
]
// STOP pattern (13 modules)
const STOP = [2,3,3,1,1,1,2]
const START_C = 105
const CODE_B  = 100  // switch to subset B (for last odd digit)

function buildSymbols(digits: string): number[] {
  const syms: number[] = [START_C]
  let s = digits.replace(/\D/g, '')

  let lastDigit: number | null = null
  if (s.length % 2 !== 0) {
    lastDigit = parseInt(s[s.length - 1])
    s = s.slice(0, -1)
  }
  for (let i = 0; i < s.length; i += 2) {
    syms.push(parseInt(s.slice(i, i + 2)))
  }
  if (lastDigit !== null) {
    syms.push(CODE_B)
    syms.push(16 + lastDigit) // Code-B digit offset: 0='16', 9='25'
  }

  // Check character
  let check = START_C
  syms.slice(1).forEach((v, i) => { check += v * (i + 1) })
  syms.push(check % 103)
  return syms
}

/** Returns an inline SVG string for the barcode. Always works — no canvas needed. */
export function barcodeSVG(value: string, opts?: { height?: number; scale?: number }): string {
  const height = opts?.height ?? 60
  const scale  = opts?.scale  ?? 2
  const margin = 8

  const syms = buildSymbols(value)

  // Collect all module patterns into one flat list: [width, isBar, ...]
  const modules: Array<{ w: number; bar: boolean }> = []
  const addPattern = (pat: number[]) => {
    pat.forEach((w, j) => modules.push({ w: w * scale, bar: j % 2 === 0 }))
  }
  syms.forEach(s => addPattern(T[s]))
  addPattern(STOP)

  const totalW = modules.reduce((a, m) => a + m.w, 0) + margin * 2
  const totalH = height + margin * 2

  let x = margin
  const rects = modules
    .map(m => {
      const rect = m.bar
        ? `<rect x="${x}" y="${margin}" width="${m.w}" height="${height}" fill="#000"/>`
        : ''
      x += m.w
      return rect
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" ` +
    `viewBox="0 0 ${totalW} ${totalH}">` +
    `<rect width="${totalW}" height="${totalH}" fill="#fff"/>` +
    rects +
    `</svg>`
  )
}

/** Returns a data: URL by base64-encoding the SVG (works as <img src="...">). */
export function barcodeDataURL(value: string): string {
  const svg = barcodeSVG(value)
  return 'data:image/svg+xml;base64,' + btoa(svg)
}
