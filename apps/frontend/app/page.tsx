import type { Metadata } from "next"

import { HowItWorks } from "@/components/landing/how-it-works"
import { SiteHeader } from "@/components/landing/site-header"
import { StartRedesignForm } from "@/components/site-revive/start-redesign-form"

export const metadata: Metadata = {
  title: "SiteRevive | Give Your Website a New Life",
  description:
    "Transform your outdated business website into a modern experience with AI.",
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-black text-white">
        <SiteHeader />

        <main>
          <section
            aria-labelledby="hero-heading"
            className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-16 pb-24 text-center sm:pt-24 sm:pb-32"
          >
            <h1
              id="hero-heading"
              className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl"
            >
              Give Your Website a New Life
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-pretty text-white/70 sm:text-xl">
              Transform your outdated business website into a modern experience
              with AI.
            </p>

            <StartRedesignForm className="mt-10" />
          </section>
        </main>
      </div>

      <HowItWorks />

      <footer className="border-t border-black/10 bg-white py-8 text-center text-sm text-black/50">
        SiteRevive
      </footer>
    </div>
  )
}
