import { getAuthHeaders, getBackendUrl } from './utils'
import { getPetCodeContext } from './petContext'

// Asks the Gemini pet. Tries the backend first, then the web app's own /api/pet route (both
// require a signed-in user). Both expect { message, codeContext } and answer with { text }.
export async function askPet(message: string): Promise<string> {
    const body = JSON.stringify({ message, codeContext: getPetCodeContext() })
    const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() }
    for (const url of [`${getBackendUrl()}/api/pet`, '/api/pet']) {
        try {
            const res = await fetch(url, { method: 'POST', headers, body })
            if (!res.ok) continue
            const data = await res.json()
            if (typeof data.text === 'string' && data.text) return data.text
        } catch {
            // try the next endpoint
        }
    }
    throw new Error('The pet assistant is unavailable right now.')
}
