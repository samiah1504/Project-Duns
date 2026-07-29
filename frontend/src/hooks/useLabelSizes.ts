const KEY = 'tardmart_label_sizes'
const SEL_KEY = 'tardmart_selected_label_size'

export interface LabelSize {
  id: string
  name: string
  widthMm: number
  heightMm: number
}

export function getLabelSizes(): LabelSize[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveLabelSizes(sizes: LabelSize[]): void {
  localStorage.setItem(KEY, JSON.stringify(sizes))
}

export function getSelectedLabelSizeId(): string | null {
  return localStorage.getItem(SEL_KEY)
}

export function saveSelectedLabelSizeId(id: string): void {
  localStorage.setItem(SEL_KEY, id)
}

export function getSelectedLabelSize(): LabelSize | null {
  const sizes = getLabelSizes()
  if (!sizes.length) return null
  const id = getSelectedLabelSizeId()
  return sizes.find(s => s.id === id) ?? sizes[0]
}
