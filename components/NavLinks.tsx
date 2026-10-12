'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavLinks() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="nav-main">
      <Link href="/" className="nav-link" aria-current={pathname === '/' ? 'page' : undefined}>Gallery</Link>
      <Link href="/create" className="nav-link" aria-current={pathname === '/create' ? 'page' : undefined}>Create</Link>
      <Link href="/my-posts" className="nav-link" aria-current={pathname === '/my-posts' ? 'page' : undefined}>My posts</Link>
      <Link href="/dashboard" className="nav-link" aria-current={pathname === '/dashboard' ? 'page' : undefined}>My votes</Link>
    </nav>
  )
}
