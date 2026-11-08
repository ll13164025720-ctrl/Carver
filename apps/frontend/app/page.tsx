import type { Metadata } from "next"
import { Pencil, ShieldCheck, Sparkles } from "lucide-react"

import { HowItWorks } from "@/components/landing/how-it-works"
import { SiteHeader } from "@/components/landing/site-header"
import { StartRedesignForm } from "@/components/site-revive/start-redesign-form"

export const metadata: Metadata = {
  title: "CARVER | Give Your Website a New Life",
  description:
    "Transform your outdated business website into a modern experience with AI.",
}

const HIGHLIGHTS = [
  { icon: Sparkles, label: "A fresh design in minutes" },
  { icon: Pencil, label: "Edit by describing changes" },
  { icon: ShieldCheck, label: "Your real content, never invented" },
] as const

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="cv-hero text-cream">
        <SiteHeader />

        <main>
          <section
            aria-labelledby="hero-heading"
            className="mx-auto flex max-w-4xl flex-col items-center px-6 pt-16 pb-28 text-center sm:pt-24 sm:pb-40 lg:pt-32 lg:pb-48"
          >
            <p className="cv-pill cv-rise">
              <Sparkles className="size-3.5 text-gold" aria-hidden />
              AI website redesign for small businesses
            </p>
            <h1
              id="hero-heading"
              className="cv-display cv-rise mt-8 text-[2.75rem] text-balance sm:text-6xl lg:text-7xl"
              style={{ "--cv-delay": "80ms" } as React.CSSProperties}
            >
              Give Your Website a{" "}
              <span className="cv-gradient-text whitespace-nowrap">New&nbsp;Life</span>
            </h1>
            <p
              className="cv-rise mt-7 max-w-lg text-lg leading-8 text-pretty text-cream/75 sm:mt-8 sm:text-xl sm:leading-9"
              style={{ "--cv-delay": "160ms" } as React.CSSProperties}
            >
              Transform your outdated business website into a modern experience
              with AI.
            </p>

            <StartRedesignForm className="cv-rise mt-12 max-w-2xl sm:mt-14" />

            <ul
              className="cv-rise mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-cream/70"
              style={{ "--cv-delay": "320ms" } as React.CSSProperties}
            >
              {HIGHLIGHTS.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon className="size-4 text-gold" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>

      <HowItWorks />

      <footer className="bg-forest-deep py-10 text-center text-sm tracking-[0.14em] text-cream/65 uppercase">
        CARVER
      </footer>
    </div>
  )
}
