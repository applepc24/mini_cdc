'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'
import { ToastContainer } from '@/components/ui/toast-container'
import { CommandPalette } from '@/components/ui/command-palette'
import { useHotkeys } from '@/hooks/use-hotkeys'

interface AppLayoutProps {
  children: ReactNode
  onNewProduct?: () => void
}

export function AppLayout({ children, onNewProduct }: AppLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcuts
  useHotkeys([
    {
      key: 'k',
      ctrl: true,
      callback: () => setCommandPaletteOpen(true)
    },
    {
      key: '/',
      callback: () => searchInputRef.current?.focus()
    }
  ])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <motion.div
        initial={false}
        animate={{ marginLeft: sidebarCollapsed ? 72 : 240 }}
        transition={{ duration: 0.2 }}
        className="min-h-screen"
      >
        <Topbar
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          searchInputRef={searchInputRef}
        />
        <main className="p-6">
          {children}
        </main>
      </motion.div>
      <ToastContainer />
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNewProduct={onNewProduct}
      />
    </div>
  )
}
