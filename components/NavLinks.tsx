'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function NavLinks({ signedIn = false }: { signedIn?: boolean }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="nav-main">
      <Link href="/explore" className="nav-link" aria-current={pathname === '/' || pathname === '/explore' ? 'page' : undefined}>Explore</Link>
      <Link href="/create" className="nav-link" aria-current={pathname === '/create' ? 'page' : undefined}>Create</Link>
      {signedIn && <Link href="/my-posts" className="nav-link" aria-current={pathname === '/my-posts' ? 'page' : undefined}>My posts</Link>}
      {signedIn && <Link href="/dashboard" className="nav-link" aria-current={pathname === '/dashboard' ? 'page' : undefined}>My votes</Link>}
    </nav>
  )
}
