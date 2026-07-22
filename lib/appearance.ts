export type AppearancePreset = "professional" | "dark" | "light" | "glass" | "neon"
export type SessionMode = "collaboration" | "supervised"

export type AppearanceConfig = {
  preset: AppearancePreset
  background: string
  surface: string
  elevated: string
  border: string
  textPrimary: string
  textSecondary: string
  accent: string
  success: string
  warning: string
  danger: string
  radius: number
  density: "comfortable" | "compact"
  glow: number
  transparency: number
  reducedMotion: boolean
}

export const APPEARANCE_STORAGE_KEY = "lets_collab_appearance"
export const APPEARANCE_CHANGE_EVENT = "lets-collab:appearance-change"
export const APPEARANCE_LOCK_EVENT = "lets-collab:appearance-lock"

export const APPEARANCE_PRESETS: Record<AppearancePreset, AppearanceConfig> = {
  professional: {
    preset: "professional",
    background: "#0b1120",
    surface: "#121b2d",
    elevated: "#1b2740",
    border: "#293853",
    textPrimary: "#edf2fa",
    textSecondary: "#9aa9c0",
    accent: "#2f7df6",
    success: "#19b37a",
    warning: "#f59e0b",
    danger: "#ef466f",
    radius: 12,
    density: "comfortable",
    glow: 10,
    transparency: 0,
    reducedMotion: false,
  },
  dark: {
    preset: "dark",
    background: "#080b12",
    surface: "#101520",
    elevated: "#171e2b",
    border: "#252d3e",
    textPrimary: "#f3f5f9",
    textSecondary: "#98a2b3",
    accent: "#43a5ff",
    success: "#20c997",
    warning: "#f7b955",
    danger: "#fa5d73",
    radius: 10,
    density: "comfortable",
    glow: 7,
    transparency: 0,
    reducedMotion: false,
  },
  light: {
    preset: "light",
    background: "#f2f5fa",
    surface: "#ffffff",
    elevated: "#e8eef7",
    border: "#d4deec",
    textPrimary: "#152238",
    textSecondary: "#53657d",
    accent: "#1769e8",
    success: "#098658",
    warning: "#bb6f00",
    danger: "#d72b51",
    radius: 12,
    density: "comfortable",
    glow: 4,
    transparency: 0,
    reducedMotion: false,
  },
  glass: {
    preset: "glass",
    background: "#070b17",
    surface: "#172235",
    elevated: "#26344a",
    border: "#354761",
    textPrimary: "#f5f7fc",
    textSecondary: "#acb7c9",
    accent: "#5b8cff",
    success: "#36d399",
    warning: "#f7c65f",
    danger: "#fa6a84",
    radius: 18,
    density: "comfortable",
    glow: 18,
    transparency: 34,
    reducedMotion: false,
  },
  neon: {
    preset: "neon",
    background: "#070711",
    surface: "#101222",
    elevated: "#171a31",
    border: "#262c4b",
    textPrimary: "#eef5ff",
    textSecondary: "#94a5c7",
    accent: "#00d4ff",
    success: "#00d695",
    warning: "#ffc247",
    danger: "#ff456a",
    radius: 10,
    density: "compact",
    glow: 26,
    transparency: 0,
    reducedMotion: false,
  },
}

const colorKeys: Array<keyof AppearanceConfig> = [
  "background",
  "surface",
  "elevated",
  "border",
  "textPrimary",
  "textSecondary",
  "accent",
  "success",
  "warning",
  "danger",
]

function validHex(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return { r: 47, g: 125, b: 246 }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  }
}

export function normalizeAppearance(value: Partial<AppearanceConfig> | null | undefined): AppearanceConfig {
  const preset = value?.preset && value.preset in APPEARANCE_PRESETS ? value.preset : "professional"
  const fallback = APPEARANCE_PRESETS[preset]
  const normalized = { ...fallback, ...value, preset }

  for (const key of colorKeys) {
    normalized[key] = validHex(value?.[key], fallback[key] as string) as never
  }

  normalized.radius = Math.min(24, Math.max(6, Number(value?.radius ?? fallback.radius)))
  normalized.glow = Math.min(40, Math.max(0, Number(value?.glow ?? fallback.glow)))
  normalized.transparency = Math.min(55, Math.max(0, Number(value?.transparency ?? fallback.transparency)))
  normalized.density = value?.density === "compact" ? "compact" : "comfortable"
  normalized.reducedMotion = Boolean(value?.reducedMotion)
  return normalized
}

export function readPersonalAppearance(): AppearanceConfig {
  if (typeof window === "undefined") return APPEARANCE_PRESETS.professional
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    return normalizeAppearance(stored ? JSON.parse(stored) : undefined)
  } catch {
    return APPEARANCE_PRESETS.professional
  }
}

export function storePersonalAppearance(config: AppearanceConfig) {
  if (typeof window === "undefined") return
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearance(config)))
}

export function applyAppearance(config: AppearanceConfig) {
  if (typeof document === "undefined") return
  const appearance = normalizeAppearance(config)
  const root = document.documentElement
  const accent = hexToRgb(appearance.accent)
  const surface = hexToRgb(appearance.surface)

  root.dataset.appearance = appearance.preset
  root.dataset.density = appearance.density
  root.dataset.reducedMotion = String(appearance.reducedMotion)
  root.style.setProperty("--bg", appearance.background)
  root.style.setProperty("--surface", appearance.surface)
  root.style.setProperty("--elevated", appearance.elevated)
  root.style.setProperty("--border", appearance.border)
  root.style.setProperty("--border-bright", appearance.textSecondary)
  root.style.setProperty("--text-primary", appearance.textPrimary)
  root.style.setProperty("--text-secondary", appearance.textSecondary)
  root.style.setProperty("--text-dim", appearance.textSecondary)
  root.style.setProperty("--accent", appearance.accent)
  root.style.setProperty("--accent-glow", `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${appearance.glow / 100})`)
  root.style.setProperty("--emerald", appearance.success)
  root.style.setProperty("--amber", appearance.warning)
  root.style.setProperty("--red", appearance.danger)
  root.style.setProperty("--app-radius", `${appearance.radius}px`)
  root.style.setProperty("--surface-alpha", `${Math.max(0.45, 1 - appearance.transparency / 100)}`)
  root.style.setProperty("--surface-rgb", `${surface.r}, ${surface.g}, ${surface.b}`)
  root.style.setProperty("--app-density", appearance.density === "compact" ? "0.88" : "1")
}

export function announceAppearance(config: AppearanceConfig) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: normalizeAppearance(config) }))
}

