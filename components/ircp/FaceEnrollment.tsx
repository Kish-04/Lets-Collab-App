'use client'

import { useEffect, useRef, useState } from 'react'
import { ScanFace } from 'lucide-react'
import { getAuthHeaders, getBackendUrl } from '@/lib/utils'
import { describeFaceSteadily, FACE_ERROR_TEXT } from '@/lib/faceMatch'

// Profile section: set up Face ID once. The camera frame is turned into a 128-number descriptor on
// this device; only those numbers are sent. Supervised exams compare against it at the start.
export function FaceEnrollment() {
    const [status, setStatus] = useState<{ enrolled: boolean; enrolledAt: string | null } | null>(null)
    const [cameraOn, setCameraOn] = useState(false)
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)

    useEffect(() => {
        fetch(`${getBackendUrl()}/api/face/status`, { headers: getAuthHeaders() })
            .then(res => res.json())
            .then(data => { if (data.success) setStatus({ enrolled: data.enrolled, enrolledAt: data.enrolledAt }) })
            .catch(() => setMessage('Could not load your Face ID status.'))
        return () => streamRef.current?.getTracks().forEach(track => track.stop())
    }, [])

    const stopCamera = () => {
        streamRef.current?.getTracks().forEach(track => track.stop())
        streamRef.current = null
        setCameraOn(false)
    }

    const startCamera = async () => {
        setMessage('')
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
            streamRef.current = stream
            setCameraOn(true)
            requestAnimationFrame(() => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                    void videoRef.current.play()
                }
            })
        } catch {
            setMessage('Camera access was blocked. Allow the camera to set up Face ID.')
        }
    }

    const enroll = async () => {
        if (!videoRef.current) return
        setBusy(true)
        setMessage('Hold still and look at the camera…')
        try {
            const sample = await describeFaceSteadily(videoRef.current)
            if ('error' in sample) {
                setMessage(FACE_ERROR_TEXT[sample.error])
                return
            }
            const res = await fetch(`${getBackendUrl()}/api/face/enroll`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ descriptor: sample.descriptor }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.message || 'Could not save your Face ID.')
            setStatus({ enrolled: true, enrolledAt: data.enrolledAt })
            setMessage('Face ID is set up.')
            stopCamera()
        } catch (err: any) {
            setMessage(err.message || 'Could not set up Face ID (the face model may still be downloading).')
        } finally {
            setBusy(false)
        }
    }

    return (
        <section aria-labelledby="face-id-title" className="pt-6 border-t border-[var(--border)] space-y-3">
            <h2 id="face-id-title" className="flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-[var(--text-dim)]">
                <ScanFace className="w-4 h-4" /> Face ID for supervised exams
            </h2>
            {status?.enrolled ? (
                <p className="text-sm text-[var(--text-secondary)]">
                    Set up{status.enrolledAt ? ` on ${new Date(status.enrolledAt).toLocaleDateString()}` : ''}. Supervised exams check it when you join. To replace it, ask an administrator to reset it.
                </p>
            ) : (
                <p className="text-sm text-[var(--text-secondary)]">
                    Supervised exams check that the person taking them is you. Your photo never leaves this device: only a set of 128 numbers describing your face is stored.
                </p>
            )}
            {!status?.enrolled && !cameraOn && (
                <button type="button" onClick={() => void startCamera()} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--text-primary)] hover:border-[var(--accent)]">
                    Set up Face ID
                </button>
            )}
            {cameraOn && (
                <div className="space-y-3">
                    <video ref={videoRef} muted playsInline aria-label="Camera preview" className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-black" />
                    <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void enroll()} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50">
                            {busy ? 'Scanning…' : 'Capture and save'}
                        </button>
                        <button type="button" disabled={busy} onClick={stopCamera} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)]">
                            Cancel
                        </button>
                    </div>
                </div>
            )}
            {message && <p role="status" className="text-sm text-[var(--text-secondary)]">{message}</p>}
        </section>
    )
}
