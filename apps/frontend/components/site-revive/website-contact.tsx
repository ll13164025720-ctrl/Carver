"use client"

import type { ReactNode } from "react"
import { Clock, Mail, MapPin, Phone } from "lucide-react"

import {
  HEADING_FONT,
  WebsiteSection,
} from "@/components/site-revive/website-section"
import { mailHref, telHref } from "@/lib/website-render"
import { cn } from "@/lib/utils"
import type { ContactContent } from "@/types/website"

type WebsiteContactProps = {
  sectionId: string
  content: ContactContent
}

const LINK_CLASS =
  "rounded underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sr-accent)"

function ContactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4">
      <span
        aria-hidden
        className="row-span-2 flex size-11 shrink-0 items-center justify-center self-start rounded-full bg-(--sr-on-secondary)/12"
      >
        {icon}
      </span>
      <dt className="text-sm font-medium opacity-70">{label}</dt>
      <dd className="mt-1 text-lg leading-7 break-words">{children}</dd>
    </div>
  )
}

export function WebsiteContact({ sectionId, content }: WebsiteContactProps) {
  const { address } = content
  const tel = telHref(content.phone)
  const mail = mailHref(content.email)

  return (
    <WebsiteSection
      sectionId={sectionId}
      label={content.heading}
      className="bg-(--sr-secondary) text-(--sr-on-secondary)"
    >
      <div className="mb-10 max-w-2xl @2xl:mb-14">
        <h2
          className={cn(
            "text-3xl font-semibold tracking-tight text-balance @2xl:text-4xl",
            HEADING_FONT
          )}
        >
          {content.heading}
        </h2>
        {content.intro ? (
          <p className="mt-4 text-lg leading-8 opacity-80">{content.intro}</p>
        ) : null}
      </div>

      <div className="grid gap-10 @4xl:grid-cols-2 @4xl:gap-16">
        <dl className="space-y-6">
          <ContactRow icon={<MapPin className="size-5" />} label="Address">
            <address className="not-italic">
              {address.street}
              <br />
              {address.city}, {address.region} {address.postalCode}
              <br />
              {address.country}
            </address>
          </ContactRow>
          <ContactRow icon={<Phone className="size-5" />} label="Phone">
            {tel ? (
              <a href={tel} className={LINK_CLASS}>
                {content.phone}
              </a>
            ) : (
              content.phone
            )}
          </ContactRow>
          <ContactRow icon={<Mail className="size-5" />} label="Email">
            {mail ? (
              <a href={mail} className={LINK_CLASS}>
                {content.email}
              </a>
            ) : (
              content.email
            )}
          </ContactRow>
        </dl>

        {content.openingHours.length > 0 ? (
          <div className="rounded-3xl bg-(--sr-on-secondary)/10 p-6 @2xl:p-8">
            <h3 className="flex items-center gap-3 text-xl font-semibold">
              <Clock className="size-5" aria-hidden />
              <span className={HEADING_FONT}>Opening hours</span>
            </h3>
            <dl className="mt-6 divide-y divide-(--sr-on-secondary)/15">
              {content.openingHours.map((entry) => (
                <div
                  key={entry.days}
                  className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4 first:pt-0 last:pb-0"
                >
                  <dt className="font-medium">{entry.days}</dt>
                  <dd className="opacity-80">{entry.hours}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </WebsiteSection>
  )
}
