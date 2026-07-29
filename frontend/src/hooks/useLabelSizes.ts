const KEY = 'tardmart_label_sizes'

export interface LabelSize {
  id: string
  name: string
  widthMm: number
  heightMm: number
  isDefault: boolean
}

const DEFAULT_SIZE: LabelSize = {
  id: 'default-30x25',
  name: '30 mm × 25 mm (XPrinter XP-236B-L)',
  widthMm: 30,
  heightMm: 25,
  isDefault: true,
}

export function getLabelSizes(): LabelSize[] {
  try {
    const raw = localStorage.getItem(KEY)
    const saved: LabelSize[] = raw ? JSON.parse(raw) : []
    // Always ensure default is first
    const withoutDefault = saved.filter(s => s.id !== DEFAULT_SIZE.id)
    return [DEFAULT_SIZE, ...withoutDefault]
  } catch {
    return [DEFAULT_SIZE]
  }
}

export function saveLabelSizes(sizes: LabelSize[]): void {
  // Never persist the default — it's always injected at read time
  const custom = sizes.filter(s => s.id !== DEFAULT_SIZE.id)
  localStorage.setItem(KEY, JSON.stringify(custom))
}

export function getSelectedLabelSizeId(): string {
  return localStorage.getItem('tardmart_selected_label_size') ?? DEFAULT_SIZE.id
}

export function saveSelectedLabelSizeId(id: string): void {
  localStorage.setItem('tardmart_selected_label_size', id)
}

export function getSelectedLabelSize(): LabelSize {
  const id = getSelectedLabelSizeId()
  return getLabelSizes().find(s => s.id === id) ?? DEFAULT_SIZE
}
