'use client'

import { cn } from '@/lib/utils'

interface SkeletonLoaderProps {
  className?: string
}

export function SkeletonLoader({ className }: SkeletonLoaderProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted',
        className
      )}
    />
  )
}

export function CardSkeleton() {
  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <SkeletonLoader className="h-4 w-24 mb-2" />
      <SkeletonLoader className="h-8 w-32" />
    </div>
  )
}

export function TableRowSkeleton() {
  return (
    <tr className="border-b border-border">
      <td className="px-4 py-3"><SkeletonLoader className="h-4 w-4" /></td>
      <td className="px-4 py-3"><SkeletonLoader className="h-4 w-40" /></td>
      <td className="px-4 py-3"><SkeletonLoader className="h-4 w-24" /></td>
      <td className="px-4 py-3"><SkeletonLoader className="h-4 w-16" /></td>
      <td className="px-4 py-3"><SkeletonLoader className="h-4 w-12" /></td>
      <td className="px-4 py-3"><SkeletonLoader className="h-4 w-28" /></td>
      <td className="px-4 py-3"><SkeletonLoader className="h-6 w-20 rounded-full" /></td>
      <td className="px-4 py-3"><SkeletonLoader className="h-4 w-8" /></td>
    </tr>
  )
}

export function ChartSkeleton() {
  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <SkeletonLoader className="h-5 w-40 mb-4" />
      <SkeletonLoader className="h-64 w-full rounded-lg" />
    </div>
  )
}
