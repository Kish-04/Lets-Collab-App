"use client"

import React, { useRef, useState } from 'react'
import { motion, useScroll, useSpring, useVelocity, useAnimationFrame, useTransform } from 'framer-motion'

// 1. Text Reveal Character by Character
export const TextReveal = ({ text, delay = 0 }: { text: string, delay?: number }) => {
  return (
    <span className="inline-block overflow-hidden">
      {text.split('').map((char, index) => (
        <motion.span
          key={index}
          initial={{ y: "100%", opacity: 0, rotate: 10 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          transition={{
            duration: 0.8,
            delay: delay + index * 0.03,
            ease: [0.2, 1, 0.3, 1]
          }}
          className="inline-block"
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </span>
  )
}

// 2. Magnetic Button Effect
export const MagneticButton = ({ children, className, ...props }: any) => {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const handleMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = e
    const { height, width, left, top } = ref.current!.getBoundingClientRect()
    const middleX = clientX - (left + width / 2)
    const middleY = clientY - (top + height / 2)
    setPosition({ x: middleX * 0.3, y: middleY * 0.3 })
  }

  const reset = () => {
    setPosition({ x: 0, y: 0 })
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// 3. 3D Tilt Card
export const TiltCard = ({ children, className }: { children: React.ReactNode, className?: string }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [rotateX, setRotateX] = useState(0)
  const [rotateY, setRotateY] = useState(0)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const width = rect.width
    const height = rect.height
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const xPct = mouseX / width - 0.5
    const yPct = mouseY / height - 0.5
    setRotateX(yPct * -15) // Max rotation 15deg
    setRotateY(xPct * 15)
  }

  const handleMouseLeave = () => {
    setRotateX(0)
    setRotateY(0)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ rotateX, rotateY }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      style={{ perspective: 1000, transformStyle: "preserve-3d" }}
      className={className}
    >
      <div style={{ transform: "translateZ(30px)" }} className="w-full h-full">
        {children}
      </div>
    </motion.div>
  )
}

// 4. Scroll Velocity Marquee
export const VelocityMarquee = ({ baseVelocity = 100, children }: { baseVelocity: number, children: React.ReactNode }) => {
  const baseX = useRef(0)
  const { scrollY } = useScroll()
  const scrollVelocity = useVelocity(scrollY)
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 })
  const velocityFactor = useTransform(smoothVelocity, [0, 1000], [0, 5], { clamp: false })

  const [x, setX] = useState(0)

  useAnimationFrame((t, delta) => {
    let moveBy = directionFactor.current * baseVelocity * (delta / 1000)
    if (velocityFactor.get() < 0) {
      directionFactor.current = -1
    } else if (velocityFactor.get() > 0) {
      directionFactor.current = 1
    }
    moveBy += directionFactor.current * moveBy * velocityFactor.get()
    baseX.current += moveBy
    // Magic number for loop wrapping - depends on content width
    if (baseX.current <= -100) baseX.current = 0
    if (baseX.current > 0) baseX.current = -100
    setX(baseX.current)
  })

  const directionFactor = useRef<number>(1)

  return (
    <div className="overflow-hidden whitespace-nowrap flex flex-nowrap m-0 opacity-10">
      <motion.div className="flex whitespace-nowrap gap-16 text-[10vw] font-black uppercase tracking-tighter" style={{ x: `${x}%` }}>
        <span>{children} </span>
        <span>{children} </span>
        <span>{children} </span>
        <span>{children} </span>
      </motion.div>
    </div>
  )
}
