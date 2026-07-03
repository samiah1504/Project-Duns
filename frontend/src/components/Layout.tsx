import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// module key → nav entry
const NAV = [
  { to: '/', label: 'Dashboard', module: 'dashboard' },
  { to: '/devices', label: 'Devices', module: 'devices' },
  { to: '/intake', label: 'Intake (POs)', module: 'intake' },
  { to: '/refurb', label: 'Refurb Jobs', module: 'refurb' },
  { to: '/sales', label: 'Sales', module: 'sales' },
  { to: '/customers', label: 'Customers', module: 'customers' },
  { to: '/parts', label: 'Parts', module: 'parts' },
  { to: '/returns', label: 'Returns', module: 'returns' },
  { to: '/reports', label: 'Reports', module: 'reports' },
  { to: '/phone-models', label: 'Phone Models', module: 'phone_models' },
  { to: '/suppliers', label: 'Suppliers', module: 'suppliers' },
  { to: '/users', label: 'Users', module: 'users' },
  { to: '/settings', label: '⚙ Settings', module: 'settings' },
]

const STATUS_COLORS: Record<string, string> = {
  SELLABLE: '#22c55e',
  IN_REFURB: '#f59e0b',
  AWAITING_REFURB: '#f97316',
  SENT_EXTERNAL: '#8b5cf6',
  SCRAPPED: '#ef4444',
  SOLD: '#3b82f6',
  RESERVED: '#06b6d4',
  RETURNED: '#ec4899',
}

export function statusBadge(status: string) {
  const color = STATUS_COLORS[status] ?? '#64748b'
  return (
    <span style={{
      background: color + '22',
      color: color,
      border: `1px solid ${color}55`,
      borderRadius: 4,
      padding: '2px 8px',
      fontSize: 12,
      fontWeight: 600,
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export function fmt(n: string | number | null | undefined) {
  if (n == null || n === '') return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  return `₦${num.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const location = useLocation()

  const visibleNav = NAV.filter((n) => user && (user.effective_modules ?? []).includes(n.module))

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{
        width: 220,
        background: '#0f172a',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#38bdf8' }}>Tardmart</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Refurb & Resale</div>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {visibleNav.map((n) => {
            const active = location.pathname === n.to || (n.to !== '/' && location.pathname.startsWith(n.to))
            return (
              <Link
                key={n.to}
                to={n.to}
                style={{
                  display: 'block',
                  padding: '8px 12px',
                  borderRadius: 6,
                  color: active ? '#38bdf8' : '#94a3b8',
                  background: active ? '#1e293b' : 'transparent',
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  marginBottom: 2,
                }}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #1e293b', fontSize: 12 }}>
          <div style={{ color: '#94a3b8' }}>{user?.name}</div>
          <div style={{ color: '#475569', marginBottom: 8 }}>{user?.role}</div>
          <button
            onClick={logout}
            style={{
              background: 'none', border: '1px solid #334155', color: '#94a3b8',
              padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>{title}</h1>
      {action}
    </div>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 10,
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  )
}

export function Btn({
  children, onClick, variant = 'primary', type = 'button', disabled = false, size = 'md',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: '#2563eb', color: '#fff', border: 'none' },
    secondary: { background: '#f1f5f9', color: '#1e293b', border: '1px solid #cbd5e1' },
    danger: { background: '#dc2626', color: '#fff', border: 'none' },
    ghost: { background: 'none', color: '#2563eb', border: '1px solid #2563eb' },
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: size === 'sm' ? '4px 12px' : '8px 18px',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: size === 'sm' ? 12 : 14,
        fontWeight: 600,
        opacity: disabled ? 0.6 : 1,
        ...styles[variant],
      }}
    >
      {children}
    </button>
  )
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            {headers.map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#64748b', fontWeight: 600, fontSize: 12 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function TR({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      style={{
        borderBottom: '1px solid #f1f5f9',
        cursor: onClick ? 'pointer' : undefined,
      }}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLElement).style.background = '#f8fafc' } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLElement).style.background = '' } : undefined}
    >
      {children}
    </tr>
  )
}

export function TD({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 12px', ...style }}>{children}</td>
}

export function Input({ label, ...props }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>{label}</label>}
      <input
        style={{
          width: '100%', padding: '8px 10px', border: '1px solid #d1d5db',
          borderRadius: 6, fontSize: 14, outline: 'none',
        }}
        {...props}
      />
    </div>
  )
}

export function Select({ label, children, ...props }: { label?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#374151' }}>{label}</label>}
      <select
        style={{
          width: '100%', padding: '8px 10px', border: '1px solid #d1d5db',
          borderRadius: 6, fontSize: 14, background: '#fff', outline: 'none',
        }}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
}) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, minWidth: 420, maxWidth: 600,
        maxHeight: '90vh', overflow: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#64748b' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
