"use client"

import React, { useRef, useState } from 'react'
import { motion, useScroll, useTransform, useSpring, useMotionValueEvent, AnimatePresence } from 'framer-motion'
import { Globe, Monitor, Brain, Users, Wand2, Shield, Network, MousePointer2, Gamepad2, FileDown, Eye, Maximize, Activity, Lock, Presentation, Smile, Settings, Search } from 'lucide-react'

const features = [
  {
    id: "p2p-core",
    title: "1. Decentralized Peer-to-Peer Core",
    icon: <Globe className="w-8 h-8" />,
    color: "from-blue-500 to-cyan-400",
    glow: "rgba(6, 182, 212, 0.5)",
    points: [
      { t: "Zero-Latency Video/Audio Streaming", d: "High-quality bi-directional streaming between Host and Controller without routing media through a central server." },
      { t: "P2P Data Channels", d: "Dedicated WebRTC channels for input mapping, file transfer, chat, and annotations for instant, secure data transmission." }
    ]
  },
  {
    id: "remote-control",
    title: "2. Remote Desktop Control",
    icon: <Monitor className="w-8 h-8" />,
    color: "from-purple-500 to-indigo-400",
    glow: "rgba(129, 140, 248, 0.5)",
    points: [
      { t: "Direct Input Injection", d: "Controller's mouse movements, clicks, and keyboard strokes are captured and sent over the data channel." },
      { t: "RobotJS Integration", d: "The Host's Electron Desktop app receives these events and physically moves the local OS cursor and injects keyboard inputs in real-time." }
    ]
  },
  {
    id: "federated-ai",
    title: "3. Federated AI & Anti-Cheat",
    icon: <Brain className="w-8 h-8" />,
    color: "from-emerald-500 to-teal-400",
    glow: "rgba(45, 212, 191, 0.5)",
    points: [
      { t: "AI Supervisor", d: "Runs in supervised sessions to monitor the active participant camera and interaction signals." },
      { t: "Biometric Tracking", d: "Uses facial landmark detection to track gaze deviation (eye movement away from the screen) and stress/emotion states." },
      { t: "Tab/Window Monitoring", d: "Detects if the user switches tabs or minimizes the application." },
      { t: "Federated Local Training (FL)", d: "Uses TensorFlow.js to train a local neural network on user heuristic data. It extracts the model weights and securely pushes them to the aggregator node to protect data privacy." },
      { t: "Blockchain Evidence Capture", d: "Automatically captures screenshots of malpractice and uploads them as logged evidence." }
    ]
  },
  {
    id: "elite-tools",
    title: "4. Elite Collaboration Tools",
    icon: <Users className="w-8 h-8" />,
    color: "from-rose-500 to-orange-400",
    glow: "rgba(251, 146, 60, 0.5)",
    points: [
      { t: "Zero-Server P2P File Sharing", d: "A drag-and-drop zone that chunks files (of any size) and sends them directly to the other user over the P2P data channel." },
      { t: "Live Screen Annotation", d: "An invisible interactive layer over the screen share allows the controller to draw circles, arrows, or notes directly on the host's screen." },
      { t: "Audited Session Chat", d: "A slide-out chat window broadcasts room messages through the backend and records chat activity in the room audit trail." },
      { t: "Advanced Multi-stream Recording", d: "HTML5 Canvas compositing merges the main screen share, local webcam PIP, remote webcam PIP, and both microphones into one WebM video." }
    ]
  },
  {
    id: "immersive-filters",
    title: "5. Fun & Immersive Filters",
    icon: <Wand2 className="w-8 h-8" />,
    color: "from-[var(--accent)] to-fuchsia-400",
    glow: "rgba(217, 70, 239, 0.5)",
    points: [
      { t: "Voice Changers (Web Audio API)", d: "Real-time audio filtering and manipulation for robot, alien, radio, megaphone, deep, chipmunk, echo, male, and female styles." },
      { t: "Virtual Avatars (Face-api.js)", d: "Facial landmark tracking maps packaged 2D overlays such as cyberpunk, neon, pixel, hologram, sketch, synthwave, and anime styles onto the user's face in real time." },
      { t: "Virtual Backgrounds (MediaPipe)", d: "AI body-segmentation that removes the user's physical background and replaces it with heavy blur or customized images." }
    ]
  },
  {
    id: "admin-dashboard",
    title: "6. Admin & Management Dashboard",
    icon: <Shield className="w-8 h-8" />,
    color: "from-slate-400 to-gray-200",
    glow: "rgba(148, 163, 184, 0.5)",
    points: [
      { t: "Admin Panel", d: "Secure dashboard for viewing system analytics, past sessions, and uploaded evidence logs." },
      { t: "Session Types", d: "Flexible room generation allowing users to join in either Collaboration mode or Supervised mode (for exams/interviews)." }
    ]
  }
]

export function FeatureOrbit() {
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Track scroll progress through this entire section
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  })

  // We have 6 features.
  // We want activeIndex to be 0 at top, and 5 at bottom.
  const currentIndexProgress = useTransform(scrollYProgress, [0, 1], [0, features.length - 1])
  
  const [activeIndex, setActiveIndex] = useState(0)

  // Update active index based on scroll
  useMotionValueEvent(currentIndexProgress, "change", (v) => {
    const idx = Math.round(v)
    setActiveIndex((current) => (idx !== current && idx >= 0 && idx < features.length ? idx : current))
  })

  const activeFeature = features[activeIndex]

  return (
    <div ref={containerRef} className="relative w-full h-[600vh] bg-[#030305]">
      
      {/* Sticky Container */}
      <div className="sticky top-0 w-full h-screen flex flex-col md:flex-row items-center justify-center overflow-hidden">
        
        {/* Left Side: Animated Orbit/Core Visualizer */}
        <div className="w-full md:w-1/2 h-[50vh] md:h-full relative flex items-center justify-center pointer-events-none">
          
          {/* Background Ambient Glow */}
          <motion.div 
            className="absolute inset-0 z-0 transition-colors duration-1000"
            style={{ 
              background: `radial-gradient(circle at center, ${activeFeature.glow} 0%, transparent 60%)`,
              opacity: 0.3
            }}
          />

          {/* Central Rotating Core */}
          <div className="relative z-10 flex items-center justify-center w-64 h-64 md:w-96 md:h-96">
            
            {/* Outer Orbit Rings */}
            <motion.div 
              animate={{ rotateZ: 360, rotateX: 60, rotateY: 30 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute w-full h-full border border-white/10 rounded-full"
            />
            <motion.div 
              animate={{ rotateZ: -360, rotateX: -40, rotateY: 60 }}
              transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
              className="absolute w-[80%] h-[80%] border-2 border-dashed border-white/10 rounded-full"
            />
            
            {/* Inner Icon Sphere */}
            <AnimatePresence mode="wait">
              <motion.div 
                key={activeFeature.id}
                initial={{ scale: 0, opacity: 0, rotate: -90 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0, opacity: 0, rotate: 90 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={`relative flex items-center justify-center w-32 h-32 md:w-48 md:h-48 rounded-full bg-gradient-to-br ${activeFeature.color} shadow-[0_0_50px_rgba(0,0,0,0.5)]`}
                style={{ boxShadow: `0 0 80px ${activeFeature.glow}` }}
              >
                <div className="text-white drop-shadow-2xl">
                  {React.cloneElement(activeFeature.icon as React.ReactElement<any>, { className: 'w-12 h-12 md:w-20 md:h-20' })}
                </div>
                
                {/* Orbital floating elements based on active index */}
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ 
                      rotate: 360,
                      x: [0, 20, -20, 0],
                      y: [0, -20, 20, 0]
                    }}
                    transition={{ 
                      rotate: { duration: 5 + i * 2, repeat: Infinity, ease: "linear" },
                      x: { duration: 3 + i, repeat: Infinity, ease: "easeInOut", repeatType: "reverse" },
                      y: { duration: 4 + i, repeat: Infinity, ease: "easeInOut", repeatType: "reverse" }
                    }}
                    className="absolute w-3 h-3 bg-white rounded-full mix-blend-overlay blur-[1px]"
                    style={{
                      top: `${Math.random() * 100}%`,
                      left: `${Math.random() * 100}%`,
                    }}
                  />
                ))}
              </motion.div>
            </AnimatePresence>
            
          </div>
        </div>

        {/* Right Side: Text Content Box */}
        <div className="w-full md:w-1/2 h-[50vh] md:h-full flex flex-col justify-center px-6 md:px-20 z-20">
          
          <AnimatePresence mode="wait">
            <motion.div
              key={activeFeature.id}
              initial={{ opacity: 0, y: 50, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -50, filter: "blur(10px)" }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="flex flex-col gap-6"
            >
              
              <motion.h2 
                className={`text-3xl md:text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r ${activeFeature.color}`}
              >
                {activeFeature.title}
              </motion.h2>

              <div className="space-y-6">
                {activeFeature.points.map((pt, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + (i * 0.1) }}
                    className="border-l-2 pl-4 py-1"
                    style={{ borderColor: activeFeature.glow }}
                  >
                    <h4 className="text-lg md:text-xl font-bold text-zinc-200 mb-1">{pt.t}</h4>
                    <p className="text-sm md:text-base text-zinc-400 leading-relaxed">{pt.d}</p>
                  </motion.div>
                ))}
              </div>

            </motion.div>
          </AnimatePresence>

        </div>

      </div>

    </div>
  )
}
