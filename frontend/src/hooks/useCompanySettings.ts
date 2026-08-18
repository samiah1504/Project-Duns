const KEY = 'tardmart_company_settings'

export interface CompanySettings {
  name: string
  tagline: string
  phone: string
  email: string
  address: string
  bankDetails: string
  receiptNote: string
}

const DEFAULTS: CompanySettings = {
  name: 'Tardmart Ventures',
  tagline: '',
  phone: '',
  email: '',
  address: '',
  bankDetails: '',
  receiptNote: 'Thank you for your business! All sales are final.',
}

export function getCompanySettings(): CompanySettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

export function saveCompanySettings(s: CompanySettings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}
