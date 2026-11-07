"use client"

import { useId, useState, type FormEvent } from "react"
import { CircleAlert, CircleCheck, LoaderCircle, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** What the parent reports back after trying an instruction. */
export type PromptEditFeedback = { ok: boolean; message: string }

type PromptEditorProps = {
  /**
   * Called with the trimmed instruction. Resolve with `ok: false` for an
   * instruction that could not be applied (the message is shown as an error).
   * A rejected promise is also shown as an error.
   */
  onApply: (instruction: string) => Promise<PromptEditFeedback>
  /** Clickable example instructions that fill the input. */
  examples?: readonly string[]
  placeholder?: string
  className?: string
}

export function PromptEditor({
  onApply,
  examples = [],
  placeholder = "Describe a change, e.g. Change the primary color to dark green",
  className,
}: PromptEditorProps) {
  const inputId = useId()
  const messageId = `${inputId}-message`

  const [value, setValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [feedback, setFeedback] = useState<PromptEditFeedback | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isLoading) return

    const instruction = value.trim()
    if (!instruction) {
      setFeedback({ ok: false, message: "Type an instruction first." })
      return
    }

    setFeedback(null)
    setIsLoading(true)
    try {
      const result = await onApply(instruction)
      setFeedback(result)
      // Keep the text after a failure so it can be corrected.
      if (result.ok) setValue("")
    } catch {
      setFeedback({
        ok: false,
        message: "Something went wrong while applying that change. Please try again.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  function chooseExample(example: string) {
    if (isLoading) return
    setValue(example)
    setFeedback(null)
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={isLoading}
      className={cn("w-full", className)}
    >
      <label
        htmlFor={inputId}
        className="mb-3 flex items-center gap-2 text-sm font-medium text-cream"
      >
        <Sparkles className="size-4 text-gold" aria-hidden />
        Edit the redesign with a prompt
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id={inputId}
          name="instruction"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          // readOnly instead of disabled, so the field keeps keyboard focus.
          readOnly={isLoading}
          aria-invalid={feedback && !feedback.ok ? true : undefined}
          aria-describedby={feedback ? messageId : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setFeedback(null)
          }}
          className="cv-input sm:flex-1"
        />
        <Button
          type="submit"
          size="lg"
          disabled={isLoading}
          className="cv-btn cv-btn-primary"
        >
          {isLoading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {isLoading ? "Applying..." : "Apply Changes"}
        </Button>
      </div>

      <div id={messageId} className="mt-3 min-h-6 text-sm">
        {feedback ? (
          feedback.ok ? (
            <p role="status" className="flex items-start gap-2 text-cream/85">
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-gold"
                aria-hidden
              />
              {feedback.message}
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-2 text-(--cv-error)">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {feedback.message}
            </p>
          )
        ) : null}
      </div>

      {examples.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-cream/65">Try:</span>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              disabled={isLoading}
              onClick={() => chooseExample(example)}
              className="rounded-md border border-cream/20 px-3 py-1.5 text-xs text-cream/75 transition-colors outline-none hover:border-cream/45 hover:bg-cream/[0.08] hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  )
}
