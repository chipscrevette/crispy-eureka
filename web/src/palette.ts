import type { ExpressionSpecification } from 'maplibre-gl'
import type { ProfileId } from './stores'

/** Each map layer gets its own colour family, so a glance tells which data is on the map. */
export type Ramp = { light: string[]; dark: string[] }

const RAMPS: Record<string, Ramp> = {
  // luxury potential: mint to deep blue
  score: {
    light: ['#d4efe5', '#8fd5bf', '#3bab9c', '#1e7590', '#2b3a80'],
    dark: ['#1d3a36', '#2f7f72', '#45b3a1', '#6fd0d6', '#b7c4ff'],
  },
  // spending: sand to wine
  spending: {
    light: ['#fdebcf', '#f8c27f', '#f08b4c', '#d6524a', '#9b2b52'],
    dark: ['#3d2a1d', '#8a5428', '#d4813f', '#f0a36b', '#ffd2a8'],
  },
  // income: pale to forest green
  income: {
    light: ['#e5f3d6', '#b5dc96', '#76be6b', '#3c9357', '#1c6146'],
    dark: ['#1f3322', '#3a6b3e', '#5ea55e', '#8fd18a', '#c8f0bd'],
  },
  // people passing: lilac to violet
  footfall: {
    light: ['#ede5f8', '#c9b4e8', '#9d80d4', '#6d50b4', '#432f80'],
    dark: ['#2a2240', '#4f3d84', '#7d63c4', '#a991e6', '#d9ccff'],
  },
  // prices: ice to navy
  price: {
    light: ['#deebf7', '#a9cbe8', '#6aa3d4', '#3477b8', '#1d4f8f'],
    dark: ['#1b2a3d', '#2d5584', '#4f86c4', '#86b5e6', '#c7defa'],
  },
}

/** Which colour family a layer key uses; anything not listed uses the potential ramp. */
export function rampFor(key: string): Ramp {
  if (key.startsWith('score')) return RAMPS.score
  if (key.startsWith('demand')) return RAMPS.spending
  if (key.includes('living_standard') || key.includes('owners')) return RAMPS.income
  if (key.includes('transit') || key.includes('dining') || key.includes('hotels') || key.includes('upscale') || key.includes('tourist') || key.includes('street') || key.includes('culture'))
    return RAMPS.footfall
  if (key.includes('price') || key.includes('sales') || key.includes('vacant')) return RAMPS.price
  return RAMPS.score
}

export const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
export const coloursOf = (r: Ramp) => (isDark() ? r.dark : r.light)

/** Profile colours, for boutique dots and the profile switch. */
export const PROFILE_COLOUR: Record<ProfileId, { light: string; dark: string }> = {
  'jewellery-watches': { light: '#b8860b', dark: '#e6c065' },
  'fashion-house': { light: '#7c4dbc', dark: '#b897ec' },
  beauty: { light: '#d0496b', dark: '#f28aa3' },
}
export const profileColour = (p: ProfileId) => (isDark() ? PROFILE_COLOUR[p].dark : PROFILE_COLOUR[p].light)

/** Class of a value: 0 below the first break, up to breaks.length above the last. */
export function stepExpr(key: string, breaks: number[], outputs: (string | number)[]): ExpressionSpecification {
  const steps = breaks.flatMap((b, i) => [b, outputs[i + 1]])
  return ['step', ['get', key], outputs[0], ...steps] as ExpressionSpecification
}

/** Block heights in 3D, in metres per class: taller means higher on the layer. */
export const HEIGHTS = [12, 60, 120, 190, 270]
