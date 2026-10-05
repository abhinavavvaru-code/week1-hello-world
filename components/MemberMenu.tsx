'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Identity } from '@/lib/auth'
import SignOutButton from './SignOutButton'

type Theme = 'system' | 'light' | 'dark'
const themeOptions: { value: Theme; label: string; icon: string }[] = [
  { value: 'system', label: 'System default', icon: '▣' },
  { value: 'light', label: 'Light mode', icon: '☼' },
  { value: 'dark', label: 'Dark mode', icon: '☾' },
]
function subscribeTheme(listener: () => void) {
  window.addEventListener('punchline-theme', listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener('punchline-theme', listener)
    window.removeEventListener('storage', listener)
  }
}
function readTheme(): Theme {
  try {
    const value = localStorage.getItem('punchline-theme')
    return value === 'system' || value === 'light' ? value : 'dark'
  } catch { return 'dark' }
}

export default function MemberMenu({ identity }: { identity: Identity | null }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'dark' as Theme)

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('a, input:checked, button')?.focus()
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function chooseTheme(value: Theme) {
    document.documentElement.setAttribute('data-theme', value)
    try { localStorage.setItem('punchline-theme', value) } catch {}
    window.dispatchEvent(new Event('punchline-theme'))
  }

  return (
    <div className="member-menu" ref={root}>
      {open && (
        <div id="member-panel" className="member-panel" aria-label="Member and appearance settings">
          {identity ? (
            <div className="member-identity">
              <p className="menu-label">SIGNED IN AS</p>
              <strong>{identity.name}</strong>
              <p className="member-email">{identity.email}</p>
            </div>
          ) : <p className="menu-label">MAKE YOURSELF AT HOME</p>}
          {identity && (
            <nav className="member-links" aria-label="Member">
              <Link href="/" onClick={() => setOpen(false)}>Explore captions <span aria-hidden="true">↗</span></Link>
              <Link href="/dashboard" onClick={() => setOpen(false)}>My votes <span aria-hidden="true">↗</span></Link>
              <Link href="/profile" onClick={() => setOpen(false)}>Account settings <span aria-hidden="true">↗</span></Link>
            </nav>
          )}
          <fieldset className="theme-picker">
            <legend className="menu-label">THEME</legend>
            <div className="theme-options">
              {themeOptions.map((option) => (
                <label key={option.value} className="theme-option" title={option.label}>
                  <input type="radio" name="theme" value={option.value} checked={theme === option.value} onChange={() => chooseTheme(option.value)} aria-label={option.label} />
                  <span aria-hidden="true">{option.icon}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {identity && <SignOutButton />}
        </div>
      )}
      <button ref={trigger} type="button" className="member-trigger" aria-label={open ? 'Close member menu' : identity ? 'Open member menu' : 'Theme and profile'} aria-expanded={open} aria-controls={open ? 'member-panel' : undefined} onClick={() => setOpen((value) => !value)}>
        {open ? <span className="menu-close" aria-hidden="true">×</span> : identity?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4a3.3 3.3 0 1 1 0 6.6A3.3 3.3 0 0 1 12 6Zm-5.7 11.3a6.5 6.5 0 0 1 11.4 0A7.7 7.7 0 0 1 12 20a7.7 7.7 0 0 1-5.7-2.7Z" clipRule="evenodd" /></svg>}
      </button>
    </div>
  )
}
