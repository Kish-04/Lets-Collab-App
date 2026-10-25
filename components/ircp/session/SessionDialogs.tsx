'use client'

// Dialogs and overlays of the live session page. They hold no session state: the page passes the
// values, the callbacks, and the ref from useModalDialog that gives each panel its keyboard handling.
import type { Ref } from 'react'
import { Monitor, X, XCircle, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AiCalibration = {
    eyeTrackingThreshold: number
    emotionSensitivity: number
    audioVolumeThreshold: number
    headPoseMargin: number
}

const SLIDERS: { key: keyof AiCalibration; label: string; min: number; max: number; step: number; help: string }[] = [
    { key: 'eyeTrackingThreshold', label: 'Eye Tracking Threshold', min: 0.5, max: 0.95, step: 0.05, help: 'Lower = More sensitive (catches subtle movements). Higher = Less sensitive.' },
    { key: 'emotionSensitivity', label: 'Emotion Sensitivity', min: 0.4, max: 0.9, step: 0.05, help: 'Lower = Detects micro-expressions. Higher = Only extreme expressions.' },
    { key: 'headPoseMargin', label: 'Head Pose Margin', min: 0.2, max: 1.0, step: 0.1, help: "Margin before triggering 'Looking Away'. Higher = More leeway." },
]

export function AiCalibrationDialog({ dialogRef, config, onChange, onApply, applyLabel, onClose }: {
    dialogRef: Ref<HTMLDivElement>
    config: AiCalibration
    onChange: (update: (current: AiCalibration) => AiCalibration) => void
    onApply: () => void
    applyLabel: string
    onClose: () => void
}) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ai-calibration-title" className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--elevated)]">
                    <div className="flex items-center gap-2 text-[var(--accent)]">
                        <Zap className="w-5 h-5" />
                        <h3 id="ai-calibration-title" className="font-display font-bold text-lg text-[var(--text-primary)]">AI Calibration</h3>
                    </div>
                    <button onClick={onClose} aria-label="Close AI calibration" className="text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors">
                        <XCircle className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-5">
                    {SLIDERS.map(slider => (
                        <div key={slider.key}>
                            <label className="block text-xs font-mono text-[var(--text-secondary)] mb-2 flex justify-between" htmlFor={`ai-${slider.key}`}>
                                <span>{slider.label}</span>
                                <span className="text-[var(--accent)]">{config[slider.key].toFixed(2)}</span>
                            </label>
                            <input
                                id={`ai-${slider.key}`}
                                type="range" min={slider.min} max={slider.max} step={slider.step} value={config[slider.key]}
                                onChange={e => { const value = parseFloat(e.target.value); onChange(c => ({ ...c, [slider.key]: value })) }}
                                className="w-full accent-[var(--accent)]"
                            />
                            <p className="text-[10px] text-[var(--text-dim)] mt-1">{slider.help}</p>
                        </div>
                    ))}
                </div>
                <div className="p-4 border-t border-[var(--border)] flex justify-end">
                    <button onClick={onApply} className="px-5 py-2 rounded-lg bg-[var(--accent)] text-black font-bold text-sm hover:brightness-110 transition-all">
                        {applyLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}

export function CalibratingOverlay({ message }: { message?: string | null }) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-md flex-col text-[var(--text-primary)] font-mono">
            <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-6"></div>
            <h2 className="text-2xl font-bold text-[var(--accent)] tracking-widest mb-2">
                {message?.toUpperCase() || "LOADING AI MODELS... (50MB)"}
            </h2>
            <p className="text-[var(--text-secondary)] text-sm mb-1">Please wait while the AI initializes.</p>
            <p className="text-[var(--text-dim)] text-xs">This may take a moment on slower connections.</p>
        </div>
    )
}

export function ConfirmDialog({ dialogRef, titleId, title, body, confirmLabel, danger = false, onCancel, onConfirm }: {
    dialogRef: Ref<HTMLDivElement>
    titleId: string
    title: string
    body: string
    confirmLabel: string
    danger?: boolean
    onCancel: () => void
    onConfirm: () => void
}) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 text-center">
                <h3 id={titleId} className={cn("text-xl font-bold mb-2", danger ? "text-[var(--red)]" : "text-[var(--text-primary)]")}>{title}</h3>
                <p className="text-sm text-[var(--text-secondary)] mb-6">{body}</p>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-[var(--border)] hover:bg-[var(--elevated)]">Cancel</button>
                    <button onClick={onConfirm} className="flex-1 py-2.5 rounded-lg bg-[var(--red)] text-[var(--text-primary)] font-bold hover:brightness-110">{confirmLabel}</button>
                </div>
            </div>
        </div>
    )
}

export type ShareSource = { id: string; name: string; thumbnail?: string | null; isScreen?: boolean }

export function SharePickerDialog({ dialogRef, sources, onPick, onClose }: {
    dialogRef: Ref<HTMLDivElement>
    sources: ShareSource[]
    onPick: (source: ShareSource) => void
    onClose: () => void
}) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="share-picker-title" className="w-full max-w-4xl bg-[var(--surface)] border border-[var(--border)] rounded-xl flex flex-col h-[80vh] overflow-hidden shadow-2xl">
                <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--background)]">
                    <h2 id="share-picker-title" className="text-xl font-bold font-display text-[var(--text-primary)]">Select screen or window to share</h2>
                    <button onClick={onClose} aria-label="Close share picker" className="text-[var(--text-dim)] hover:text-[var(--text-primary)]">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-[var(--bg)]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                        {sources.map((source) => (
                            <button
                                key={source.id}
                                type="button"
                                onClick={() => onPick(source)}
                                className="flex flex-col text-left group cursor-pointer bg-[var(--surface)] rounded-lg overflow-hidden border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-[0_0_15px_rgba(0,212,255,0.3)] transition-all duration-200"
                            >
                                <div className="aspect-video w-full bg-[var(--bg)] flex items-center justify-center overflow-hidden p-2 relative">
                                    {source.thumbnail ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={source.thumbnail} alt={source.name} className="max-w-full max-h-full object-contain rounded drop-shadow-md" />
                                    ) : (
                                        <div className="text-[var(--text-dim)] flex flex-col items-center">
                                            <Monitor className="w-8 h-8 mb-2 opacity-50" />
                                            <span className="text-xs">No preview</span>
                                        </div>
                                    )}
                                    {source.isScreen && (
                                        <div className="absolute top-2 right-2 bg-[var(--accent)] text-black text-[10px] font-bold px-2 py-0.5 rounded uppercase">Entire Screen</div>
                                    )}
                                </div>
                                <div className="w-full p-3 border-t border-[var(--border)] bg-[var(--background)] group-hover:bg-[var(--elevated)]">
                                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate" title={source.name}>{source.name}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
