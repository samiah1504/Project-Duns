import axios from 'axios'

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || 'http://localhost:8000') + '/api',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('access_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// Auth
export const login = (email: string, password: string) =>
  api.post('/auth/login', new URLSearchParams({ username: email, password }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

export const getMe = () => api.get('/auth/me')

// Devices
export const getDevices = (params?: Record<string, string>) => api.get('/devices', { params })
export const getSellableDevices = (params?: Record<string, string>) => api.get('/devices/sellable', { params })
export const getDevice = (imei: string) => api.get(`/devices/${imei}`)
export const createDevice = (data: unknown) => api.post('/devices', data)
export const updateDevice = (imei: string, data: unknown) => api.patch(`/devices/${imei}`, data)
export const transferDevice = (imei: string, data: unknown) => api.post(`/devices/${imei}/transfer`, data)
export const getDeviceHistory = (imei: string) => api.get(`/devices/${imei}/history`)

// Phone Models
export const getPhoneModels = () => api.get('/phone-models')
export const createPhoneModel = (data: unknown) => api.post('/phone-models', data)

// Parts
export const getParts = (params?: Record<string, string>) => api.get('/parts', { params })
export const createPart = (data: unknown) => api.post('/parts', data)
export const updatePart = (id: string, data: unknown) => api.patch(`/parts/${id}`, data)
export const adjustPartStock = (id: string, data: unknown) => api.post(`/parts/${id}/adjust-stock`, data)

// Purchase Orders
export const getPurchaseOrders = (params?: Record<string, string>) => api.get('/purchase-orders', { params })
export const getPurchaseOrder = (id: string) => api.get(`/purchase-orders/${id}`)
export const createPurchaseOrder = (data: unknown) => api.post('/purchase-orders', data)
export const receivePurchaseOrder = (id: string, data: unknown) => api.post(`/purchase-orders/${id}/receive`, data)

// Refurb Jobs
export const getRefurbJobs = (params?: Record<string, string>) => api.get('/refurb-jobs', { params })
export const getRefurbJob = (id: string) => api.get(`/refurb-jobs/${id}`)
export const createRefurbJob = (data: unknown) => api.post('/refurb-jobs', data)
export const addPartsToJob = (id: string, data: unknown) => api.post(`/refurb-jobs/${id}/add-parts`, data)
export const closeRefurbJob = (id: string, data: unknown) => api.post(`/refurb-jobs/${id}/close`, data)

// Sales
export const getSales = (params?: Record<string, string>) => api.get('/sales', { params })
export const getSale = (id: string) => api.get(`/sales/${id}`)
export const createSale = (data: unknown) => api.post('/sales', data)
export const addPayment = (id: string, data: unknown) => api.post(`/sales/${id}/add-payment`, data)

// Customers
export const getCustomers = (params?: Record<string, string>) => api.get('/customers', { params })
export const getCustomer = (id: string) => api.get(`/customers/${id}`)
export const createCustomer = (data: unknown) => api.post('/customers', data)
export const updateCustomer = (id: string, data: unknown) => api.patch(`/customers/${id}`, data)

// Suppliers
export const getSuppliers = (params?: Record<string, string>) => api.get('/suppliers', { params })
export const createSupplier = (data: unknown) => api.post('/suppliers', data)
export const updateSupplier = (id: string, data: unknown) => api.patch(`/suppliers/${id}`, data)

// Users
export const getUsers = () => api.get('/users')
export const createUser = (data: unknown) => api.post('/users', data)
export const updateUser = (id: string, data: unknown) => api.patch(`/users/${id}`, data)

// Returns
export const getReturns = () => api.get('/returns')
export const createReturn = (data: unknown) => api.post('/returns', data)
export const resolveReturn = (id: string, data: unknown) => api.post(`/returns/${id}/resolve`, data)

// Reports
export const getReconciliation = () => api.get('/reports/reconciliation')
export const getInventoryValuation = () => api.get('/reports/inventory-valuation')
export const getWIPValue = () => api.get('/reports/wip-value')
export const getEngineerPerformance = () => api.get('/reports/engineer-performance')
export const getSalesSummary = () => api.get('/reports/sales-summary')
export const getReturnsAnalysis = () => api.get('/reports/returns-analysis')
export const getLowStockAlerts = () => api.get('/reports/low-stock-alerts')
export const getYieldConversion = () => api.get('/reports/yield-conversion')
