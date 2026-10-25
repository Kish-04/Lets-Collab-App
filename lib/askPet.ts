import { getAuthHeaders, getBackendUrl } from './utils'
import { getPetCodeContext } from './petContext'

// Asks the Gemini pet. Tries the backend first, then the web app's own /api/pet route (both
// require a signed-in user). Both expect { message, codeContext } and answer with { text }.
export async function askPet(message: string): Promise<string> {
    const body = JSON.stringify({ message, codeContext: getPetCodeContext() })
    const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() }
    // A failing endpoint may still explain why (e.g. the API key was rejected): keep that for the user
    let reason = ''
    for (const url of [`${getBackendUrl()}/api/pet`, '/api/pet']) {
        try {
            const res = await fetch(url, { method: 'POST', headers, body })
            const data = await res.json().catch(() => null)
            const text = typeof data?.text === 'string' ? data.text : ''
            if (res.ok && text) return text
            if (text && !reason) reason = text
        } catch {
            // try the next endpoint
        }
    }
    throw new Error(reason || 'The pet assistant is unavailable right now.')
}
