import { useEffect, useRef, useState } from 'react'
import type { AskAnswer, ToolCall } from './answers'

type Props = {
  answers: AskAnswer[]
  /** The question to open with, from a shared link. */
  first: string | null
  onAsked: (id: string) => void
  onShow: (a: AskAnswer) => void
  onMemo: (a: AskAnswer) => void
  onMethod: () => void
  onClose: () => void
}

function signature(call: ToolCall) {
  const args = Object.entries(call.args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')
  return `${call.tool}(${args})`
}

export default function Ask({ answers, first, onAsked, onShow, onMemo, onMethod, onClose }: Props) {
  const [asked, setAsked] = useState<string[]>(() => (answers.some((a) => a.id === first) ? [first!] : []))
  const drawer = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => {
    drawer.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (asked.length > 1) end.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [asked])

  const ask = (id: string) => {
    setAsked((xs) => [...xs.filter((x) => x !== id), id])
    onAsked(id)
  }
  const byId = new Map(answers.map((a) => [a.id, a]))
  const remaining = answers.filter((a) => !asked.includes(a.id))

  return (
    <div className="ask" role="dialog" aria-modal="false" aria-labelledby="ask-title" tabIndex={-1} ref={drawer}>
      <div className="ask-bar">
        <h2 id="ask-title">Ask Adresse</h2>
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="muted small ask-note">
        Answers are pre-recorded. Each one was produced by running the queries listed under it on this site's data, and
        every figure in it comes from a query result.
      </p>

      <ol className="ask-thread" aria-live="polite">
        {asked.map((id, i) => {
          const a = byId.get(id)!
          return (
            <li key={id} ref={i === asked.length - 1 ? end : undefined}>
              <p className="ask-q">{a.question}</p>
              <div className="ask-a">
                <p>{a.answer}</p>
                <details>
                  <summary>
                    {a.calls.length} {a.calls.length === 1 ? 'query' : 'queries'} run
                  </summary>
                  <ol className="ask-calls">
                    {a.calls.map((c, j) => (
                      <li key={j}>
                        <code>{signature(c)}</code>
                        <pre>{JSON.stringify(c.result, null, 1)}</pre>
                      </li>
                    ))}
                  </ol>
                </details>
                <div className="ask-actions">
                  {a.cells.length > 0 && (
                    <button className="button" onClick={() => onShow(a)}>
                      {a.compare ? 'Compare on the map' : 'Show on the map'}
                    </button>
                  )}
                  {a.cells.length > 0 && !a.compare && (
                    <button className="button secondary" onClick={() => onMemo(a)}>
                      Site memo
                    </button>
                  )}
                  {a.cells.length === 0 && (
                    <button className="button secondary" onClick={onMethod}>
                      How it works
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {remaining.length > 0 && (
        <section aria-labelledby="ask-more">
          <h3 id="ask-more" className="label">
            {asked.length ? 'Ask another' : 'Pick a question'}
          </h3>
          <ul className="ask-questions">
            {remaining.map((a) => (
              <li key={a.id}>
                <button className="ask-question" onClick={() => ask(a.id)}>
                  {a.question}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
