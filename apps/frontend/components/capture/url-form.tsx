"use client"

import { useId, useState, type FormEvent } from "react"
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MAX_INSTRUCTION_LENGTH } from "@/lib/redesign-draft"
import { cn } from "@/lib/utils"
import { validateWebsiteUrl } from "@/lib/validate-url"

export type ValidUrlSubmission = {
  /** Normalised absolute URL, e.g. "https://example.com/" */
  url: string
  hostname: string
  /** The optional design direction, trimmed. "" when the field was left empty. */
  instruction: string
}

type UrlFormProps = {
  /**
   * Called with the validated URL after a successful submit. Use this from a
   * client component to start navigation or an API call, for example:
   *   onValidSubmit={({ url }) => router.push(`/new?url=${encodeURIComponent(url)}`)}
   * While the returned promise is pending, the form shows a loading state.
   */
  onValidSubmit?: (submission: ValidUrlSubmission) => void | Promise<void>
  submitLabel?: string
  className?: string
  /** Fills the website address field, e.g. with what the user typed before a failed attempt. */
  initialUrl?: string
  /** Fills the design direction field. */
  initialInstruction?: string
}

export function UrlForm({
  onValidSubmit,
  submitLabel = "Revive My Website",
  className,
  initialUrl = "",
  initialInstruction = "",
}: UrlFormProps) {
  const inputId = useId()
  const messageId = `${inputId}-message`
  const instructionId = `${inputId}-instruction`
  const instructionHintId = `${inputId}-instruction-hint`

  const [value, setValue] = useState(initialUrl)
  const [instruction, setInstruction] = useState(initialInstruction)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<ValidUrlSubmission | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    const result = validateWebsiteUrl(value)
    if (!result.ok) {
      setAccepted(null)
      setError(result.error)
      return
    }

    setError(null)
    const submission = {
      url: result.url,
      hostname: result.hostname,
      instruction: instruction.trim(),
    }

    if (!onValidSubmit) {
      // No handler yet: confirm the URL is valid. Navigation to the redesign
      // flow is added later by passing `onValidSubmit`.
      setAccepted(submission)
      return
    }

    setAccepted(null)
    setIsSubmitting(true)
    try {
      await onValidSubmit(submission)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={cn("w-full", className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Website URL
        </label>
        <Input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="yourbusiness.com"
          value={value}
          disabled={isSubmitting}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || accepted ? messageId : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
            setAccepted(null)
          }}
          className="cv-input h-14 sm:flex-1"
        />
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          className="cv-btn cv-btn-primary h-14 px-7"
        >
          {isSubmitting ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : null}
          {submitLabel}
          {isSubmitting ? null : <ArrowRight aria-hidden data-icon="inline-end" />}
        </Button>
      </div>

      <div className="mt-5 text-left">
        <label
          htmlFor={instructionId}
          className="mb-2 flex items-baseline justify-between gap-3 text-sm font-medium text-cream"
        >
          <span>How would you like to redesign this website?</span>
          <span className="text-xs font-normal text-cream/65">Optional</span>
        </label>
        <textarea
          id={instructionId}
          name="instruction"
          rows={3}
          maxLength={MAX_INSTRUCTION_LENGTH}
          autoComplete="off"
          placeholder="Create a clean, modern café website with warm colors and a clear menu section."
          value={instruction}
          disabled={isSubmitting}
          aria-describedby={instructionHintId}
          onChange={(event) => setInstruction(event.target.value)}
          // .cv-input is sized for one line: let this field grow with its text.
          className="cv-input block h-auto min-h-24 w-full resize-y py-3 leading-6"
        />
        <p id={instructionHintId} className="mt-2 text-xs text-cream/65">
          Describe the style, colors or sections you want. Leave it empty and we&apos;ll
          choose a design that suits your business.
          {instruction.length > MAX_INSTRUCTION_LENGTH * 0.8
            ? ` ${instruction.length} / ${MAX_INSTRUCTION_LENGTH} characters.`
            : ""}
        </p>
      </div>

      <div id={messageId} className="mt-4 min-h-6 text-left text-sm">
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-(--cv-error)">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
        {accepted ? (
          <p role="status" className="flex items-start gap-2 text-cream/80">
            <CircleCheck
              className="mt-0.5 size-4 shrink-0 text-gold"
              aria-hidden
            />
            Got it: {accepted.hostname} is ready to be revived. The redesign
            step is coming soon.
          </p>
        ) : null}
      </div>
    </form>
  )
}
