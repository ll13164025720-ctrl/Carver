"use client"

import { createContext, useContext } from "react"

export interface RendererContextValue {
  /** Vertical padding classes for the design's typography scale. */
  sectionPadding: string
  /** True if a visible section with this id exists, so links to it can be shown. */
  hasSection: (sectionId: string) => boolean
  /** Scrolls the rendered website (not the surrounding page) to a section. */
  navigateTo: (sectionId: string) => void
}

const RendererContext = createContext<RendererContextValue | null>(null)

export const RendererProvider = RendererContext.Provider

export function useRenderer(): RendererContextValue {
  const value = useContext(RendererContext)
  if (!value) {
    throw new Error("Website section components must be rendered inside <WebsiteRenderer>.")
  }
  return value
}
