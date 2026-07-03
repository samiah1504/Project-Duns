import { createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuthProvider, AuthContext } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
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

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } })

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuthProvider()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useContext(AuthContext)
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#64748b' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
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
            <Route path="/" element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
            <Route path="/devices" element={<ProtectedLayout><Devices /></ProtectedLayout>} />
            <Route path="/devices/new" element={<ProtectedLayout><Devices /></ProtectedLayout>} />
            <Route path="/devices/:imei" element={<ProtectedLayout><DeviceDetail /></ProtectedLayout>} />
            <Route path="/intake" element={<ProtectedLayout><Intake /></ProtectedLayout>} />
            <Route path="/refurb" element={<ProtectedLayout><RefurbJobs /></ProtectedLayout>} />
            <Route path="/sales" element={<ProtectedLayout><Sales /></ProtectedLayout>} />
            <Route path="/customers" element={<ProtectedLayout><Customers /></ProtectedLayout>} />
            <Route path="/parts" element={<ProtectedLayout><Parts /></ProtectedLayout>} />
            <Route path="/returns" element={<ProtectedLayout><Returns /></ProtectedLayout>} />
            <Route path="/reports" element={<ProtectedLayout><Reports /></ProtectedLayout>} />
            <Route path="/users" element={<ProtectedLayout><Users /></ProtectedLayout>} />
            <Route path="/suppliers" element={<ProtectedLayout><Suppliers /></ProtectedLayout>} />
            <Route path="/phone-models" element={<ProtectedLayout><PhoneModels /></ProtectedLayout>} />
            <Route path="/settings" element={<ProtectedLayout><Settings /></ProtectedLayout>} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
