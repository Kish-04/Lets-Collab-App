import type { Metadata, Viewport } from "next"
import { Analytics } from "@vercel/analytics/next"
import ThemeCustomizer from "@/components/ircp/ThemeCustomizer"
import "./globals.css"

export const metadata: Metadata = {
  title: "Let's Collab! | Secure Remote Collaboration",
  description: "Permission-first remote collaboration with optional supervised monitoring and clear audit history.",
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
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            if (typeof window === 'undefined') return;

            // Centralized AI/Wasm error suppression for Next.js Turbopack
            var originalError = console.error;
            console.error = function() {
              var msg = String(arguments[0] || '').toLowerCase();
              var isWasmError = [
                'index out of bounds', 'abort', 'wasm', 'memory',
                'delegate', 'task failed', 'xnnpack'
              ].some(function(term) { return msg.indexOf(term) !== -1; });

              if (isWasmError) {
                // Redirect to warn to prevent the Next.js "Red Screen of Death" overlay
                // but still keep it in the developer console for debugging.
                console.warn('[AI-Subsystem-Suppressed]', ...arguments);
                return;
              }
              originalError.apply(console, arguments);
            };

            // Catch and suppress unhandled Wasm exceptions
            window.addEventListener('error', function(e) {
              var msg = String(e.message || e.error || '').toLowerCase();
              if (msg.indexOf('index out of bounds') !== -1 || msg.indexOf('wasm') !== -1) {
                e.preventDefault();
                e.stopImmediatePropagation();
              }
            }, true);

            window.addEventListener('unhandledrejection', function(e) {
              var msg = String(e.reason || '').toLowerCase();
              if (msg.indexOf('index out of bounds') !== -1 || msg.indexOf('wasm') !== -1) {
                e.preventDefault();
                e.stopImmediatePropagation();
              }
            }, true);
          })();
        ` }} />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased bg-[var(--bg)] text-[var(--text-primary)] transition-colors duration-200">
        {children}
        <ThemeCustomizer />
        <Analytics />
      </body>
    </html>
  )
}
