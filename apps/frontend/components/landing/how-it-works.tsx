import type { LucideIcon } from "lucide-react"
import { Eye, Globe, Sparkles } from "lucide-react"

type Step = {
  title: string
  description: string
  icon: LucideIcon
}

const STEPS: Step[] = [
  {
    title: "Enter your website URL",
    description: "Paste the address of your current site. No account needed.",
    icon: Globe,
  },
  {
    title: "Let AI redesign your website",
    description: "We read your content and build a fresh, modern design.",
    icon: Sparkles,
  },
  {
    title: "Preview and customize the result",
    description: "Review the new site and tell us what to change.",
    icon: Eye,
  },
]

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="scroll-mt-4 bg-white text-black"
    >
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <h2
          id="how-it-works-heading"
          className="text-center text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          How It Works
        </h2>

        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ title, description, icon: Icon }, index) => (
            <li
              key={title}
              className="flex flex-col gap-4 rounded-2xl border border-black/10 p-6"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-full bg-black text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <Icon className="size-6 text-black/60" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-base leading-7 text-black/60">{description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
