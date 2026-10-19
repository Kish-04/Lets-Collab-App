// Server-only helper for Next.js route handlers: is the caller signed in? The bearer token is
// checked by the backend that issued it (/api/auth/me), so the web app needs no JWT secret.
export async function isSignedIn(req: Request) {
    const authorization = req.headers.get('authorization') || ''
    if (!/^Bearer\s+\S+/i.test(authorization)) return false
    const backend = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8081').replace(/\/+$/, '')
    try {
        const res = await fetch(`${backend}/api/auth/me`, { headers: { authorization }, cache: 'no-store' })
        return res.ok
    } catch {
        return false
    }
}
