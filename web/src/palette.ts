import { useSyncExternalStore } from 'react'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { ProfileId } from './stores'

/** Each map layer gets its own colour family, so a glance tells which data is on the map. */
export type Ramp = { light: string[]; dark: string[] }

const RAMPS = {
  // luxury potential: sand to wine, the colour of the answer
  score: {
    light: ['#f1dcc4', '#e6b083', '#d47a52', '#b2432f', '#6b1a2b'],
    dark: ['#3b2621', '#7d3c2d', '#c46242', '#ec986b', '#ffd3ad'],
  },
  // spending: ice to deep blue
  spending: {
    light: ['#dde8f8', '#a8c4ee', '#6d9be0', '#3a6fcb', '#1f4596'],
    dark: ['#1b2840', '#2c4f8a', '#4a7ed0', '#80aef0', '#c4dafc'],
  },
  // income: pale to forest green
  income: {
    light: ['#e5f3d6', '#b5dc96', '#76be6b', '#3c9357', '#1c6146'],
    dark: ['#1f3322', '#3a6b3e', '#5ea55e', '#8fd18a', '#c8f0bd'],
  },
  // people on the pavement: blush to red
  footfall: {
    light: ['#fbe0dc', '#f4aea4', '#e8705f', '#cc3b2e', '#8c1d1d'],
    dark: ['#3d211f', '#83382f', '#d0574a', '#f08c7e', '#ffc9c0'],
  },
  // stations: lilac to violet
  transit: {
    light: ['#ede5f8', '#c9b4e8', '#9d80d4', '#6d50b4', '#432f80'],
    dark: ['#2a2240', '#4f3d84', '#7d63c4', '#a991e6', '#d9ccff'],
  },
  // shops: pink to magenta
  shops: {
    light: ['#f9e1ee', '#f0afd1', '#de6fae', '#c03e8a', '#7f1f5c'],
    dark: ['#3a1f30', '#7c3462', '#c45496', '#ec8dc2', '#ffcbe6'],
  },
  // luxury already there: mist to ink
  luxury: {
    light: ['#e2e2e0', '#b4b5b6', '#7e8186', '#4b4f56', '#16191d'],
    dark: ['#24282e', '#454b54', '#737b86', '#a9b0ba', '#eef2f6'],
  },
  // hotels: cream to amber
  hotels: {
    light: ['#fcecd2', '#f6cc8c', '#eba54a', '#c97a1c', '#8a4e0e'],
    dark: ['#3a2c18', '#7c5622', '#c98a34', '#f0b765', '#ffe0a8'],
  },
  // offices: mint to green
  offices: {
    light: ['#daf1e6', '#a2dcc0', '#5ebf95', '#25976b', '#0f6447'],
    dark: ['#17332a', '#22664c', '#33a074', '#6fd0a5', '#bff0d8'],
  },
  // prices: sand to bronze
  price: {
    light: ['#efe7da', '#d8c4a2', '#b99a6a', '#8f6c3d', '#5c4221'],
    dark: ['#2f2a22', '#5c4d36', '#94784f', '#c6a878', '#ecdcbc'],
  },
} satisfies Record<string, Ramp>
type RampName = keyof typeof RAMPS

/** Which colour family a layer key uses; anything not listed uses the potential ramp. */
export function rampFor(key: string): Ramp {
  return RAMPS[rampNameFor(key)]
}

function rampNameFor(key: string): RampName {
  if (key.startsWith('score')) return 'score'
  if (key.startsWith('demand')) return 'spending'
  if (key.startsWith('luxury')) return 'luxury'
  if (key.includes('living_standard') || key.includes('owners')) return 'income'
  if (key.includes('street')) return 'footfall'
  if (key.includes('transit')) return 'transit'
  if (key.includes('fashion') || key.includes('beauty') || key.includes('mass_market')) return 'shops'
  if (key.includes('hotels') || key.includes('upscale') || key.includes('tourist') || key.includes('dining') || key.includes('culture'))
    return 'hotels'
  if (key.includes('offices')) return 'offices'
  if (key.includes('price') || key.includes('sales') || key.includes('vacan')) return 'price'
  return 'score'
}

/** The theme index.html set from the visitor's choice or their system. */
export const isDark = () => document.documentElement.dataset.theme === 'dark'

const themeListeners = new Set<() => void>()

/** Switches day and night in place: the CSS colours follow at once, the canvases redraw. */
export function switchTheme() {
  const next = isDark() ? 'light' : 'dark'
  try {
    localStorage.setItem('adresse-theme', next)
  } catch {
    // the switch still works for this visit
  }
  document.documentElement.dataset.theme = next
  themeListeners.forEach((l) => l())
}

/** The theme, as React state, for whatever computes colours in script rather than CSS. */
export const useTheme = () =>
  useSyncExternalStore(
    (l) => {
      themeListeners.add(l)
      return () => themeListeners.delete(l)
    },
    () => (isDark() ? 'dark' : 'light'),
  )
export const coloursOf = (r: Ramp) => (isDark() ? r.dark : r.light)

/** Profile colours, for boutique dots and the profile switch: muted, so the dots read as data, not jewels. */
export const PROFILE_COLOUR: Record<ProfileId, { light: string; dark: string }> = {
  'jewellery-watches': { light: '#9a7a3c', dark: '#b8a06e' },
  'fashion-house': { light: '#6e5a9c', dark: '#9d8fc2' },
  beauty: { light: '#a85870', dark: '#c48c9b' },
}
export const profileColour = (p: ProfileId) => (isDark() ? PROFILE_COLOUR[p].dark : PROFILE_COLOUR[p].light)

/** Class of a value: 0 below the first break, up to breaks.length above the last. */
export function stepExpr(key: string, breaks: number[], outputs: (string | number)[]): ExpressionSpecification {
  const steps = breaks.flatMap((b, i) => [b, outputs[i + 1]])
  return ['step', ['get', key], outputs[0], ...steps] as ExpressionSpecification
}

/** Walking-zone rings, from the nearest to the farthest: neutral, so they read on every layer's colours. */
const WALK = { light: ['#16191d', '#3d424a', '#646a72', '#8b9098'], dark: ['#f4f6f8', '#cfd4da', '#a8afb8', '#838b96'] }
export const walkColour = (band: number) => (isDark() ? WALK.dark : WALK.light)[Math.min(band, WALK.light.length - 1)]

/** Block heights in 3D, in metres per class: taller means higher on the layer. */
export const HEIGHTS = [12, 60, 120, 190, 270]
