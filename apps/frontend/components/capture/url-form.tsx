"use client"

import { useId, useState, type FormEvent } from "react"
import { ArrowRight, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { validateWebsiteUrl } from "@/lib/validate-url"

export type ValidUrlSubmission = {
  /** Normalised absolute URL, e.g. "https://example.com/" */
  url: string
  hostname: string
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
}

export function UrlForm({
  onValidSubmit,
  submitLabel = "Revive My Website",
  className,
}: UrlFormProps) {
  const inputId = useId()
  const messageId = `${inputId}-message`

  const [value, setValue] = useState("")
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
    const submission = { url: result.url, hostname: result.hostname }

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
