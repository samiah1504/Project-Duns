import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getExpenses, createExpense, updateExpense, deleteExpense, getUsers } from '../services/api'
import { Expense, User } from '../types'
import { useAuth } from '../hooks/useAuth'
import { PageHeader, Card, Table, TR, TD, Btn, fmt } from '../components/Layout'

function apiErr(e: any, fallback = 'An error occurred'): string {
  const d = e?.response?.data?.detail
  if (!d) return fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x: any) => x.msg ?? String(x)).join('; ')
  return fallback
}

const today = () => new Date().toISOString().slice(0, 10)

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(expenses: Expense[]) {
  const rows = [
    ['Date', 'Title', 'Description', 'Amount (₦)', 'Branch/Location', 'Entered By', 'Role'],
    ...expenses.map(e => [
      e.date,
      e.title,
      e.description ?? '',
      parseFloat(e.amount).toFixed(2),
      e.branch ?? '',
      e.entered_by?.name ?? '',
      e.entered_by?.role ?? '',
    ]),
  ]
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `expenses-${today()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Print / PDF ───────────────────────────────────────────────────────────────
function printExpenses(expenses: Expense[], totalAmt: number) {
  const rows = expenses.map(e => `
    <tr>
      <td>${e.date}</td>
      <td>${e.title}</td>
      <td>${e.description ?? ''}</td>
      <td style="text-align:right">₦${parseFloat(e.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
      <td>${e.branch ?? ''}</td>
      <td>${e.entered_by?.name ?? ''}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html><head><title>Warehouse Expenses</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    p.sub { color: #64748b; margin: 0 0 16px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; text-align: left; padding: 6px 8px; border-bottom: 2px solid #cbd5e1; font-size: 11px; }
    td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; }
    .total { font-weight: bold; text-align: right; margin-top: 12px; font-size: 13px; }
    @media print { body { margin: 16px; } }
  </style></head><body>
  <h1>Warehouse Expenses Report</h1>
  <p class="sub">Generated: ${new Date().toLocaleString()}</p>
  <table>
    <thead><tr>
      <th>Date</th><th>Title</th><th>Description</th><th style="text-align:right">Amount</th><th>Branch</th><th>Entered By</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total">Total: ₦${totalAmt.toLocaleString('en-NG', { minimumFractionDigits: 2 })} (${expenses.length} entries)</p>
  </body></html>`

  const w = window.open('', '_blank')
  if (!w) { toast.error('Allow pop-ups to print'); return }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print(); w.close() }, 300)
}

// ── Expense Form Modal ────────────────────────────────────────────────────────
function ExpenseModal({
  expense, onClose, onSaved,
}: {
  expense?: Expense
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!expense
  const [title, setTitle] = useState(expense?.title ?? '')
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(expense ? String(parseFloat(expense.amount)) : '')
  const [date, setDate] = useState(expense?.date ?? today())
  const [branch, setBranch] = useState(expense?.branch ?? '')

  const mut = useMutation({
    mutationFn: (data: unknown) =>
      isEdit ? updateExpense(expense!.id, data) : createExpense(data),
    onSuccess: () => {
      onSaved()
      toast.success(isEdit ? 'Expense updated' : 'Expense recorded')
    },
    onError: (e: any) => toast.error(apiErr(e, 'Failed to save expense')),
  })

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!title.trim()) return toast.error('Title is required')
    if (!amount || parseFloat(amount) <= 0) return toast.error('Enter a valid amount')
    mut.mutate({
      title: title.trim(),
      description: description.trim() || null,
      amount: parseFloat(amount),
      date,
      branch: branch.trim() || null,
    })
  }

  const S: Record<string, React.CSSProperties> = {
    label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 },
    field: { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' as const, marginBottom: 14 },
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 500 }}
           onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{isEdit ? 'Edit Expense' : 'Record Expense'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b' }}>×</button>
        </div>

        <form onSubmit={submit}>
          <label style={S.label}>Expense Title *</label>
          <input
            style={S.field}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Fuel, Rent, Generator Repair, Internet…"
            required
          />

          <label style={S.label}>Description / Notes</label>
          <textarea
            style={{ ...S.field, resize: 'vertical', minHeight: 68 }}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional details"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={S.label}>Amount (₦) *</label>
              <input
                style={S.field}
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label style={S.label}>Date *</label>
              <input
                style={S.field}
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <label style={S.label}>Branch / Location</label>
          <input
            style={S.field}
            value={branch}
            onChange={e => setBranch(e.target.value)}
            placeholder="e.g. Main Warehouse, Ikeja Branch (optional)"
          />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <Btn variant="secondary" onClick={onClose} type="button">Cancel</Btn>
            <Btn type="submit" disabled={mut.isPending}>
              {mut.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Record Expense'}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Delete Confirm ────────────────────────────────────────────────────────────
function DeleteConfirm({ expense, onClose, onDeleted }: {
  expense: Expense; onClose: () => void; onDeleted: () => void
}) {
  const mut = useMutation({
    mutationFn: () => deleteExpense(expense.id),
    onSuccess: () => { onDeleted(); toast.success('Expense deleted') },
    onError: (e: any) => toast.error(apiErr(e, 'Failed to delete')),
  })
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 400, textAlign: 'center' }}
           onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Delete Expense?</h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px' }}>
          <strong>{expense.title}</strong> — {fmt(expense.amount)} on {expense.date}
          <br />This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Deleting…' : 'Delete'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Expenses() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'ADMIN'

  const [showNew, setShowNew] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null)

  // Filters
  const [searchTitle, setSearchTitle] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const params: Record<string, string> = {}
  if (searchTitle) params.title = searchTitle
  if (filterUser) params.entered_by_user_id = filterUser
  if (dateFrom) params.date_from = dateFrom
  if (dateTo) params.date_to = dateTo

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', params],
    queryFn: () => getExpenses(params).then(r => r.data as Expense[]),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data as User[]),
    enabled: isAdmin,
  })

  const total = useMemo(
    () => (expenses as Expense[]).reduce((s, e) => s + parseFloat(e.amount), 0),
    [expenses]
  )

  const refresh = () => qc.invalidateQueries({ queryKey: ['expenses'] })

  const F: React.CSSProperties = {
    padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6,
    fontSize: 13, background: '#fff',
  }

  return (
    <div style={{ padding: 28 }}>
      <PageHeader
        title="Warehouse Expenses"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="secondary" size="sm" onClick={() => exportCSV(expenses as Expense[])}>
              ↓ Export CSV
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => printExpenses(expenses as Expense[], total)}>
              🖨 Print / PDF
            </Btn>
            <Btn onClick={() => setShowNew(true)}>+ Record Expense</Btn>
          </div>
        }
      />

      {/* Filter bar */}
      <Card style={{ marginBottom: 20, padding: '14px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
              Search by title
            </label>
            <input
              style={F}
              value={searchTitle}
              onChange={e => setSearchTitle(e.target.value)}
              placeholder="Fuel, Rent, Solar…"
            />
          </div>
          {isAdmin && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
                Entered by
              </label>
              <select style={F} value={filterUser} onChange={e => setFilterUser(e.target.value)}>
                <option value="">All users</option>
                {(users as User[]).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
              From date
            </label>
            <input style={F} type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
              To date
            </label>
            <input style={F} type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        {(searchTitle || filterUser || dateFrom || dateTo) && (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => { setSearchTitle(''); setFilterUser(''); setDateFrom(''); setDateTo('') }}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer', padding: 0 }}
            >
              × Clear filters
            </button>
          </div>
        )}
      </Card>

      {/* Summary bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
        padding: '10px 18px', marginBottom: 16,
      }}>
        <span style={{ fontSize: 14, color: '#1d4ed8', fontWeight: 600 }}>
          {(expenses as Expense[]).length} {(expenses as Expense[]).length === 1 ? 'entry' : 'entries'}
        </span>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#1d4ed8' }}>
          Total: {fmt(total)}
        </span>
      </div>

      <Card>
        {isLoading ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: 32 }}>Loading…</p>
        ) : (expenses as Expense[]).length === 0 ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: 32, margin: 0 }}>
            No expenses recorded yet.
          </p>
        ) : (
          <Table headers={['Date', 'Title', 'Description', 'Amount', 'Branch / Location', 'Entered By', 'Actions']}>
            {(expenses as Expense[]).map(e => (
              <TR key={e.id}>
                <TD style={{ whiteSpace: 'nowrap', color: '#64748b', fontSize: 13 }}>{e.date}</TD>
                <TD><strong style={{ fontSize: 14 }}>{e.title}</strong></TD>
                <TD style={{ color: '#64748b', fontSize: 13, maxWidth: 200 }}>
                  {e.description ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                </TD>
                <TD style={{ fontWeight: 700, color: '#dc2626', whiteSpace: 'nowrap' }}>
                  {fmt(e.amount)}
                </TD>
                <TD style={{ color: '#64748b', fontSize: 13 }}>
                  {e.branch ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                </TD>
                <TD>
                  <div style={{ fontSize: 13 }}>{e.entered_by?.name ?? '—'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{e.entered_by?.role ?? ''}</div>
                </TD>
                <TD>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(isAdmin || e.entered_by_user_id === user?.id) && (
                      <Btn size="sm" variant="ghost" onClick={() => setEditExpense(e)}>Edit</Btn>
                    )}
                    {isAdmin && (
                      <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(e)}>Delete</Btn>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>

      {showNew && (
        <ExpenseModal
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh() }}
        />
      )}
      {editExpense && (
        <ExpenseModal
          expense={editExpense}
          onClose={() => setEditExpense(null)}
          onSaved={() => { setEditExpense(null); refresh() }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          expense={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); refresh() }}
        />
      )}
    </div>
  )
}
