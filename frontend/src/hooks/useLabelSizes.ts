const KEY = 'tardmart_label_sizes'
const SEL_KEY = 'tardmart_selected_label_size'
const VERSION_KEY = 'tardmart_label_version'  // shared with templates

export interface LabelSize {
  id: string
  name: string
  widthMm: number
  heightMm: number
}

export const PRESET_SIZES: LabelSize[] = [
  { id: '50x15',  name: '50×15mm Thermal',   widthMm: 50,  heightMm: 15  },
  { id: '50x25',  name: '50×25mm Thermal',   widthMm: 50,  heightMm: 25  },
  { id: '50x30',  name: '50×30mm Thermal',   widthMm: 50,  heightMm: 30  },
  { id: '57x32',  name: '57×32mm Thermal',   widthMm: 57,  heightMm: 32  },
  { id: '100x50', name: '100×50mm Standard', widthMm: 100, heightMm: 50  },
]

export function getLabelSizes(): LabelSize[] {
  // Version check is handled by getTemplates(); if sizes were wiped, reload presets
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  saveLabelSizes(PRESET_SIZES)
  saveSelectedLabelSizeId('50x15')
  return PRESET_SIZES
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
