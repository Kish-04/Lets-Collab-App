"use client"

import React, { useEffect, useRef, useState } from 'react'
import { motion, useScroll, useTransform, AnimatePresence, useSpring, useVelocity, useAnimationFrame, useMotionValueEvent } from 'framer-motion'
import { Download, MonitorPlay, ShieldCheck, ChevronRight, Zap, Globe, Layers, Command, Lock, Cpu, Network, Sparkles, ServerOff, Infinity as InfinityIcon, ArrowRight, Play, Maximize2, MousePointer2, User, Gamepad2, Copy, PenTool, Video, Check } from 'lucide-react'
import { AppLogo } from '@/components/ircp/shared'
import { MagneticButton, TiltCard, VelocityMarquee, TextReveal } from '@/components/landing/Animations'
import { FeatureOrbit } from '@/components/landing/FeatureOrbit'
import { HeroCanvas } from '@/components/landing/HeroCanvas'
import { ShowcaseShaderMask } from '@/components/landing/ShowcaseShaderMask'
import Link from 'next/link'

const desktopDownloadUrl = "https://github.com/Kish-04/Let-s-Collab-/releases/latest"

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: containerRef })
  
  // Smooth scroll springs
  const smoothProgress = useSpring(scrollYProgress, { damping: 20, stiffness: 100 })
  
  // Portal sequence values
  const yPortal = useTransform(smoothProgress, [0, 0.08], ["0%", "100%"])
  const scalePortal = useTransform(smoothProgress, [0, 0.08], [1, 8])
  const blurPortal = useTransform(smoothProgress, [0, 0.08], ["0px", "20px"])
  const opacityPortal = useTransform(smoothProgress, [0.06, 0.08], [1, 0])
  
  // Spatial Z-Axis Parallax values
  const zHero = useTransform(smoothProgress, [0.08, 0.28], [1, 3])
  const opacityHero = useTransform(smoothProgress, [0.08, 0.23], [1, 0])
  
  const { scrollYProgress: pageScrollProgress } = useScroll()
  const [scrollPercent, setScrollPercent] = useState(0)
  
  // MUST be at top-level to avoid React Hooks error
  const circleOffset = useTransform(pageScrollProgress, [0, 1], [2 * Math.PI * 46, 0])
  
  useMotionValueEvent(pageScrollProgress, "change", (latest) => {
    setScrollPercent(Math.round(latest * 100))
  })
  
  // Horizontal scroll for showcase
  const showcaseRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: showcaseProgress } = useScroll({ target: showcaseRef, offset: ["start end", "end start"] })
  const xShowcase = useTransform(showcaseProgress, [0, 1], ["20%", "-60%"])

  // Custom physical cursor
  const cursorX = useSpring(0, { stiffness: 500, damping: 28 })
  const cursorY = useSpring(0, { stiffness: 500, damping: 28 })
  const [isHovering, setIsHovering] = useState(false)
  
  // Profile Image State
  const [imageError, setImageError] = useState(false)
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      cursorX.set(e.clientX)
      cursorY.set(e.clientY)
    }
    window.addEventListener("mousemove", handleMouseMove)
    return () => window.removeEventListener("mousemove", handleMouseMove)
  }, [])
  return (
    <div ref={containerRef} className="relative min-h-screen bg-[var(--bg)] text-[var(--text-primary)] selection:bg-[var(--accent)] selection:text-black overflow-clip font-sans cursor-default">
      
      {/* Custom Trailing Cursor */}
      <motion.div 
        className="fixed top-0 left-0 w-8 h-8 rounded-full border border-[var(--accent)] pointer-events-none z-[100] mix-blend-screen flex items-center justify-center"
        style={{ x: cursorX, y: cursorY, translateX: "-50%", translateY: "-50%" }}
        animate={{ scale: isHovering ? 2 : 1, backgroundColor: isHovering ? "rgba(0,212,255,0.1)" : "transparent" }}
        transition={{ duration: 0.2 }}
      >
        <div className="w-1 h-1 bg-white rounded-full" />
      </motion.div>

      {/* Grid Pattern Background */}
      <div 
        className="fixed inset-0 z-0 bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-[0.05] pointer-events-none" 
        style={{ backgroundImage: "url('/grid.svg')" }}
      />

      {/* Dynamic Ambient Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 150, repeat: Infinity, ease: "linear" }}
          className="absolute top-[-20%] left-[-10%] w-[70vw] h-[70vw] opacity-30 mix-blend-screen"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)] to-transparent rounded-full blur-[100px] animate-pulse-glow" />
          <div className="absolute inset-[20%] bg-gradient-to-l from-purple-600 to-transparent rounded-full blur-[120px] animate-live-pulse" />
        </motion.div>
      </div>

      {/* Creative Scroll To Top Button */}
      <AnimatePresence>
        {scrollPercent > 5 && (
          <motion.button
            initial={{ opacity: 0, scale: 0.5, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 20 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-6 right-6 md:bottom-10 md:right-10 z-[100] w-16 h-16 rounded-full bg-zinc-950/80 border border-[var(--border)]/60 backdrop-blur-xl flex items-center justify-center text-[var(--text-primary)] overflow-hidden group shadow-[0_0_30px_rgba(0,0,0,0.8)] hover:border-[var(--accent)] transition-all hover:scale-110 active:scale-95"
          >
            {/* SVG Progress Circle */}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="4"
              />
              <motion.circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="4"
                strokeDasharray={`${2 * Math.PI * 46}`}
                strokeDashoffset={circleOffset}
                strokeLinecap="round"
                className="opacity-50 group-hover:opacity-100 transition-opacity drop-shadow-[0_0_5px_var(--accent)]"
              />
            </svg>
            
            <div className="relative z-10 flex flex-col items-center">
              <span className="text-xs font-black text-zinc-300 group-hover:text-[var(--text-primary)] transition-colors">
                {scrollPercent}<span className="text-[10px] text-[var(--accent)]">%</span>
              </span>
              <span className="text-[8px] uppercase tracking-widest text-zinc-500 group-hover:text-[var(--accent)] transition-colors mt-0.5">Top</span>
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Top Banner Tagline */}
      <div className="w-full relative z-[60] bg-[var(--accent)] text-black text-xs sm:text-sm font-bold text-center py-3 px-4 shadow-[0_0_20px_var(--accent)] leading-snug">
        Decentralized Remote Collaborative System with Federated AI
      </div>

      {/* Navigation Header */}
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-50 flex items-center justify-between px-4 sm:px-8 py-4 backdrop-blur-xl border-b border-[var(--border)] bg-black/80"
      >
        <MagneticButton>
          <AppLogo size="small" />
        </MagneticButton>
        <div className="flex items-center gap-8">
          <nav className="hidden md:flex items-center gap-8">
            {['Vision', 'Engine', 'Compare', 'Creator', 'Download'].map((item) => (
              <a 
                key={item}
                href={`#${item.toLowerCase()}`} 
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(item.toLowerCase())?.scrollIntoView({ behavior: 'smooth' });
                }}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                className="text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 hover:text-[var(--text-primary)] transition-all relative group"
              >
                {item}
                <span className="absolute -bottom-2 left-0 w-full h-[2px] bg-[var(--accent)] scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300" />
              </a>
            ))}
          </nav>
          <MagneticButton>
            <Link 
              href="/app" 
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
              className="group relative inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-black text-black bg-white rounded-full overflow-hidden transition-transform hover:scale-105 active:scale-95"
            >
              <span className="relative z-10">Open Web App</span>
              <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)] to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <span className="relative z-10 group-hover:text-[var(--text-primary)] transition-colors duration-300">
                <MonitorPlay className="w-4 h-4" />
              </span>
            </Link>
          </MagneticButton>
        </div>
      </motion.header>

      <main className="relative z-10">
        
        {/* Header */}
        {/* Background Velocity Marquee */}
        <div className="absolute top-[30vh] left-0 right-0 pointer-events-none z-0">
          <VelocityMarquee baseVelocity={-2}>NO LIMITS NO SERVERS NO LATENCY</VelocityMarquee>
        </div>

        {/* Hero Section */}
        <section id="vision" className="relative min-h-[120vh] flex flex-col items-center justify-center pt-32 pb-20 md:pb-64 px-4 overflow-hidden">
          
          <HeroCanvas />

          {/* Portal Dive Intro */}
          <motion.div 
            style={{ 
              y: yPortal, 
              scale: scalePortal, 
              opacity: opacityPortal,
              filter: useTransform(blurPortal, blur => `blur(${blur})`)
            }}
            className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
          >
            <div className="flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-[var(--accent)] animate-ping absolute" />
              <div className="w-4 h-4 rounded-full bg-[var(--accent)]" />
            </div>
          </motion.div>

          <motion.div 
            style={{ opacity: opacityHero, scale: zHero }}
            className="flex flex-col items-center text-center max-w-7xl mx-auto relative z-10 pointer-events-auto"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, type: "spring", bounce: 0.5 }}
              className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-[var(--elevated)] border border-[var(--border)]/60 mb-12 backdrop-blur-md shadow-[0_0_50px_rgba(0,212,255,0.15)] overflow-hidden relative group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--accent)]"></span>
              </div>
              <span className="text-xs font-bold tracking-[0.3em] text-[var(--text-primary)] uppercase drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]">Version 0.1.14 Protocol Active</span>
            </motion.div>

            <h1 className="text-6xl sm:text-[12vw] md:text-[10rem] lg:text-[12rem] font-black tracking-tighter leading-tight sm:leading-[0.8] mb-10 pb-4">
              <span className="inline-block bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60 pb-2">
                <TextReveal text="Space to" />
              </span><br/>
              <span className="inline-block bg-clip-text text-transparent bg-gradient-to-r from-[var(--accent)] via-indigo-400 to-purple-500 pb-2">
                <TextReveal text="Create." delay={0.4} />
              </span>
            </h1>

            <motion.p 
              initial={{ opacity: 0, filter: "blur(20px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 1.5, delay: 1 }}
              className="text-lg md:text-2xl text-zinc-400 max-w-3xl mb-16 font-light leading-relaxed"
            >
              Break free from centralized cloud servers. A hyper-fast, cryptographically secure remote desktop protocol built entirely on raw WebRTC data channels.
            </motion.p>

            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 1.2, type: "spring" }}
              className="flex flex-col sm:flex-row items-center gap-8"
            >
              <MagneticButton>
                <a 
                  href="#download" 
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  onMouseEnter={() => setIsHovering(true)}
                  onMouseLeave={() => setIsHovering(false)}
                  className="relative group inline-flex items-center justify-center px-12 py-6 text-xl font-black text-black bg-white rounded-full overflow-hidden transition-all shadow-[0_0_60px_-10px_rgba(255,255,255,0.5)] hover:shadow-[0_0_80px_0_rgba(255,255,255,0.8)]"
                >
                  <span className="relative z-10 flex items-center gap-3">
                    Install Desktop Client <Download className="w-6 h-6 animate-bounce" />
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)] to-purple-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <span className="absolute inset-0 z-10 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 text-[var(--text-primary)] transition-opacity duration-300">
                    Install Desktop Client <Download className="w-6 h-6 animate-bounce" />
                  </span>
                </a>
              </MagneticButton>
            </motion.div>
          </motion.div>
        </section>

        {/* Video/Interface Showcase */}
        <section className="py-10 md:py-20 relative z-20 mt-10 md:-mt-40 perspective-[2000px]">
          <div className="max-w-7xl mx-auto px-4">
            <motion.div 
              initial={{ opacity: 0, rotateX: 45, y: 200, scale: 0.8 }}
              whileInView={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1.5, type: "spring", bounce: 0.4 }}
              className="relative rounded-[3rem] overflow-hidden border border-[var(--border)]/60 bg-zinc-950/80 shadow-[0_50px_100px_-20px_rgba(0,212,255,0.4)] backdrop-blur-3xl group transform-gpu"
            >
              {/* Fake Mac OS Header */}
              <div className="h-14 border-b border-[var(--border)]/60 flex items-center px-8 gap-3 bg-[var(--elevated)] backdrop-blur-lg">
                <div className="flex gap-2">
                  <div className="w-3.5 h-3.5 rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/80 cursor-pointer transition-colors" />
                  <div className="w-3.5 h-3.5 rounded-full bg-[#ffbd2e] hover:bg-[#ffbd2e]/80 cursor-pointer transition-colors" />
                  <div className="w-3.5 h-3.5 rounded-full bg-[#27c93f] hover:bg-[#27c93f]/80 cursor-pointer transition-colors" />
                </div>
                <div className="mx-auto text-sm font-bold text-zinc-400 flex items-center gap-2 px-6 py-1.5 rounded-md bg-[var(--bg)]/70 border border-[var(--border)]">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" /> WebRTC DTLS/SRTP Encrypted
                </div>
              </div>
              
              {/* Abstract App Representation */}
              <div className="aspect-[16/9] relative overflow-hidden flex items-center justify-center bg-[var(--bg)]">
                <ShowcaseShaderMask>
                  {/* Simulated remote screen */}
                  <div className="absolute inset-0 opacity-20 bg-[url('/grid.svg')] bg-center [mask-image:radial-gradient(ellipse_at_center,white,transparent_80%)]" />
                  
                  {/* Dynamic SVG Mesh Lines */}
                  <svg className="absolute inset-0 w-full h-full opacity-40 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {[...Array(5)].map((_, i) => (
                      <motion.path 
                        key={i}
                        d={`M ${-10 + i * 30} 110 Q ${50 + (i % 2 === 0 ? 25 : -25)} ${50 + (i % 3 === 0 ? 20 : -20)} ${110 + i * 10} -10`}
                        stroke="url(#gradient-line)" 
                        strokeWidth="0.2" 
                        fill="none"
                        initial={{ pathLength: 0, opacity: 0 }}
                        whileInView={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 3 + i, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
                      />
                    ))}
                    <defs>
                      <linearGradient id="gradient-line" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="var(--accent)" />
                        <stop offset="100%" stopColor="#8b5cf6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  
                  <div className="relative z-10 text-center h-full flex items-center justify-center">
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                      className="w-40 h-40 rounded-full border-2 border-dashed border-[var(--border-bright)] mx-auto flex items-center justify-center relative"
                    >
                      <motion.div 
                        animate={{ rotate: -360 }}
                        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                        className="w-32 h-32 rounded-[2rem] bg-gradient-to-br from-[var(--accent)] to-indigo-600 flex items-center justify-center shadow-2xl shadow-[var(--accent)]/50"
                      >
                        <InfinityIcon className="w-16 h-16 text-[var(--text-primary)]" />
                      </motion.div>
                    </motion.div>
                  </div>
                  
                  {/* Floating interactive cursors */}
                  {[
                    { delay: 0, color: "text-[var(--accent)]", name: "Alice (macOS)", x1: 80, x2: -110, y1: 45, y2: -65 },
                    { delay: 2, color: "text-purple-400", name: "Bob (Windows)", x1: -95, x2: 125, y1: -55, y2: 75 }
                  ].map((cursor, idx) => (
                    <motion.div 
                      key={idx}
                      animate={{ 
                        x: [0, cursor.x1, cursor.x2, 0],
                        y: [0, cursor.y1, cursor.y2, 0]
                      }}
                      transition={{ duration: 8 + cursor.delay, repeat: Infinity, ease: "easeInOut", delay: cursor.delay }}
                      className="absolute top-1/2 left-1/2 px-4 py-2 rounded-full bg-[var(--elevated)]/80 border border-[var(--border-bright)] shadow-2xl flex items-center gap-3 backdrop-blur-xl"
                    >
                      <MousePointer2 className={`w-5 h-5 ${cursor.color}`} fill="currentColor" />
                      <span className="text-[var(--text-primary)] text-xs font-bold tracking-wider">{cursor.name}</span>
                    </motion.div>
                  ))}

                  <motion.div 
                    initial={{ opacity: 0, scale: 0, y: 20 }}
                    whileInView={{ opacity: 1, scale: 1, y: 0 }}
                    viewport={{ once: true, margin: "-10%" }}
                    transition={{ delay: 3.5, type: "spring", bounce: 0.5 }}
                    className="absolute bottom-10 right-10 px-4 py-2 rounded-full bg-[var(--accent)]/10 border border-[var(--accent)]/30 backdrop-blur-md shadow-[0_0_20px_rgba(0,212,255,0.2)] text-[var(--accent)] text-xs font-bold flex items-center gap-2 z-50"
                  >
                    <Zap className="w-4 h-4" /> Zero-Server P2P
                  </motion.div>
                </ShowcaseShaderMask>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Feature Orbit Showcase */}
        <section id="features" className="relative bg-[var(--bg)]">
          <FeatureOrbit />
        </section>

        {/* Comparison Section */}
        <section id="compare" className="py-40 px-4 relative bg-[var(--bg)] border-y border-[var(--border)]">
          <div className="max-w-7xl mx-auto relative z-10">
            <div className="text-center mb-24">
              <motion.h2 
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-5xl md:text-7xl font-black mb-8 tracking-tight"
              >
                The New <span className="italic font-display font-light text-transparent bg-clip-text bg-gradient-to-r from-[var(--accent)] to-purple-500 pr-4">Standard</span>
              </motion.h2>
              <p className="text-xl text-zinc-400 font-light max-w-2xl mx-auto">See how Let's Collab compares to legacy remote desktop solutions in the market.</p>
            </div>
            
            <div className="w-full pb-8">
              <div className="w-full rounded-2xl md:rounded-3xl bg-zinc-950/80 border border-[var(--border)]/60 overflow-hidden backdrop-blur-xl shadow-2xl">
                <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[2fr_1fr_1fr] bg-gradient-to-r from-zinc-900 to-black border-b border-[var(--border)]/60 p-4 sm:p-8 text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400 gap-4 sm:gap-0">
                  <div className="flex items-center">Feature Architecture</div>
                  <div className="text-center text-[var(--accent)] flex flex-col sm:flex-row items-center justify-center gap-2 px-2 drop-shadow-[0_0_10px_rgba(0,212,255,0.5)]">Let's Collab <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" /></div>
                  <div className="text-center px-2 flex items-center justify-center">Legacy Solutions</div>
                </div>
                
                <div className="divide-y divide-white/5">
                  {[
                    { feature: "Core Remote Engine (Screen, Mouse, Room Sharing)", collab: true, competitor: true },
                    { feature: "Server-Enforced Granular Access Tiers", collab: true, competitor: false },
                    { feature: "Blockchain-Verified Session Audit Trail", collab: true, competitor: false },
                    { feature: "Federated On-Device AI Monitoring", collab: true, competitor: false },
                    { feature: "Zero-Server P2P Unlimited File Sharing", collab: true, competitor: false },
                    { feature: "AI Virtual Avatars & Composited Recording", collab: true, competitor: false },
                    { feature: "Open-Source, Self-Hosted & Transparent", collab: true, competitor: false },
                  ].map((row, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -30, filter: "blur(10px)" }}
                      whileInView={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                      viewport={{ once: true, margin: "-50px" }}
                      transition={{ delay: i * 0.1, duration: 0.7, type: "spring", bounce: 0.4 }}
                      className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[2fr_1fr_1fr] p-4 sm:p-8 items-center hover:bg-white/[0.03] transition-all group gap-4 sm:gap-0 relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)]/5 to-transparent translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-700 ease-out" />
                      <div className="text-zinc-200 font-bold text-sm sm:text-xl leading-tight relative z-10 group-hover:text-[var(--text-primary)] transition-colors">{row.feature}</div>
                      <div className="flex justify-center px-2 sm:px-0 relative z-10">
                        {row.collab ? (
                          <motion.div 
                            whileHover={{ scale: 1.1, rotate: 10 }}
                            className="w-8 h-8 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-[var(--accent)]/20 to-[var(--accent)]/5 border border-[var(--accent)]/30 text-[var(--accent)] flex items-center justify-center shadow-[0_0_20px_var(--accent)]"
                          >
                            <Check className="w-5 h-5 sm:w-7 sm:h-7" strokeWidth={3} />
                          </motion.div>
                        ) : (
                          <div className="text-zinc-600 font-bold">—</div>
                        )}
                      </div>
                      <div className="flex justify-center relative z-10">
                        {row.competitor ? (
                          <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-2xl bg-zinc-900 border border-[var(--border)] text-zinc-500 flex items-center justify-center">
                            <Check className="w-4 h-4 sm:w-6 sm:h-6" strokeWidth={2} />
                          </div>
                        ) : (
                          <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-2xl bg-red-500/5 border border-red-500/10 text-red-500/60 flex items-center justify-center">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 sm:w-6 sm:h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  
                  {/* Compare complete milestone toast */}

                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Horizontal Scrolling Showcase */}
        <section id="workflow" className="py-40 overflow-hidden bg-[var(--bg)] relative" ref={showcaseRef}>
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,rgba(110,63,255,0.1),transparent_70%)]" />
          <div className="max-w-[100vw] px-8 mb-24 relative z-10">
            <motion.h2 
              initial={{ opacity: 0, x: -100 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="text-7xl md:text-[10rem] font-black tracking-tighter leading-none"
            >
              Immersive <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-zinc-500 to-zinc-800">Interface.</span>
            </motion.h2>
          </div>
          
          <motion.div 
            style={{ x: xShowcase }}
            className="flex gap-12 px-12 w-[300vw] relative z-10"
          >
            {[
              { title: "Dashboard", desc: "Your command center for sessions." },
              { title: "Session", desc: "Crystal clear remote view." },
              { title: "Settings", desc: "Total control over permissions." },
              { title: "History", desc: "Audit logs of all connections." },
              { title: "Federated", desc: "Connect local AI models." }
            ].map((item, i) => (
              <div 
                key={i} 
                className="w-[80vw] md:w-[50vw] shrink-0 aspect-[16/9] rounded-[3rem] bg-zinc-900/50 backdrop-blur-xl border border-[var(--border)]/60 overflow-hidden relative group"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
              >
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent z-10" />
                
                {/* Fake Image Placeholder */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-32 h-32 rounded-full border border-[var(--border)] flex items-center justify-center">
                    <AppLogo size="large" />
                  </div>
                </div>

                <div className="absolute bottom-16 left-16 z-20 translate-y-10 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-700 ease-out">
                  <h3 className="text-5xl font-black text-[var(--text-primary)] mb-4">{item.title}</h3>
                  <p className="text-2xl text-zinc-400 font-light">{item.desc}</p>
                </div>
              </div>
            ))}
          </motion.div>
        </section>

        {/* About the Creator Section */}
        <section id="creator" className="py-40 px-4 relative bg-[var(--bg)] overflow-hidden">
          <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-[0.03]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vw] bg-[radial-gradient(circle,rgba(255,255,255,0.03)_0%,transparent_60%)] pointer-events-none" />
          
          <div className="max-w-7xl mx-auto relative z-10 flex flex-col lg:flex-row gap-10 sm:gap-20 items-center">
            {/* Image / Portrait Side */}
            <motion.div 
              initial={{ opacity: 0, x: -50, rotateY: 15 }}
              whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1.5, type: "spring" }}
              className="w-4/5 sm:w-full lg:w-2/5 mx-auto relative"
            >
              <div className="aspect-[4/5] rounded-[3rem] overflow-hidden border border-[var(--border)]/60 relative group bg-zinc-950 flex flex-col items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10" />
                <div className="absolute inset-0 animate-pulse bg-zinc-900/50" />
                
                {/* Fallback Avatar UI */}
                <div className={`absolute z-0 inset-0 flex flex-col items-center justify-center opacity-50 transition-opacity duration-500 ${imageError ? 'opacity-100' : ''}`}>
                  <User className="w-32 h-32 text-zinc-700 mb-6" />
                  <span className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-2">Image Missing</span>
                  <p className="text-zinc-600 text-sm text-center">Save your photo as<br/><code className="text-[var(--accent)] font-mono">public/kishan.jpg</code></p>
                </div>

                {/* Place the image here - using object-cover */}
                {!imageError && (
                  <img 
                    src="/kishan.jpg" 
                    alt="Kishan" 
                    className="w-full h-full object-cover relative z-0 transition-transform duration-1000 group-hover:scale-105 grayscale group-hover:grayscale-0"
                    onError={() => setImageError(true)}
                  />
                )}
                
                <div className="absolute bottom-10 left-10 z-20">
                  <h3 className="text-4xl font-black text-[var(--text-primary)] mb-2">Kishan</h3>
                  <p className="text-[var(--accent)] font-bold tracking-widest text-sm uppercase">Lead Engineer & Creator</p>
                </div>
              </div>
              
              {/* Decorative nodes */}
              <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full border border-[var(--border)] border-dashed animate-[spin_20s_linear_infinite] flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-[var(--accent)] absolute top-0" />
              </div>
            </motion.div>

            {/* Content Side */}
            <div className="w-full lg:w-3/5 text-center sm:text-left px-4 sm:px-0">
              <motion.h2 
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-4xl sm:text-5xl md:text-7xl font-black mb-8 sm:mb-10 tracking-tight"
              >
                About the <span className="italic font-light font-display text-transparent bg-clip-text bg-gradient-to-r from-zinc-400 to-white">Creator</span>
              </motion.h2>
              
              <div className="space-y-8 text-xl text-zinc-400 font-light leading-relaxed">
                <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}>
                  DRCSFA ("Let's Collab!") is built and led by Kishan, a final-year Computer Science Engineering (Data Science) student at Vivekananda College of Engineering (VCET) in Puttur, Karnataka — while based in Kasaragod, Kerala, India.
                </motion.p>
                
                <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
                  As team lead of a four-person engineering group, Kishan designed and built DRCSFA from the ground up: a decentralized remote collaboration platform combining real-time WebRTC communication, blockchain-backed audit trails on Ethereum, and privacy-preserving on-device AI monitoring.
                </motion.p>
                
                <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}>
                  Beyond DRCSFA, his work spans full-stack development, AI/ML, and blockchain systems — including contributions to content and web development at Nexara, a B2B marketing company, and other independent projects exploring federated systems and decentralized architectures.
                </motion.p>
                
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }} 
                  whileInView={{ opacity: 1, scale: 1 }} 
                  viewport={{ once: true }} 
                  transition={{ delay: 0.4 }}
                  className="p-8 rounded-3xl bg-[var(--elevated)] border border-[var(--border)]/60 mt-12 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)]/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  <p className="text-2xl font-medium text-[var(--text-primary)] italic relative z-10">
                    "His interest in this space comes from a simple idea: trust shouldn't have to be taken on faith — it should be something you can verify yourself."
                  </p>
                </motion.div>
                
                <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.5 }} className="pt-8">
                  <a href="https://www.linkedin.com/in/kishan-karthik-s-5453ab1b1/" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-full bg-[#0077b5] text-[var(--text-primary)] font-bold hover:bg-[#005582] transition-colors shadow-lg hover:shadow-xl hover:scale-105 active:scale-95">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    Connect on LinkedIn
                  </a>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* Downloads Section */}
        <section id="download" className="py-40 px-4 relative bg-[var(--bg)]">
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--accent)]/10 to-transparent" />
          <div className="max-w-7xl mx-auto text-center relative z-10">
            <motion.h2 
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="text-8xl md:text-[10rem] font-black mb-12 tracking-tighter leading-none"
            >
              Get Started.
            </motion.h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
              <div className="relative">
                <motion.div 
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5, type: "spring", bounce: 0.5 }}
                  className="absolute -top-3 -right-3 px-3 py-1 bg-[var(--accent)] text-black text-[10px] font-black rounded-full z-20 shadow-[0_0_15px_var(--accent)]"
                >
                  v0.1.14
                </motion.div>
                <DownloadCard 
                  os="Windows"
                  status="Version 0.1.14 • Stable"
                  link={desktopDownloadUrl}
                  active={true}
                  icon={
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-20 h-20 mb-10 text-[var(--accent)] group-hover:scale-125 transition-transform duration-700 ease-out">
                      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.951-1.801"/>
                    </svg>
                  }
                />
              </div>
              <DownloadCard 
                os="macOS"
                status="Beta Testing • Q4 2026"
                active={false}
                icon={
                  <svg viewBox="0 0 384 512" fill="currentColor" className="w-16 h-16 mb-10 text-zinc-600">
                    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
                  </svg>
                }
              />
              <DownloadCard 
                os="Linux"
                status="Alpha Preview"
                active={false}
                icon={
                  <svg viewBox="0 0 448 512" fill="currentColor" className="w-16 h-16 mb-10 text-zinc-600">
                    <path d="M220.8 123.3c1 .5 1.8 1.7 3 1.7 1.1 0 2.8-.4 2.9-1.5.2-1.4-1.9-2.3-3.2-2.9-1.7-.7-3.9-1-5.5-.1-.4.2-.8.7-.6 1.1.3 1.3 2.3 1.1 3.4 1.7zm-21.9 1.7c1.2 0 2-1.2 3-1.7 1.1-.6 3.1-.4 3.5-1.7.2-.4-.2-.9-.6-1.1-1.6-.9-3.8-.6-5.5.1-1.3.6-3.4 1.5-3.2 2.9.1 1 1.8 1.5 2.8 1.5zm70.4 38.6c-1.3-4.9-4.4-10.8-8.7-15.1-15.8-15.7-39.7-22.3-61.1-22.3-21.8 0-46.1 6.8-61.7 22.8-4.4 4.5-7.4 10.1-8.5 15.6-2.5 12.1.2 24.7 3.5 35 1 3.3 2.3 6.9 4.3 9.4 1 1.2 1.8 2 2.7 3.1-4.7 7.2-7.5 16.5-11.1 24.8-1.7 4-3.5 7.9-5.1 11.9-2.9 7.2-5 14.8-5.3 22.6-1.5 33.3 16.5 61.2 41.6 77.2 23.3 14.9 51.5 20.3 78.5 18.5 21.6-1.4 42.6-9.1 58.7-23.7 10.6-9.6 19.3-22.3 22-37 1.8-10.1 .7-20.9-2.7-30.5-1.4-4-3-7.9-4.7-11.7-3.2-7.5-5.9-15.7-9.8-22.4 1-1.2 1.9-2.3 2.9-3.4 2-2.5 3.3-6 4.3-9.3 3.3-10.3 6-22.9 3.5-35zm-95.2 20.3c3 0 5.4 3.7 5.4 8.2s-2.4 8.2-5.4 8.2-5.4-3.7-5.4-8.2 2.4-8.2 5.4-8.2zm20.1 27.6c-4.4-1.2-8.6-2.6-13-3.8-3.9-1-8.4-1.9-12.2-.6-3 .9-5.4 3-7.7 5.1-4 3.8-7 8.3-9.9 12.8-1.9 2.9-4.2 6.5-5.3 10-1.7 5.2-1.9 10.7-1.3 16 .4 3.8 1.4 7.5 3 11 2.3 5 5.8 10 9.8 13.9 3.2 3.1 7.1 5.8 11.2 7.7 5.1 2.5 11.2 3.3 16.5 1.5 4.5-1.5 8.1-4.7 11.2-8.3 3.3-3.9 6.2-8 8.4-12.7 2-4.5 3.3-9.3 4.2-14.3 1-5.5 .9-11-.6-16.4-1.3-4.5-3.6-8.9-6.8-12.2-2.6-2.6-5.8-5-9.3-6.1-2.9-.9-6-1.5-8.8-2.6zm39-11c3 0 5.4 3.7 5.4 8.2s-2.4 8.2-5.4 8.2-5.4-3.7-5.4-8.2 2.4-8.2 5.4-8.2zm-15.3 42.1c1 .9 1.9 1.9 2.9 2.7 2.8 2.2 6 4.1 9.4 5.2 3.9 1.3 8.3 1.2 12.3 0 3.3-1 6.5-2.6 9.4-4.5 2.6-1.7 5-3.6 7.3-5.7 3.6-3.2 6.5-7.2 9.1-11.2 2.3-3.7 4.1-7.7 5.6-11.8 1.4-4 2.4-8.4 2.8-12.6 .5-5.2-.2-10.4-1.9-15.3-1.6-4.8-4-9.3-7.5-12.9-2.2-2.3-4.9-4.1-7.7-5.5-3.8-1.8-8.2-2.5-12.4-2.4-4.8 .2-9.4 1.7-13.7 3.8-3.8 1.8-7.2 4.1-10.3 6.9-4 3.5-7.2 7.8-9.6 12.5-2 4-3.3 8.3-4.2 12.7-1 5-1.1 10.3-.4 15.3 .5 4 1.8 7.9 3.6 11.4 1.6 3 3.5 5.8 5.4 8.4zm23.6-17.7c-4 0-7.3-3.9-7.3-8.8s3.3-8.8 7.3-8.8 7.3 3.9 7.3 8.8-3.3 8.8-7.3 8.8zm-57.9-8.8c0 4.9-3.3 8.8-7.3 8.8s-7.3-3.9-7.3-8.8 3.3-8.8 7.3-8.8 7.3 3.9 7.3 8.8z"/>
                    <path d="M439.4 345.9c-8.7-22.3-25.5-40-42.5-57-5.8-5.7-11.7-11.3-17.5-17.3-2.3-2.4-6.3-2.9-8.7-.3-1.4 1.4-1.8 3.6-1.2 5.5 4.3 12.3 8.1 24.6 10.4 37.6 1.5 8.1 1.7 16.3 .4 24.3-1.1 7.1-3.6 14-6.7 20.6-2.5 5.3-5.3 10.5-8.5 15.5-6.9 10.6-15.6 20-25.9 27.5-12.4 9.1-27 15.4-41.9 19.4-14.7 3.9-30 5.6-45.2 4.5-15.4-1.2-30.8-4.7-45.4-10-14.7-5.3-28.7-13.1-41.1-23.2-11.3-9.2-20.9-20.5-28.4-33-4-6.6-7.3-13.6-9.9-20.9-2.2-6-3.8-12.3-4.5-18.7-1.1-9.3 .5-18.6 3.6-27.4 2.8-8 6.4-15.8 11-23 1-1.5 2-3 3.1-4.5 1.5-2 1.3-4.9-.5-6.6-2.1-2.1-5.7-2.3-7.9-.2-8.5 8-17.2 16.2-25.4 24.6-11.6 12-21.7 25.1-28.8 40-7.3 15.3-11.2 32.2-11.4 49-.2 15.4 3.7 30.6 11.2 44.1 6.7 12.1 15.7 22.8 26.6 31.5 11.3 9.1 24.3 15.9 38 20.6 15 5.1 30.7 8.3 46.4 9.6 14.1 1.1 28.3 .2 42.1-3 15.1-3.4 29.8-9.4 43.1-17.7 12.4-7.7 23.6-17.2 33-28.3 8.3-9.8 15.2-20.9 20.3-32.8 4.7-11 7.9-22.5 9.4-34.4 1-8.5 .8-17.1-1.3-25.5-2.2-8.6-5.8-16.7-10.2-24.3-1.1-2-2.3-3.8-3.4-5.8z"/>
                  </svg>
                }
              />
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-20 border-t border-[var(--border)] bg-[var(--bg)] relative z-10 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--accent)]/5 pointer-events-none" />
          <div className="max-w-7xl mx-auto px-8 relative z-10 flex flex-col md:flex-row justify-between gap-16">
            
            {/* Branding */}
            <div className="md:w-1/3 flex flex-col items-start gap-8">
              <AppLogo size="large" />
              <div className="flex gap-6 mt-4">
                <a href="https://www.linkedin.com/in/kishan-karthik-s-5453ab1b1/" target="_blank" rel="noreferrer" className="w-12 h-12 rounded-full border border-[var(--border)]/60 flex items-center justify-center text-zinc-400 hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]/80 hover:bg-[var(--elevated)] transition-all">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <a href="#" className="w-12 h-12 rounded-full border border-[var(--border)]/60 flex items-center justify-center text-zinc-400 hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]/80 hover:bg-[var(--elevated)] transition-all">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                </a>
              </div>
            </div>

            {/* Short Bio */}
            <div className="md:w-1/2 flex flex-col gap-6">
              <h4 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">Built by Kishan</h4>
              <p className="text-zinc-400 leading-relaxed font-light text-sm text-justify">
                Kishan is a final-year Computer Science Engineering (Data Science) student at Vivekananda College of Engineering, Puttur, Karnataka — building DRCSFA as his major engineering project. His work spans full-stack development, AI/ML, and blockchain, with a particular interest in systems that make trust verifiable rather than assumed.
              </p>
              <div className="pt-6 border-t border-[var(--border)]/60 mt-4 flex items-center justify-between text-xs text-zinc-600 font-bold uppercase tracking-widest">
                <span>© 2026 Let's Collab Protocol</span>
                <span>Open Architecture</span>
              </div>
            </div>
            
          </div>
        </footer>
      </main>
    </div>
  )
}

function BentoCard({ icon, title, description, colSpan = "col-span-1", gradient }: { icon: React.ReactNode, title: string, description: string, colSpan?: string, gradient: string }) {
  return (
    <div className={`relative p-12 rounded-[3rem] bg-[var(--bg)] border border-[var(--border)]/60 overflow-hidden ${colSpan} h-full`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
      
      <div className="relative z-10 flex flex-col h-full justify-between gap-12">
        <div className="w-20 h-20 rounded-[2rem] bg-zinc-900 border border-[var(--border)]/60 flex items-center justify-center text-[var(--text-primary)] shadow-2xl">
          {React.cloneElement(icon as React.ReactElement<any>, { className: "w-10 h-10" })}
        </div>
        <div>
          <h3 className="text-3xl font-black text-[var(--text-primary)] mb-4">{title}</h3>
          <p className="text-zinc-400 font-light text-xl leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  )
}

function DownloadCard({ os, status, link, active, icon }: { os: string, status: string, link?: string, active: boolean, icon: React.ReactNode }) {
  return (
    <MagneticButton className="h-full">
      <div className={`relative h-full p-16 rounded-[4rem] border flex flex-col items-center justify-center transition-all duration-700 group overflow-hidden ${
        active 
          ? 'bg-zinc-950 border-[var(--accent)]/40 shadow-[0_0_80px_-20px_var(--accent)] hover:shadow-[0_0_120px_-10px_var(--accent)] hover:border-[var(--accent)]' 
          : 'bg-black/80 border-[var(--border)] opacity-80'
      }`}>
        <div className="relative z-10 flex flex-col items-center">
          {icon}
          <h3 className="text-4xl font-black text-[var(--text-primary)] mb-4 tracking-tight">{os}</h3>
          <p className={`text-sm font-black uppercase tracking-[0.2em] mb-12 ${active ? 'text-[var(--accent)]' : 'text-zinc-600'}`}>{status}</p>
          {active ? (
            <a href={link} className="w-full py-6 px-10 bg-white text-black font-black rounded-3xl hover:bg-[var(--accent)] hover:text-[var(--text-primary)] hover:scale-105 transition-all shadow-xl active:scale-95 text-center text-xl tracking-wide">
              Download File
            </a>
          ) : (
            <button disabled className="w-full py-6 px-10 bg-[var(--elevated)] border border-[var(--border)]/60 text-zinc-600 font-black rounded-3xl cursor-not-allowed text-xl tracking-wide">
              Notify Me
            </button>
          )}
        </div>
      </div>
    </MagneticButton>
  )
}
