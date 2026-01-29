'use client'

import React from "react"

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, LayoutDashboard, Package, AlertTriangle, Settings, Plus, Moon, Sun, Command } from 'lucide-react'
import { useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

interface CommandItem {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  action: () => void
  category: string
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onNewProduct?: () => void
}

export function CommandPalette({ isOpen, onClose, onNewProduct }: CommandPaletteProps) {
  const router = useRouter()
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'dashboard',
        label: 'Go to Dashboard',
        icon: <LayoutDashboard className="w-4 h-4" />,
        shortcut: 'G D',
        action: () => {
          router.push('/dashboard')
          onClose()
        },
        category: 'Navigation'
      },
      {
        id: 'products',
        label: 'Go to Products',
        icon: <Package className="w-4 h-4" />,
        shortcut: 'G P',
        action: () => {
          router.push('/products')
          onClose()
        },
        category: 'Navigation'
      },
      {
        id: 'alerts',
        label: 'Go to Alerts',
        icon: <AlertTriangle className="w-4 h-4" />,
        shortcut: 'G A',
        action: () => {
          router.push('/alerts')
          onClose()
        },
        category: 'Navigation'
      },
      {
        id: 'settings',
        label: 'Go to Settings',
        icon: <Settings className="w-4 h-4" />,
        shortcut: 'G S',
        action: () => {
          router.push('/settings')
          onClose()
        },
        category: 'Navigation'
      },
      {
        id: 'new-product',
        label: 'New Product',
        icon: <Plus className="w-4 h-4" />,
        shortcut: 'N',
        action: () => {
          if (onNewProduct) {
            onNewProduct()
          } else {
            router.push('/products?new=true')
          }
          onClose()
        },
        category: 'Actions'
      },
      {
        id: 'toggle-theme',
        label: `Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`,
        icon: resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />,
        shortcut: 'T',
        action: () => {
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
          onClose()
        },
        category: 'Actions'
      }
    ],
    [router, onClose, onNewProduct, resolvedTheme, setTheme]
  )

  const filteredCommands = useMemo(() => {
    if (!search) return commands
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(search.toLowerCase())
    )
  }, [commands, search])

  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    filteredCommands.forEach(cmd => {
      if (!groups[cmd.category]) groups[cmd.category] = []
      groups[cmd.category].push(cmd)
    })
    return groups
  }, [filteredCommands])

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  useEffect(() => {
    if (!isOpen) {
      setSearch('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(i => (i + 1) % filteredCommands.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredCommands, selectedIndex, onClose])

  let currentIndex = 0

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-lg bg-card rounded-xl border border-border shadow-2xl overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                <Search className="w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Type a command or search..."
                  className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
                  autoFocus
                />
                <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs font-mono bg-muted text-muted-foreground rounded">
                  <Command className="w-3 h-3" />K
                </kbd>
              </div>
              <div className="max-h-[300px] overflow-y-auto p-2">
                {Object.entries(groupedCommands).map(([category, items]) => (
                  <div key={category} className="mb-2 last:mb-0">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                      {category}
                    </div>
                    {items.map(item => {
                      const itemIndex = currentIndex++
                      return (
                        <button
                          key={item.id}
                          onClick={item.action}
                          className={cn(
                            'w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors',
                            selectedIndex === itemIndex
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground hover:bg-muted'
                          )}
                        >
                          <span className="flex items-center gap-3">
                            <span className="text-muted-foreground">{item.icon}</span>
                            <span className="text-sm">{item.label}</span>
                          </span>
                          {item.shortcut && (
                            <kbd className="px-2 py-0.5 text-xs font-mono bg-muted text-muted-foreground rounded">
                              {item.shortcut}
                            </kbd>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
                {filteredCommands.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground">
                    No commands found
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
