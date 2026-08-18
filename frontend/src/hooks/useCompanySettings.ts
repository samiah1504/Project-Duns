import { getCompanySettingsAPI, saveCompanySettingsAPI } from '../services/api'

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

/**
 * Settings live in the backend database (shared by every device).
 * localStorage is only a cache so print functions can read synchronously;
 * it is refreshed from the server on app load and after every save.
 */

/** Synchronous read from cache — used by receipt/invoice/label printing. */
export function getCompanySettings(): CompanySettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

/** Fetch from the server and refresh the local cache. */
export async function fetchCompanySettings(): Promise<CompanySettings> {
  const res = await getCompanySettingsAPI()
  const settings: CompanySettings = { ...DEFAULTS, ...res.data }
  localStorage.setItem(KEY, JSON.stringify(settings))
  return settings
}

/** Save to the server (shared with all devices), then refresh the cache. */
export async function saveCompanySettings(s: CompanySettings): Promise<CompanySettings> {
  const res = await saveCompanySettingsAPI(s)
  const settings: CompanySettings = { ...DEFAULTS, ...res.data }
  localStorage.setItem(KEY, JSON.stringify(settings))
  return settings
}

export const COMPANY_DEFAULTS = DEFAULTS
