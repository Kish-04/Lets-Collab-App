"use client"

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Contributor = {
  name: string
  photo: string
  role: string
  bio: string[]
  skills: string[]
}

const CONTRIBUTORS: Contributor[] = [
  {
    name: 'Shrinandana I',
    photo: '/contributors/shrinandana.webp',
    role: 'CSE (Data Science) · VCET Puttur · 2027',
    bio: [
      'Shrinandana focuses on software development, data analytics, and building practical web applications, with hands-on work in frontend development, backend integration, debugging, and data visualization.',
      'Projects include a Blockchain-Based Land Registry System for managing property records and verifying ownership, and an AI Data Visualization Dashboard built with React, Tailwind CSS, and Flask. Internships with Kiran Foundation, Synent Technologies, and InAmigos Foundation covered web development, data analytics, and research.',
    ],
    skills: ['Python', 'JavaScript', 'React', 'Node.js', 'MongoDB', 'Power BI'],
  },
  {
    name: 'Dhanush V Rai',
    photo: '/contributors/dhanush.webp',
    role: 'CSE (Data Science) · VCET Puttur · 2027',
    bio: [
      'Dhanush builds software applications with Python, Java, JavaScript, SQL, and web technologies, working across frontend development, backend integration, database management, and debugging.',
      'Projects include a Blockchain-Based Property Records System for keeping property records secure. A Data Analytics internship with ApexPlanet Software covered data cleaning, exploratory data analysis, and dataset preparation in Python.',
    ],
    skills: ['Python', 'Java', 'React', 'TypeScript', 'Django', 'MongoDB'],
  },
  {
    name: 'Puneeth',
    photo: '/contributors/puneeth.webp',
    role: 'CSE (Data Science) · VCET Puttur',
    bio: [
      'Puneeth works across software development, cybersecurity, and web technologies. He built PhishGuard, a phishing email detection and investigation platform using Python, FastAPI, React, and MongoDB to analyze suspicious emails and identify threats.',
      'He also worked on a Blockchain-Based Land Registry System for secure, transparent, and tamper-resistant property records, with interests in databases, blockchain, and application security.',
    ],
    skills: ['Python', 'FastAPI', 'React', 'MongoDB', 'Blockchain', 'Security'],
  },
]

export function Contributors() {
  const [active, setActive] = useState(0)
  const current = CONTRIBUTORS[active]
  const step = (delta: number) => setActive(i => (i + delta + CONTRIBUTORS.length) % CONTRIBUTORS.length)

  return (
    <section id="contributors" className="py-24 sm:py-32 px-4 relative bg-[var(--bg)] overflow-hidden">
      {/* Faint first name behind the card, like a watermark */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current.name}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          aria-hidden
          className="absolute top-16 left-1/2 -translate-x-1/2 text-[18vw] sm:text-[12rem] font-black uppercase tracking-tight text-white/[0.04] whitespace-nowrap pointer-events-none select-none"
        >
          {current.name.split(' ')[0]}
        </motion.div>
      </AnimatePresence>

      <div className="max-w-4xl mx-auto relative z-10">
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl sm:text-5xl font-black mb-3 tracking-tight text-center"
        >
          <span className="italic font-light font-display text-transparent bg-clip-text bg-gradient-to-r from-zinc-400 to-white">Contributors</span>
        </motion.h2>
        <p className="text-center text-zinc-500 text-sm sm:text-base mb-10 sm:mb-14">The team that helped build Let&apos;s Collab with Kishan.</p>

        {/* Portrait picker */}
        <div className="flex items-center justify-center gap-5 sm:gap-8 mb-10" role="tablist" aria-label="Contributors">
          {CONTRIBUTORS.map((person, i) => {
            const selected = i === active
            return (
              <button
                key={person.name}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={person.name}
                onClick={() => setActive(i)}
                className={`relative rounded-full overflow-hidden border transition-all duration-500 ${
                  selected
                    ? 'w-20 h-20 sm:w-24 sm:h-24 border-[var(--accent)] shadow-[0_0_30px_-5px_var(--accent)]'
                    : 'w-14 h-14 sm:w-16 sm:h-16 border-[var(--border)] opacity-60 hover:opacity-100'
                }`}
              >
                <img src={person.photo} alt="" className={`w-full h-full object-cover transition-all duration-500 ${selected ? 'grayscale-0' : 'grayscale'}`} />
              </button>
            )
          })}
        </div>

        {/* Selected contributor */}
        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.article
              key={current.name}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="rounded-3xl bg-[var(--elevated)] border border-[var(--border)]/60 p-6 sm:p-8 flex flex-col sm:flex-row gap-6 items-center sm:items-start"
            >
              <img src={current.photo} alt={current.name} className="hidden sm:block w-32 h-32 rounded-2xl object-cover grayscale shrink-0" />
              <div className="text-center sm:text-left min-w-0">
                <h3 className="text-2xl font-black text-[var(--text-primary)]">{current.name}</h3>
                <p className="text-[var(--accent)] font-bold tracking-widest text-[11px] uppercase mt-1 mb-4">Contributor · {current.role}</p>
                <div className="space-y-3 text-sm text-zinc-400 leading-relaxed">
                  {/* On phones the first paragraph is enough; the portrait row above already shows the photo */}
                  {current.bio.map((paragraph, i) => <p key={paragraph.slice(0, 24)} className={i > 0 ? 'hidden sm:block' : undefined}>{paragraph}</p>)}
                </div>
                <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-5">
                  {current.skills.map(skill => (
                    <span key={skill} className="px-3 py-1 rounded-full border border-[var(--border)] text-[11px] font-semibold text-zinc-300">{skill}</span>
                  ))}
                </div>
              </div>
            </motion.article>
          </AnimatePresence>

          <div className="flex justify-center gap-3 mt-6">
            <button type="button" onClick={() => step(-1)} aria-label="Previous contributor" className="w-10 h-10 rounded-full border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-black transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button type="button" onClick={() => step(1)} aria-label="Next contributor" className="w-10 h-10 rounded-full border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-black transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
