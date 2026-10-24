import { PROFILES, type ProfileId } from './stores'

/** What the address bar remembers, so a block, a comparison or a memo can be shared as a link. */
export type View = {
  profile: ProfileId
  a: string | null
  b: string | null
  memo: boolean
  method: boolean
  ask: string | null
}

export function readHash(): View {
  const q = new URLSearchParams(window.location.hash.slice(1))
  const profile = PROFILES.find((p) => p.id === q.get('profile'))?.id ?? 'jewellery-watches'
  return {
    profile,
    a: q.get('a'),
    b: q.get('b'),
    memo: q.get('memo') === '1' && !!q.get('a'),
    method: q.get('method') === '1',
    // '1' opens Ask Adresse on its question list, a question id opens that answer
    ask: q.get('ask'),
  }
}

export function writeHash(v: View) {
  const q = new URLSearchParams({ profile: v.profile })
  if (v.a) q.set('a', v.a)
  if (v.b) q.set('b', v.b)
  if (v.memo) q.set('memo', '1')
  if (v.method) q.set('method', '1')
  if (v.ask) q.set('ask', v.ask)
  window.history.replaceState(null, '', `#${q}`)
}
