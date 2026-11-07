"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { isSafeImageSrc } from "@/lib/website-render"

type SafeImageProps = {
  src: string
  /** Required. Also shown as text if the image cannot be displayed. */
  alt: string
  width?: number
  height?: number
  className?: string
  /** Classes for the stand-in box shown when the image is blocked or fails to load. */
  fallbackClassName?: string
  priority?: boolean
}

/**
 * Image for untrusted URLs from a design. Only http(s) URLs and site-relative
 * paths are loaded. If the URL is rejected or the image fails to load, a box
 * with the alt text is shown instead.
 *
 * A plain <img> is used on purpose: designs can point at any host, and
 * next/image would need every host listed in next.config.ts.
 */
export function SafeImage({
  src,
  alt,
  width,
  height,
  className,
  fallbackClassName,
  priority = false,
}: SafeImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!isSafeImageSrc(src) || failedSrc === src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          "flex items-center justify-center overflow-hidden bg-(--sr-border) p-4 text-center text-xs text-(--sr-muted)",
          className,
          fallbackClassName
        )}
      >
        {alt}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see component comment
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={className}
    />
  )
}
