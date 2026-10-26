"use client"

import { useEffect } from 'react'
import { PetMessageQueue, proctoringKind, proctoringRule } from './proctoringPolicy'

// One pet per page: the session page registers its pet state setters once, and any code (detectors,
// socket handlers) can queue a warning with petWarn() without passing callbacks around.
let activeQueue: PetMessageQueue | null = null

/**
 * Queues a pet robot warning. Messages are shown one after another; the same `key` (default: the
 * text) is shown at most once every 20 s. Returns false when it was dropped as a repeat.
 */
export function petWarn(text: string, key?: string) {
    return activeQueue ? activeQueue.push(text, key) : false
}

export function usePetWarnings(
    setPetState: (state: 'Idle' | 'Warning') => void,
    setPetMessage: (message: string) => void,
) {
    useEffect(() => {
        const queue = new PetMessageQueue({
            show: (text) => { setPetState('Warning'); setPetMessage(text) },
            clear: () => { setPetState('Idle'); setPetMessage('') },
        })
        activeQueue = queue
        return () => {
            queue.dispose()
            if (activeQueue === queue) activeQueue = null
        }
    }, [setPetState, setPetMessage])
}

/**
 * Tells the candidate on their pet what was detected. `message` is the detector's own friendly text;
 * without it the policy's text for that kind is used. From the third repeat the pet says the host knows.
 */
export function warnCandidate(type: string, count = 1, message?: string) {
    const text = (message && message.trim()) || proctoringRule(type).pet
    return petWarn(count >= 3 ? `${text} (Repeated ${count} times — your host has been notified.)` : text, proctoringKind(type))
}
