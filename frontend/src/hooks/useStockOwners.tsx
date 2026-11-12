import { useQuery } from '@tanstack/react-query'
import { getStockOwners } from '../services/api'
import { StockOwner } from '../types'
import { Select } from '../components/Layout'

/** Stock owners (House first, then investors). Shared, cached query. */
export function useStockOwners(includeInactive = false) {
  const { data: owners = [], isLoading } = useQuery<StockOwner[]>({
    queryKey: ['stock-owners', includeInactive],
    queryFn: () => getStockOwners(includeInactive ? { include_inactive: 'true' } : undefined).then(r => r.data),
    staleTime: 60_000,
  })
  const house = owners.find(o => o.is_house)
  const byId = new Map(owners.map(o => [o.id, o]))
  const nameOf = (id?: string | null) => (id && byId.get(id)?.name) || house?.name || 'House'
  return { owners, house, nameOf, isLoading }
}

/** Small coloured tag naming a stock owner. House is grey; investors are amber. */
export function OwnerTag({ ownerId }: { ownerId?: string | null }) {
  const { owners, nameOf } = useStockOwners(true)
  const owner = owners.find(o => o.id === ownerId)
  const isHouse = !owner || owner.is_house
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 4, whiteSpace: 'nowrap',
      background: isHouse ? '#f1f5f9' : '#fef3c7', color: isHouse ? '#475569' : '#92400e',
      border: `1px solid ${isHouse ? '#cbd5e1' : '#fcd34d'}`,
    }}>
      {nameOf(ownerId)}
    </span>
  )
}

/** Choose the owner for new stock (PO, part, device). Defaults to House. */
export function OwnerSelect({ value, onChange, label = 'Stock owner' }: {
  value: string; onChange: (id: string) => void; label?: string
}) {
  const { owners, house } = useStockOwners()
  return (
    <Select label={label} value={value || house?.id || ''} onChange={e => onChange(e.target.value)}>
      {owners.map(o => (
        <option key={o.id} value={o.id}>{o.name}{o.is_house ? ' (business stock)' : ' (investor)'}</option>
      ))}
    </Select>
  )
}

/** Filter a list by owner. Empty value = all owners. */
export function OwnerFilter({ value, onChange, style }: {
  value: string; onChange: (id: string) => void; style?: React.CSSProperties
}) {
  const { owners } = useStockOwners(true)
  if (owners.length <= 1) return null   // only House: nothing to filter
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '8px 11px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, ...style }}>
      <option value="">All owners</option>
      {owners.map(o => <option key={o.id} value={o.id}>{o.name}{o.active ? '' : ' (inactive)'}</option>)}
    </select>
  )
}
