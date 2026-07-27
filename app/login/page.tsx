"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/app")
  }, [router])

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center text-[var(--text-dim)] font-mono">
      Redirecting to sign in...
    </div>
  )
}
