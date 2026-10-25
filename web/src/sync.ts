import type { ProfileId } from './stores'

/** What the map and the dashboard share: the brand type, the layer on the map and the selected block. */
export type Shared = { profile: ProfileId; layer: string; cell: string | null }

type Side = 'map' | 'dashboard'
type Message = { kind: 'state'; from: Side; state: Shared } | { kind: 'hello' | 'bye'; from: Side }
type Handlers = { onState: (s: Shared) => void; onHello?: () => void; onBye?: () => void }

const CHANNEL = 'adresse-sync'
const PREFS = ['adresse-lang', 'adresse-theme']

/**
 * Keeps two tabs of the site in step, with no server: the browser's BroadcastChannel carries each
 * change to every other open tab of the same site. A tab that opens says hello and the others answer
 * with their state; a tab that closes says bye. A change of language or theme in one tab reloads the
 * other, the way it reloads the tab where it was made.
 */
export function connect(side: Side, on: Handlers) {
  const onPrefs = (e: StorageEvent) => {
    if (e.key && PREFS.includes(e.key)) window.location.reload()
  }
  window.addEventListener('storage', onPrefs)
  if (typeof BroadcastChannel === 'undefined')
    return { send: () => {}, close: () => window.removeEventListener('storage', onPrefs) }
  const channel = new BroadcastChannel(CHANNEL)
  const post = (m: Message) => channel.postMessage(m)
  channel.onmessage = (e: MessageEvent<Message>) => {
    const m = e.data
    if (m.from === side) return
    if (m.kind === 'hello') on.onHello?.()
    else if (m.kind === 'bye') on.onBye?.()
    else if (m.kind === 'state') on.onState(m.state)
  }
  const bye = () => post({ kind: 'bye', from: side })
  window.addEventListener('pagehide', bye)
  post({ kind: 'hello', from: side })
  return {
    send: (state: Shared) => post({ kind: 'state', from: side, state }),
    close: () => {
      bye()
      channel.close()
      window.removeEventListener('pagehide', bye)
      window.removeEventListener('storage', onPrefs)
    },
  }
}

export const sameShared = (a: Shared, b: Shared | null) =>
  !!b && a.profile === b.profile && a.layer === b.layer && a.cell === b.cell

/** The dashboard's address next to the map's, so it opens from GitHub Pages and from the dev server alike. */
export const DASHBOARD_URL = `${import.meta.env.BASE_URL}dashboard.html`
export const DASHBOARD_WINDOW = 'adresse-dashboard'
