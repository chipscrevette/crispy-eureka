import { getJson } from './grid'
import type { ProfileId } from './stores'
import { lang } from './i18n'

/** One recorded query behind an Ask Adresse answer. */
export type ToolCall = { tool: string; args: Record<string, unknown>; result: unknown }

export type AskAnswer = {
  id: string
  question: string
  answer: string
  /** The same answer in French, built from the same tool results (pipeline: adresse_pipeline.ask). */
  question_fr?: string
  answer_fr?: string
  profile: ProfileId | null
  cells: string[]
  compare: boolean
  calls: ToolCall[]
}

/** The answers in the visitor's language; an older data build without French falls back to English. */
export const loadAnswers = () =>
  getJson<{ answers: AskAnswer[] }>('ask.json').then((d) =>
    lang() === 'en'
      ? d.answers
      : d.answers.map((a) => ({ ...a, question: a.question_fr ?? a.question, answer: a.answer_fr ?? a.answer })),
  )
