import { Link2, Palette, Rocket, Wand2, type LucideIcon } from "lucide-react"

type Step = {
  title: string
  description: string
  icon: LucideIcon
}

const STEPS: Step[] = [
  {
    title: "Enter your website URL",
    description: "Paste the address of your current site. No account needed.",
    icon: Link2,
  },
  {
    title: "Let AI redesign your website",
    description: "We read your content and build a fresh, modern design.",
    icon: Wand2,
  },
  {
    title: "Preview and customize the result",
    description: "Review the new site and tell us what to change.",
    icon: Palette,
  },
  {
    title: "Publish it yourself",
    description:
      "Put it online at a shareable link in one click, or download the file and host it anywhere.",
    icon: Rocket,
  },
]

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="scroll-mt-4 bg-cream text-forest"
    >
      <div className="mx-auto max-w-6xl px-6 py-24 sm:px-8 sm:py-32">
        <p className="text-xs font-medium tracking-[0.12em] text-[#8a6a2c] uppercase">
          From old to new
        </p>
        <h2
          id="how-it-works-heading"
          className="cv-heading mt-3 max-w-md text-3xl text-balance sm:text-5xl"
        >
          How It Works
        </h2>

        <ol className="mt-14 grid gap-6 sm:mt-20 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ title, description, icon: Icon }, index) => (
            <li key={title} className="cv-card p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <span
                  aria-hidden
                  className="flex size-11 items-center justify-center rounded-xl bg-forest text-gold"
                >
                  <Icon className="size-5" />
                </span>
                <span
                  aria-hidden
                  className="text-sm font-medium tracking-[0.12em] text-[#8a6a2c]"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="cv-heading mt-8 text-xl sm:text-2xl">{title}</h3>
              <p className="mt-3 text-base leading-7 text-forest/75">
                {description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
