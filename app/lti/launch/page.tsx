"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

// Landing page after an LTI 1.3 launch from Moodle, Canvas or another course platform. The server
// verified the launch and put a sign-in token in the URL fragment (never sent to any server): store
// it like a normal sign-in, then go to the exam room for this course activity.
export default function LtiLaunchPage() {
  const router = useRouter()
  const [message, setMessage] = useState("Signing you in from your course…")

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const token = params.get("token")
    const link = params.get("link")
    // Drop the token from the address bar and history straight away
    window.history.replaceState(null, "", window.location.pathname)
    if (!token || !link) {
      setMessage("This link is incomplete. Open the activity from your course again.")
      return
    }
    const name = params.get("name") || "Student"
    try {
      localStorage.setItem("ircp_user", JSON.stringify({ token, name, email: params.get("email") || "", role: "user" }))
      localStorage.setItem("ircp_name", name)
    } catch {
      setMessage("Your browser blocked storage for this site, so you cannot be signed in. Allow site data and try again.")
      return
    }
    const title = params.get("title") || ""
    if (params.get("role") === "instructor") {
      router.replace(`/session?create=true&mode=supervised&lti=${encodeURIComponent(link)}`)
    } else {
      router.replace(`/lti/waiting?link=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}`)
    }
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-center text-[var(--text-primary)]">
      <p role="status" className="text-sm text-[var(--text-secondary)]">{message}</p>
    </main>
  )
}
