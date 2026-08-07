"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { User, Lock, Mail, ArrowLeft, Check, ShieldAlert } from "lucide-react"
import { getBackendUrl } from "@/lib/utils"

export default function ProfilePage() {
  const router = useRouter()
  
  const [formData, setFormData] = useState({
    name: "",
    email: "", // read-only
    newPassword: "",
    confirmPassword: ""
  })
  
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  useEffect(() => {
    const userStr = localStorage.getItem('ircp_user')
    if (!userStr) {
      router.push('/app')
      return
    }
    
    try {
      const user = JSON.parse(userStr)
      setFormData(prev => ({
        ...prev,
        name: user.name || "",
        email: user.email || ""
      }))
    } catch (e) {
      router.push('/app')
    }
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")
    setSuccessMsg("")
    
    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      setErrorMsg("New passwords do not match.")
      return
    }

    if (formData.newPassword && formData.newPassword.length < 8) {
      setErrorMsg("Password must be at least 8 characters long.")
      return
    }

    setLoading(true)
    
    try {
      const tokenStr = localStorage.getItem('ircp_user')
      const token = tokenStr ? JSON.parse(tokenStr).token : ""
      
      const payload = {
        name: formData.name,
        newPassword: formData.newPassword || undefined
      }

      const res = await fetch(`${getBackendUrl()}/api/profile`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      })
      
      const data = await res.json()
      
      if (res.ok) {
        setSuccessMsg("Profile updated successfully.")
        setFormData(prev => ({ ...prev, newPassword: "", confirmPassword: "" }))
        
        // Update local storage
        if (tokenStr) {
          const userObj = JSON.parse(tokenStr)
          userObj.name = formData.name
          localStorage.setItem('ircp_user', JSON.stringify(userObj))
          localStorage.setItem('ircp_name', formData.name)
        }
      } else {
        setErrorMsg(data.message || "Failed to update profile.")
      }
    } catch (err: any) {
      setErrorMsg("Network error. Ensure the server is running.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] selection:bg-[var(--accent)] selection:text-black flex flex-col items-center justify-center relative overflow-hidden p-6">
      
      {/* Background Effects */}
      <div className="fixed inset-0 z-0 bg-[url('/grid.svg')] bg-center opacity-[0.05] pointer-events-none" />
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none flex items-center justify-center">
        <div className="w-[50vw] h-[50vw] bg-[var(--accent)]/5 rounded-full blur-[150px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <button 
          onClick={() => router.push('/app')}
          className="mb-8 flex items-center gap-2 text-sm font-bold text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          BACK TO DASHBOARD
        </button>

        <div className="bg-[rgba(var(--surface-rgb),var(--surface-alpha))] border border-[var(--border)] rounded-[var(--app-radius)] p-10 shadow-[0_0_50px_var(--accent-glow)] backdrop-blur-3xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[var(--accent)] to-[var(--violet)]" />
          
          <div className="mb-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4">
              <User className="w-8 h-8 text-[var(--accent)]" />
            </div>
            <h1 className="text-3xl font-black text-[var(--text-primary)]">Profile Settings</h1>
          </div>

          <div className="bg-[var(--amber)]/10 border border-[var(--amber)]/30 rounded-lg p-4 mb-6 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-[var(--amber)] shrink-0 mt-0.5" />
            <p className="text-xs font-medium text-[var(--amber)] leading-relaxed">
              For security and auditing purposes, any changes made to your profile are automatically logged and reported to the system administrators.
            </p>
          </div>

          {errorMsg && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--red)]/10 border border-[var(--red)]/30 text-[var(--red)] text-sm font-bold p-4 rounded-lg mb-6 text-center">
              {errorMsg}
            </motion.div>
          )}

          {successMsg && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--emerald)]/10 border border-[var(--emerald)]/30 text-[var(--emerald)] text-sm font-bold p-4 rounded-lg mb-6 text-center flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              {successMsg}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest uppercase text-[var(--text-dim)]">Email Address (Read Only)</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)]" />
                <input
                  type="email"
                  value={formData.email}
                  readOnly
                  className="w-full bg-[rgba(var(--surface-rgb),0.2)] border border-[var(--border)] text-[var(--text-dim)] font-medium rounded-xl pl-12 pr-4 py-4 outline-none cursor-not-allowed"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold tracking-widest uppercase text-[var(--text-dim)]">Full Name</label>
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors" />
                <input
                  required
                  type="text"
                  placeholder="Your Name"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-[rgba(var(--surface-rgb),0.5)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl pl-12 pr-4 py-4 focus:border-[var(--accent)] outline-none transition-all focus:bg-[rgba(var(--surface-rgb),0.8)]"
                />
              </div>
            </div>

            <div className="pt-6 border-t border-[var(--border)] space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold tracking-widest uppercase text-[var(--text-dim)] block">Change Password (Optional)</label>
                
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors" />
                  <input
                    type="password"
                    placeholder="New Password"
                    value={formData.newPassword}
                    onChange={e => setFormData({ ...formData, newPassword: e.target.value })}
                    className="w-full bg-[rgba(var(--surface-rgb),0.5)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl pl-12 pr-4 py-4 focus:border-[var(--accent)] outline-none transition-all focus:bg-[rgba(var(--surface-rgb),0.8)]"
                  />
                </div>
              </div>

              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors" />
                <input
                  type="password"
                  placeholder="Confirm New Password"
                  value={formData.confirmPassword}
                  onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="w-full bg-[rgba(var(--surface-rgb),0.5)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl pl-12 pr-4 py-4 focus:border-[var(--accent)] outline-none transition-all focus:bg-[rgba(var(--surface-rgb),0.8)]"
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full mt-6 py-4 bg-[var(--text-primary)] text-[var(--bg)] font-black text-lg rounded-xl hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_var(--accent-glow)]"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> Saving Changes
                </span>
              ) : 'Save Profile'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}
