'use client'

import { cn } from '@/lib/utils'
import type { StockStatus } from '@/lib/types'
import { getStockStatusLabel, getStockStatusColor } from '@/lib/utils/stock'

interface StatusBadgeProps {
  status: StockStatus
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-1',
  lg: 'text-base px-3 py-1.5'
}

export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full border',
        getStockStatusColor(status),
        sizeClasses[size],
        className
      )}
    >
      {getStockStatusLabel(status)}
    </span>
  )
}
