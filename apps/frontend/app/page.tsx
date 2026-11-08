import type { Metadata } from "next"

import { HowItWorks } from "@/components/landing/how-it-works"
import { SiteHeader } from "@/components/landing/site-header"
import { StartRedesignForm } from "@/components/site-revive/start-redesign-form"

export const metadata: Metadata = {
  title: "CARVER | Give Your Website a New Life",
  description:
    "Transform your outdated business website into a modern experience with AI.",
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-forest text-cream">
        <SiteHeader />

        <main>
          <section
            aria-labelledby="hero-heading"
            className="mx-auto flex max-w-4xl flex-col items-center px-6 pt-20 pb-28 text-center sm:pt-28 sm:pb-40 lg:pt-36 lg:pb-48"
          >
            <h1
              id="hero-heading"
              className="cv-display text-[2.75rem] text-balance sm:text-6xl lg:text-7xl"
            >
              Give Your Website a New&nbsp;Life
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-8 text-pretty text-cream/75 sm:mt-8 sm:text-xl sm:leading-9">
              Transform your outdated business website into a modern experience
              with AI.
            </p>

            <StartRedesignForm className="mt-12 max-w-2xl sm:mt-14" />
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
