/**
 * Code 128 barcode as inline SVG (no canvas, no external deps).
 * Code 128B is used for alphanumeric strings (like TDM-XXXXXXXX).
 * Code 128C is used for pure-digit strings (like IMEIs) — more compact.
 */

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
  [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],
  // 103=START_A, 104=START_B, 105=START_C
  [2,1,1,4,1,2],[2,1,1,2,1,4],[2,1,1,2,3,2],
]

const STOP = [2,3,3,1,1,1,2]
const START_B = 104
const START_C = 105
const CODE_B  = 100  // switch to Code B within Code C stream

/** Code 128B: encodes any printable ASCII (0x20–0x7E). */
function buildSymbolsB(text: string): number[] {
  const syms: number[] = [START_B]
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32
    if (v < 0 || v > 95) throw new Error(`Character '${ch}' not encodable in Code 128B`)
    syms.push(v)
  }
  let check = START_B
  syms.slice(1).forEach((v, i) => { check += v * (i + 1) })
  syms.push(check % 103)
  return syms
}

/** Code 128C: encodes digit strings (most compact for pure numbers). */
function buildSymbolsC(digits: string): number[] {
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
    syms.push(16 + lastDigit)
  }

  let check = START_C
  syms.slice(1).forEach((v, i) => { check += v * (i + 1) })
  syms.push(check % 103)
  return syms
}

function buildSymbols(value: string): number[] {
  return /^\d+$/.test(value) ? buildSymbolsC(value) : buildSymbolsB(value)
}

/** Returns an inline SVG string for the barcode. */
export function barcodeSVG(value: string, opts?: { height?: number; scale?: number }): string {
  const height = opts?.height ?? 60
  const scale  = opts?.scale  ?? 2
  const margin = 8

  const syms = buildSymbols(value)

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
