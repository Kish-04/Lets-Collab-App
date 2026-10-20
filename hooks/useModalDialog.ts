import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keyboard and screen-reader behaviour for a modal panel: moves focus into it when it opens, keeps
 * Tab inside it, closes on Escape, and gives focus back to whatever was focused before. Put the
 * returned ref on the panel together with role="dialog" aria-modal="true" aria-labelledby.
 */
export function useModalDialog<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
    const panelRef = useRef<T | null>(null)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    useEffect(() => {
        if (!open) return
        const previouslyFocused = document.activeElement as HTMLElement | null
        const panel = panelRef.current
        const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])
        ;(focusables()[0] || panel)?.focus()

        const onKeyDown = (event: KeyboardEvent) => {
            // Plain Escape only: Shift+Esc / Ctrl+Alt+Esc is the emergency revoke and must still fire
            if (event.key === 'Escape' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                event.stopPropagation()
                onCloseRef.current()
                return
            }
            if (event.key !== 'Tab' || !panel) return
            const items = focusables()
            if (items.length === 0) return
            const first = items[0]
            const last = items[items.length - 1]
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
            document.removeEventListener('keydown', onKeyDown, true)
            previouslyFocused?.focus?.()
        }
    }, [open])

    return panelRef
}
