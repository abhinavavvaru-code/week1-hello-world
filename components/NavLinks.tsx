'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Jokes', signedInOnly: false },
  { href: '/dashboard', label: 'My votes', signedInOnly: true },
  { href: '/profile', label: 'Profile', signedInOnly: true },
]

export default function NavLinks({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="nav-main">
      <ul className="nav-links">
        {links
          .filter((link) => signedIn || !link.signedInOnly)
          .map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="nav-link"
                aria-current={pathname === link.href ? 'page' : undefined}
              >
                {link.label}
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  )
}
