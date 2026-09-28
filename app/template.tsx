// A template re-mounts on every navigation, so its animation plays on each page change.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
