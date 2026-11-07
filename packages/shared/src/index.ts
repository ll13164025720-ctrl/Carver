export type WebsiteSectionType =
  | "header"
  | "hero"
  | "about"
  | "menu"
  | "contact"
  | "footer";

export interface WebsiteSection {
  id: string;
  type: WebsiteSectionType;
  visible: boolean;
  content: Record<string, unknown>;
}

export interface WebsiteBlueprint {
  siteId: string;
  slug: string;
  businessName: string;

  theme: {
    primaryColor: string;
    secondaryColor: string;
    fontFamily: string;
  };

  sections: WebsiteSection[];
}

export interface CaptureResult {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;

  links: {
    text: string;
    url: string;
  }[];

  images: {
    url: string;
    alt: string;
  }[];
}
