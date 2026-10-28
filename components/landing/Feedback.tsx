"use client"

import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Star, Send, CheckCircle2, Loader2 } from 'lucide-react'
import { getAuthHeaders, getBackendUrl } from '@/lib/utils'

const ROLES = [
  { value: 'student', label: 'Student / candidate' },
  { value: 'teacher', label: 'Teacher / trainer' },
  { value: 'examiner', label: 'Examiner / proctor' },
  { value: 'developer', label: 'Developer / IT' },
  { value: 'business', label: 'Team / business' },
  { value: 'other', label: 'Something else' },
]

const field = 'w-full rounded-2xl bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-zinc-600 focus:outline-none focus:border-[var(--accent)] transition-colors'
const label = 'block text-[11px] font-bold tracking-widest uppercase text-zinc-500 mb-2'

// "Help us improve" form at the bottom of the landing page; answers are stored on the server
// (POST /api/feedback) and read by admins under Admin → Feedback
export function Feedback() {
  const [form, setForm] = useState({ name: '', email: '', role: 'student', problem: '', improvement: '', contactOk: true, website: '' })
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  // A signed-in visitor does not have to type their name and email again
  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('ircp_user') || 'null')
      if (user?.name || user?.email) setForm(f => ({ ...f, name: f.name || user.name || '', email: f.email || user.email || '' }))
    } catch { /* not signed in */ }
  }, [])

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: event.target.type === 'checkbox' ? (event.target as HTMLInputElement).checked : event.target.value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setState('sending')
    try {
      const res = await fetch(`${getBackendUrl()}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ ...form, rating: rating || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not send your feedback. Please try again.')
      setState('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your feedback. Please try again.')
      setState('idle')
    }
  }

  return (
    <section id="feedback" className="py-24 sm:py-32 px-4 relative bg-[var(--bg)] overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--violet-glow)_0%,transparent_60%)] pointer-events-none" />
      <div className="max-w-5xl mx-auto relative z-10 grid lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-16 items-start">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center lg:text-left">
          <p className="text-[var(--accent)] font-bold tracking-[0.3em] text-xs uppercase mb-4">Your feedback</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight">
            Help us improve Let&apos;s Collab,{' '}
            <span className="italic font-light font-display text-transparent bg-clip-text bg-gradient-to-r from-zinc-400 to-white">and make it yours</span>
          </h2>
          <p className="mt-5 text-zinc-400 leading-relaxed">
            Tell us what got in your way and what you wish it did. Every answer is read by the team and shapes what we build next.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-zinc-500 inline-block text-left">
            <li>• Takes about a minute</li>
            <li>• Your email is only used to reply, if you allow it</li>
            <li>• Never shown publicly or shared</li>
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
          className="rounded-3xl bg-[var(--elevated)] border border-[var(--border)]/60 p-6 sm:p-8">
          {state === 'sent' ? (
            <div className="py-12 text-center" role="status">
              <CheckCircle2 className="w-14 h-14 mx-auto text-[var(--accent)]" />
              <h3 className="mt-5 text-2xl font-black">Thank you, {form.name.split(' ')[0] || 'friend'}!</h3>
              <p className="mt-3 text-zinc-400 text-sm max-w-sm mx-auto">Your feedback reached the team.{form.contactOk ? ' We may email you if we have a question or once it is fixed.' : ''}</p>
              <button type="button" onClick={() => { setForm(f => ({ ...f, problem: '', improvement: '' })); setRating(0); setState('idle') }}
                className="mt-6 text-sm font-bold text-[var(--accent)] hover:underline">Send another response</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fb-name" className={label}>Name</label>
                  <input id="fb-name" required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={set('name')} className={field} placeholder="Your name" />
                </div>
                <div>
                  <label htmlFor="fb-email" className={label}>Email</label>
                  <input id="fb-email" type="email" required maxLength={254} autoComplete="email" value={form.email} onChange={set('email')} className={field} placeholder="you@example.com" />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fb-role" className={label}>You use it as</label>
                  <select id="fb-role" value={form.role} onChange={set('role')} className={field}>
                    {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </div>
                <div>
                  <span className={label} id="fb-rating-label">Overall rating <span className="normal-case tracking-normal font-normal">(optional)</span></span>
                  <div className="flex gap-1 h-[46px] items-center" role="radiogroup" aria-labelledby="fb-rating-label" onMouseLeave={() => setHover(0)}>
                    {[1, 2, 3, 4, 5].map(value => (
                      <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value > 1 ? 's' : ''}`}
                        onClick={() => setRating(rating === value ? 0 : value)} onMouseEnter={() => setHover(value)} className="p-1">
                        <Star className={`w-6 h-6 transition-colors ${(hover || rating) >= value ? 'fill-[var(--accent)] text-[var(--accent)]' : 'text-zinc-600'}`} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="fb-problem" className={label}>What exact problem did you face?</label>
                <textarea id="fb-problem" required minLength={10} maxLength={2000} rows={3} value={form.problem} onChange={set('problem')} className={`${field} resize-y`}
                  placeholder="e.g. Screen share lagged when I turned on my avatar, or I could not find how to end the session" />
              </div>

              <div>
                <label htmlFor="fb-improve" className={label}>How can Let&apos;s Collab improve for you? <span className="normal-case tracking-normal font-normal">(optional)</span></label>
                <textarea id="fb-improve" maxLength={2000} rows={3} value={form.improvement} onChange={set('improvement')} className={`${field} resize-y`}
                  placeholder="A feature you want, something to simplify, or how you would like it personalised" />
              </div>

              {/* Hidden from people; bots that fill it in are ignored */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} className="hidden" aria-hidden />

              <label className="flex items-start gap-3 text-sm text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={form.contactOk} onChange={set('contactOk')} className="mt-1 accent-[var(--accent)]" />
                You may email me about this feedback
              </label>

              {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

              <button type="submit" disabled={state === 'sending'}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full bg-white text-black font-black hover:bg-[var(--accent)] transition-colors disabled:opacity-60">
                {state === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {state === 'sending' ? 'Sending…' : 'Send feedback'}
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  )
}
