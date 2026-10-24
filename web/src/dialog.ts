import { useEffect, type RefObject } from 'react'

// Open overlays, newest last: Escape closes only the one on top.
const stack: RefObject<HTMLElement | null>[] = []

/** Focus an overlay when it opens, close it on Escape, and give focus back when it closes. */
export function useDialog(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    stack.push(ref)
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === ref) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(ref), 1)
      if (opener?.isConnected) opener.focus()
    }
  }, [ref, onClose])
}
