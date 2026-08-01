import { createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuthProvider, AuthContext } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Dashboard from './pages/Dashboard'
import Devices from './pages/Devices'
import DeviceDetail from './pages/DeviceDetail'
import Intake from './pages/Intake'
import RefurbJobs from './pages/RefurbJobs'
import Sales from './pages/Sales'
import Customers from './pages/Customers'
import Parts from './pages/Parts'
import Returns from './pages/Returns'
import Reports from './pages/Reports'
import Users from './pages/Users'
import Suppliers from './pages/Suppliers'
import PhoneModels from './pages/PhoneModels'
import Settings from './pages/Settings'
import LabelDesigner from './pages/LabelDesigner'
import SaleDetail from './pages/SaleDetail'
import Expenses from './pages/Expenses'
import CostPriceManagement from './pages/CostPriceManagement'
import SellableStock from './pages/SellableStock'
import AllDevices from './pages/AllDevices'
import StockToReturn from './pages/StockToReturn'
import HarvestedStock from './pages/HarvestedStock'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } })

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useContext(AuthContext)
  const location = useLocation()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Toaster position="top-right" />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/change-password" element={<ProtectedLayout><ChangePassword /></ProtectedLayout>} />
            <Route path="/" element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
            <Route path="/devices" element={<ProtectedLayout><Devices /></ProtectedLayout>} />
            <Route path="/devices/new" element={<ProtectedLayout><Devices /></ProtectedLayout>} />
            <Route path="/devices/:imei" element={<ProtectedLayout><DeviceDetail /></ProtectedLayout>} />
            <Route path="/intake" element={<ProtectedLayout><Intake /></ProtectedLayout>} />
            <Route path="/refurb" element={<ProtectedLayout><RefurbJobs /></ProtectedLayout>} />
            <Route path="/sales" element={<ProtectedLayout><Sales /></ProtectedLayout>} />
            <Route path="/sales/:id" element={<ProtectedLayout><SaleDetail /></ProtectedLayout>} />
            <Route path="/customers" element={<ProtectedLayout><Customers /></ProtectedLayout>} />
            <Route path="/parts" element={<ProtectedLayout><Parts /></ProtectedLayout>} />
            <Route path="/returns" element={<ProtectedLayout><Returns /></ProtectedLayout>} />
            <Route path="/reports" element={<ProtectedLayout><Reports /></ProtectedLayout>} />
            <Route path="/expenses" element={<ProtectedLayout><Expenses /></ProtectedLayout>} />
            <Route path="/users" element={<ProtectedLayout><Users /></ProtectedLayout>} />
            <Route path="/suppliers" element={<ProtectedLayout><Suppliers /></ProtectedLayout>} />
            <Route path="/phone-models" element={<ProtectedLayout><PhoneModels /></ProtectedLayout>} />
            <Route path="/settings" element={<ProtectedLayout><Settings /></ProtectedLayout>} />
            <Route path="/label-designer" element={<ProtectedLayout><LabelDesigner /></ProtectedLayout>} />
            <Route path="/cost-price" element={<ProtectedLayout><CostPriceManagement /></ProtectedLayout>} />
            <Route path="/sellable" element={<ProtectedLayout><SellableStock /></ProtectedLayout>} />
            <Route path="/all-devices" element={<ProtectedLayout><AllDevices /></ProtectedLayout>} />
            <Route path="/stock-to-return" element={<ProtectedLayout><StockToReturn /></ProtectedLayout>} />
            <Route path="/harvested" element={<ProtectedLayout><HarvestedStock /></ProtectedLayout>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
