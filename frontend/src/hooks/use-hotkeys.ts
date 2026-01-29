'use client'

import { useEffect, useCallback } from 'react'

type HotkeyCallback = (event: KeyboardEvent) => void

interface HotkeyOptions {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  callback: HotkeyCallback
  enabled?: boolean
}

export function useHotkeys(hotkeys: HotkeyOptions[]) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't trigger hotkeys when typing in inputs
    const target = event.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || 
                   target.tagName === 'TEXTAREA' || 
                   target.isContentEditable

    for (const hotkey of hotkeys) {
      if (hotkey.enabled === false) continue

      const keyMatch = event.key.toLowerCase() === hotkey.key.toLowerCase()
      const ctrlMatch = hotkey.ctrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey
      const metaMatch = hotkey.meta ? event.metaKey : true
      const shiftMatch = hotkey.shift ? event.shiftKey : !event.shiftKey
      const altMatch = hotkey.alt ? event.altKey : !event.altKey

      // For single key shortcuts, skip if in input
      if (!hotkey.ctrl && !hotkey.meta && isInput) continue

      if (keyMatch && ctrlMatch && metaMatch && shiftMatch && altMatch) {
        event.preventDefault()
        hotkey.callback(event)
        break
      }
    }
  }, [hotkeys])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

export function useHotkey(
  key: string,
  callback: HotkeyCallback,
  options?: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; enabled?: boolean }
) {
  useHotkeys([{ key, callback, ...options }])
}
