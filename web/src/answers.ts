import { getJson } from './grid'
import type { ProfileId } from './stores'

/** One recorded query behind an Ask Adresse answer. */
export type ToolCall = { tool: string; args: Record<string, unknown>; result: unknown }

export type AskAnswer = {
  id: string
  question: string
  answer: string
  profile: ProfileId | null
  cells: string[]
  compare: boolean
  calls: ToolCall[]
}

export const loadAnswers = () => getJson<{ answers: AskAnswer[] }>('ask.json').then((d) => d.answers)
