import { z } from "zod";

export const WebsiteSectionTypeSchema = z.enum([
  "header",
  "hero",
  "about",
  "menu",
  "contact",
  "footer",
]);

export const WebsiteSectionSchema = z.object({
  id: z.string().min(1).max(80),
  type: WebsiteSectionTypeSchema,
  visible: z.boolean().default(true),
  // Section content is intentionally flexible in the MVP. The renderer will
  // interpret fields based on `type`; never render arbitrary HTML from this data.
  content: z.record(z.string(), z.unknown()),
});

export const WebsiteBlueprintSchema = z.object({
  schemaVersion: z.literal("1.0"),
  siteId: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  businessName: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  theme: z.object({
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    fontFamily: z.string().min(1).max(80),
  }),
  sections: z.array(WebsiteSectionSchema).min(3).max(12),
});

export const GenerateBlueprintRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  businessName: z.string().trim().min(1).max(120),
  businessType: z.string().trim().max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  sourceContent: z.string().max(12000).optional(),
});

export const CaptureSiteRequestSchema = z.object({
  sourceUrl: z.string().trim().url().max(2048),
  businessName: z.string().trim().min(1).max(120).optional(),
});

export const WebsiteCaptureSchema = z.object({
  captureId: z.string().uuid(),
  sourceUrl: z.string().url().max(2048),
  finalUrl: z.string().url().max(2048),
  capturedAt: z.string().min(1).max(40),
  title: z.string().max(300),
  description: z.string().max(1000),
  headings: z
    .array(
      z.object({
        level: z.number().int().min(1).max(6),
        text: z.string().max(500),
      }),
    )
    .max(100),
  text: z.string().max(20000),
  links: z
    .array(
      z.object({
        text: z.string().max(300),
        url: z.string().max(2048),
      }),
    )
    .max(100),
  images: z
    .array(
      z.object({
        src: z.string().url().max(2048),
        alt: z.string().max(500),
      }),
    )
    .max(100),
  screenshots: z.object({
    desktop: z.string().min(1).max(2048),
    mobile: z.string().min(1).max(2048),
  }),
});

const JsonValueSchema = z.unknown().refine((value) => {
  try {
    const encoded = JSON.stringify(value);
    return encoded !== undefined && encoded.length <= 8000;
  } catch {
    return false;
  }
}, "Operation values must be JSON-serializable and no larger than 8 KB");

export const BlueprintEditOperationSchema = z.object({
  type: z.literal("set"),
  sectionId: z.string().min(1).max(80),
  field: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
    .refine(
      (field) =>
        ![
          "id",
          "type",
          "visible",
          "__proto__",
          "prototype",
          "constructor",
          "dangerouslySetInnerHTML",
          "innerHTML",
          "outerHTML",
        ].includes(field) && !/^on[A-Z]/.test(field),
      "This field cannot be edited",
    ),
  value: JsonValueSchema,
});

export const BlueprintEditOperationsSchema = z.object({
  operations: z.array(BlueprintEditOperationSchema).min(1).max(8),
});

export const EditBlueprintRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  baseVersion: z.number().int().min(1).optional(),
  blueprint: WebsiteBlueprintSchema,
  prompt: z.string().trim().min(1).max(1000),
});

export type WebsiteSectionType = z.infer<typeof WebsiteSectionTypeSchema>;
export type WebsiteSection = z.infer<typeof WebsiteSectionSchema>;
export type WebsiteBlueprint = z.infer<typeof WebsiteBlueprintSchema>;
export type GenerateBlueprintRequest = z.infer<
  typeof GenerateBlueprintRequestSchema
>;
export type CaptureSiteRequest = z.infer<typeof CaptureSiteRequestSchema>;
export type WebsiteCapture = z.infer<typeof WebsiteCaptureSchema>;
export type BlueprintEditOperation = z.infer<
  typeof BlueprintEditOperationSchema
>;
export type EditBlueprintRequest = z.infer<typeof EditBlueprintRequestSchema>;
