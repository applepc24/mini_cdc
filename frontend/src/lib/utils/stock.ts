import type { Product, StockStatus } from '@/lib/types'

export function getStockStatus(qty: number, threshold: number = 10): StockStatus {
  if (qty === 0) return 'out-of-stock'
  if (qty < 5) return 'danger'
  if (qty < threshold) return 'warning'
  return 'normal'
}

export function getStockStatusLabel(status: StockStatus): string {
  const labels: Record<StockStatus, string> = {
    'out-of-stock': '품절',
    'danger': '위험',
    'warning': '부족',
    'normal': '정상'
  }
  return labels[status]
}

export function getStockStatusColor(status: StockStatus): string {
  const colors: Record<StockStatus, string> = {
    'out-of-stock': 'bg-red-500/10 text-red-500 border-red-500/20',
    'danger': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    'warning': 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    'normal': 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
  }
  return colors[status]
}

export function filterProducts(
  products: Product[],
  filters: {
    search?: string
    category?: string
    minQty?: number
    maxQty?: number
    minPrice?: number
    maxPrice?: number
  }
): Product[] {
  return products.filter(product => {
    if (filters.search && !product.name.toLowerCase().includes(filters.search.toLowerCase())) {
      return false
    }
    if (filters.category && filters.category !== 'all' && product.category !== filters.category) {
      return false
    }
    if (filters.minQty !== undefined && product.qty < filters.minQty) {
      return false
    }
    if (filters.maxQty !== undefined && product.qty > filters.maxQty) {
      return false
    }
    if (filters.minPrice !== undefined && product.price < filters.minPrice) {
      return false
    }
    if (filters.maxPrice !== undefined && product.price > filters.maxPrice) {
      return false
    }
    return true
  })
}

export function sortProducts(
  products: Product[],
  sortBy: string,
  sortOrder: 'asc' | 'desc' = 'asc'
): Product[] {
  const sorted = [...products].sort((a, b) => {
    let comparison = 0
    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name)
        break
      case 'category':
        comparison = a.category.localeCompare(b.category)
        break
      case 'price':
        comparison = a.price - b.price
        break
      case 'qty':
        comparison = a.qty - b.qty
        break
      case 'updated_at':
        comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        break
      default:
        comparison = 0
    }
    return sortOrder === 'asc' ? comparison : -comparison
  })
  return sorted
}
