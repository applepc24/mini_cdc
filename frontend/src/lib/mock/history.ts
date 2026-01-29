import type { StockHistory } from '@/lib/types'

export function generateMockHistory(productId: string): StockHistory[] {
  const history: StockHistory[] = []
  const count = Math.floor(Math.random() * 8) + 3

  for (let i = 0; i < count; i++) {
    const date = new Date()
    date.setDate(date.getDate() - Math.floor(Math.random() * 60))
    date.setHours(Math.floor(Math.random() * 24))
    date.setMinutes(Math.floor(Math.random() * 60))

    const type = Math.random() > 0.4 ? 'in' : 'out'
    const quantity = Math.floor(Math.random() * 50) + 1

    const inNotes = ['Restocked from warehouse', 'New shipment arrived', 'Inventory adjustment', 'Transfer from branch', 'Return processed']
    const outNotes = ['Customer order fulfilled', 'Transfer to branch', 'Damaged items removed', 'Sample provided', 'Promotional giveaway']

    history.push({
      id: `HST-${productId}-${i}`,
      product_id: productId,
      type,
      quantity,
      note: type === 'in' 
        ? inNotes[Math.floor(Math.random() * inNotes.length)]
        : outNotes[Math.floor(Math.random() * outNotes.length)],
      created_at: date.toISOString()
    })
  }

  return history.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}