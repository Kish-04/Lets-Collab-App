"use client"

import { useEffect, useState } from "react"
import { Check, ChevronDown, Paintbrush, RefreshCcw, SlidersHorizontal, X } from "lucide-react"
import {
  APPEARANCE_CHANGE_EVENT,
  APPEARANCE_LOCK_EVENT,
  APPEARANCE_PRESETS,
  AppearanceConfig,
  AppearancePreset,
  announceAppearance,
  applyAppearance,
  normalizeAppearance,
  readPersonalAppearance,
  storePersonalAppearance,
} from "@/lib/appearance"
import { cn } from "@/lib/utils"

const presets: Array<{ id: AppearancePreset; label: string; description: string }> = [
  { id: "professional", label: "Professional", description: "Clean remote workspace" },
  { id: "dark", label: "Dark", description: "Quiet and focused" },
  { id: "light", label: "Light", description: "Bright and accessible" },
  { id: "glass", label: "Glass", description: "Premium soft depth" },
  { id: "neon", label: "Neon", description: "Futuristic contrast" },
]

const editableColors: Array<{ key: keyof AppearanceConfig; label: string }> = [
  { key: "background", label: "Background" },
  { key: "surface", label: "Panels" },
  { key: "elevated", label: "Elevated" },
  { key: "border", label: "Borders" },
  { key: "textPrimary", label: "Text" },
  { key: "textSecondary", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "success", label: "Success" },
  { key: "warning", label: "Warning" },
  { key: "danger", label: "Danger" },
]
import { usePathname } from "next/navigation"

export default function ThemeCustomizer() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<AppearanceConfig>(APPEARANCE_PRESETS.professional)
  const [advanced, setAdvanced] = useState(false)
  const [locked, setLocked] = useState(false)
  const [lockMessage, setLockMessage] = useState("")

  useEffect(() => {
    const initial = readPersonalAppearance()
    setConfig(initial)
    applyAppearance(initial)
  }, [])

  useEffect(() => {
    const onLock = (event: Event) => {
      const detail = (event as CustomEvent<{ locked: boolean; message?: string }>).detail
      setLocked(Boolean(detail?.locked))
      setLockMessage(detail?.message || "")
      if (!detail?.locked) {
        const personal = readPersonalAppearance()
        setConfig(personal)
        applyAppearance(personal)
      }
    }
    const onRemoteAppearance = (event: Event) => {
      const detail = (event as CustomEvent<AppearanceConfig>).detail
      if (detail) {
        setConfig(normalizeAppearance(detail))
        applyAppearance(normalizeAppearance(detail))
      }
    }
    window.addEventListener(APPEARANCE_LOCK_EVENT, onLock)
    window.addEventListener("lets-collab:appearance-remote", onRemoteAppearance)
    return () => {
      window.removeEventListener(APPEARANCE_LOCK_EVENT, onLock)
      window.removeEventListener("lets-collab:appearance-remote", onRemoteAppearance)
    }
  }, [])

  const commit = (next: AppearanceConfig) => {
    if (locked) return
    const normalized = normalizeAppearance(next)
    setConfig(normalized)
    applyAppearance(normalized)
    storePersonalAppearance(normalized)
    announceAppearance(normalized)
  }

  const selectPreset = (preset: AppearancePreset) => commit({ ...APPEARANCE_PRESETS[preset] })

  if (pathname?.startsWith('/pet')) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[90] font-sans">
      {open && (
        <section className="absolute bottom-16 right-0 w-[390px] max-h-[min(78vh,700px)] overflow-y-auto rounded-[var(--app-radius)] border border-[var(--border)] bg-[rgba(var(--surface-rgb),var(--surface-alpha))] shadow-2xl backdrop-blur-xl">
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[rgba(var(--surface-rgb),0.96)] p-5 backdrop-blur-xl">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Appearance Studio</p>
              <h2 className="mt-1 text-base font-semibold text-[var(--text-primary)]">Customize Let&apos;s Collab!</h2>
            </div>
            <button aria-label="Close appearance studio" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="space-y-5 p-5">
            {locked && (
              <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-3 text-xs text-[var(--text-secondary)]">
                <strong className="block text-[var(--accent)]">Session appearance is shared</strong>
                {lockMessage || "The host controls the visual style for this active room."}
              </div>
            )}

            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--text-primary)]">Presets</p>
                <button
                  onClick={() => selectPreset("professional")}
                  disabled={locked}
                  className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  <RefreshCcw className="h-3 w-3" /> Reset
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    disabled={locked}
                    onClick={() => selectPreset(preset.id)}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed",
                      config.preset === preset.id
                        ? "border-[var(--accent)] bg-[var(--accent)]/10"
                        : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-bright)]",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{preset.label}</span>
                      {config.preset === preset.id && <Check className="h-3.5 w-3.5 text-[var(--accent)]" />}
                    </div>
                    <div className="mb-2 flex gap-1">
                      {["background", "surface", "accent"].map((key) => (
                        <span key={key} className="h-3 w-3 rounded-full border border-white/10" style={{ background: APPEARANCE_PRESETS[preset.id][key as "background" | "surface" | "accent"] }} />
                      ))}
                    </div>
                    <p className="text-[10px] text-[var(--text-secondary)]">{preset.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setAdvanced((value) => !value)}
              className="flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text-primary)]"
            >
              <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-[var(--accent)]" /> Detailed controls</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", advanced && "rotate-180")} />
            </button>

            {advanced && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                  {editableColors.map(({ key, label }) => (
                    <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2">
                      <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
                      <input
                        aria-label={label}
                        type="color"
                        disabled={locked}
                        value={String(config[key])}
                        onChange={(event) => commit({ ...config, [key]: event.target.value })}
                        className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed"
                      />
                    </label>
                  ))}
                </div>

                {[
                  { label: "Corner radius", key: "radius" as const, min: 6, max: 24, suffix: "px" },
                  { label: "Accent glow", key: "glow" as const, min: 0, max: 40, suffix: "%" },
                  { label: "Panel transparency", key: "transparency" as const, min: 0, max: 55, suffix: "%" },
                ].map((slider) => (
                  <label key={slider.key} className="block">
                    <div className="mb-2 flex justify-between text-xs text-[var(--text-secondary)]">
                      <span>{slider.label}</span>
                      <span>{config[slider.key]}{slider.suffix}</span>
                    </div>
                    <input
                      type="range"
                      disabled={locked}
                      min={slider.min}
                      max={slider.max}
                      value={config[slider.key]}
                      onChange={(event) => commit({ ...config, [slider.key]: Number(event.target.value) })}
                      className="w-full accent-[var(--accent)]"
                    />
                  </label>
                ))}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={locked}
                    onClick={() => commit({ ...config, density: config.density === "compact" ? "comfortable" : "compact" })}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-left text-xs text-[var(--text-secondary)] disabled:opacity-50"
                  >
                    Density: <strong className="text-[var(--text-primary)]">{config.density}</strong>
                  </button>
                  <button
                    disabled={locked}
                    onClick={() => commit({ ...config, reducedMotion: !config.reducedMotion })}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-left text-xs text-[var(--text-secondary)] disabled:opacity-50"
                  >
                    Motion: <strong className="text-[var(--text-primary)]">{config.reducedMotion ? "Reduced" : "Normal"}</strong>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      <button
        id="theme-customizer-trigger"
        aria-label="Open appearance studio"
        onClick={() => setOpen((value) => !value)}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)] shadow-xl transition-transform hover:scale-105 hover:border-[var(--accent)]"
      >
        {open ? <X className="h-5 w-5" /> : <Paintbrush className="h-5 w-5" />}
      </button>
    </div>
  )
}
