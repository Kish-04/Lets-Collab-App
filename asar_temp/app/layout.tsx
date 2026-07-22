import type { Metadata, Viewport } from "next"
import { Exo_2, JetBrains_Mono, DM_Sans } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import ThemeCustomizer from "@/components/ircp/ThemeCustomizer"
import "./globals.css"

const exo2 = Exo_2({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "600", "800", "900"],
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "700"],
})

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500"],
})

export const metadata: Metadata = {
  title: "Let's Collab! | Secure Remote Collaboration",
  description: "Permission-first remote collaboration with optional supervised monitoring and clear audit history.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-icon.png",
  },
}

export const viewport: Viewport = {
  themeColor: "#0b1120",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var saved = localStorage.getItem('lets_collab_appearance');
              if (!saved) return;
              var c = JSON.parse(saved);
              var root = document.documentElement;
              var vars = {
                '--bg': c.background, '--surface': c.surface, '--elevated': c.elevated,
                '--border': c.border, '--text-primary': c.textPrimary,
                '--text-secondary': c.textSecondary, '--text-dim': c.textSecondary,
                '--accent': c.accent, '--emerald': c.success, '--amber': c.warning,
                '--red': c.danger, '--app-radius': c.radius + 'px'
              };
              Object.keys(vars).forEach(function(key) { if (vars[key]) root.style.setProperty(key, vars[key]); });
              root.dataset.appearance = c.preset || 'professional';
              root.dataset.density = c.density || 'comfortable';
              root.dataset.reducedMotion = String(!!c.reducedMotion);
            } catch (e) {}
          })();
        ` }} />
      </head>
      <body suppressHydrationWarning className={`${exo2.variable} ${jetbrainsMono.variable} ${dmSans.variable} font-sans antialiased bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-200`}>
        {children}
        <ThemeCustomizer />
        <Analytics />
      </body>
    </html>
  )
}







