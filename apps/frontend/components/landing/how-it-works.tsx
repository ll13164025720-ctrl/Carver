type Step = {
  title: string
  description: string
}

const STEPS: Step[] = [
  {
    title: "Enter your website URL",
    description: "Paste the address of your current site. No account needed.",
  },
  {
    title: "Let AI redesign your website",
    description: "We read your content and build a fresh, modern design.",
  },
  {
    title: "Preview and customize the result",
    description: "Review the new site and tell us what to change.",
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
        <h2
          id="how-it-works-heading"
          className="cv-heading max-w-md text-3xl text-balance sm:text-5xl"
        >
          How It Works
        </h2>

        <ol className="mt-14 grid gap-x-10 gap-y-12 sm:mt-20 md:grid-cols-3">
          {STEPS.map(({ title, description }, index) => (
            <li key={title} className="border-t border-forest/25 pt-6">
              <span
                aria-hidden
                className="text-sm font-medium tracking-[0.12em] text-[#8a6a2c]"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="cv-heading mt-6 text-xl sm:text-2xl">{title}</h3>
              <p className="mt-3 max-w-xs text-base leading-7 text-forest/75">
                {description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
