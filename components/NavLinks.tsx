'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavLinks() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="nav-main">
      <Link href="/" className="nav-link" aria-current={pathname === '/' ? 'page' : undefined}>Captions</Link>
      <Link href="/create" className="nav-link" aria-current={pathname === '/create' ? 'page' : undefined}>Caption lab</Link>
      <Link href="/dashboard" className="nav-link" aria-current={pathname === '/dashboard' ? 'page' : undefined}>My votes</Link>
    </nav>
  )
}
