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
        className="mb-2 flex items-center gap-2 text-sm font-medium text-white"
      >
        <Sparkles className="size-4 text-violet-400" aria-hidden />
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
          className="h-11 rounded-xl border-white/20 bg-white/10 px-4 text-base text-white placeholder:text-white/50 sm:flex-1 dark:bg-white/10"
        />
        <Button
          type="submit"
          size="lg"
          disabled={isLoading}
          className="h-11 rounded-xl bg-violet-600 px-6 text-base font-semibold text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500 focus-visible:border-violet-300 focus-visible:ring-violet-400/50"
        >
          {isLoading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {isLoading ? "Applying..." : "Apply Changes"}
        </Button>
      </div>

      <div id={messageId} className="mt-3 min-h-6 text-sm">
        {feedback ? (
          feedback.ok ? (
            <p role="status" className="flex items-start gap-2 text-white/80">
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-emerald-400"
                aria-hidden
              />
              {feedback.message}
            </p>
          ) : (
            <p role="alert" className="flex items-start gap-2 text-red-400">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {feedback.message}
            </p>
          )
        ) : null}
      </div>

      {examples.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/50">Try:</span>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              disabled={isLoading}
              onClick={() => chooseExample(example)}
              className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  )
}
