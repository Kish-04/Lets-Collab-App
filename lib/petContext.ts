// Latest code the user is editing, so the AI pet can answer debugging questions about it
const MAX_CODE_CHARS = 8000

let codeContext: { code: string; language: string } | null = null

export function setPetCodeContext(code: string, language = 'javascript') {
    codeContext = code.trim() ? { code: code.slice(0, MAX_CODE_CHARS), language } : null
}

export function getPetCodeContext() {
    return codeContext
}
