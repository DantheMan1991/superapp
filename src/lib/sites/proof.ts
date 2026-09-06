/**
 * Social proof and questions — pure (Marketing slice 16).
 *
 * A testimonial and an answered question are the two things a visitor
 * trusts more than anything the business says about itself, and the two
 * things a template cannot supply: both would be invented. So both kinds
 * of section start EMPTY in a template and SHOW ONLY ONCE FILLED: a
 * quote needs words and a name, a question needs an answer, and a section
 * with nothing complete draws nothing on a public page. The editor and the
 * draft preview say so instead.
 */
export interface Quote {
  quote: string;
  name: string;
  /** A word or two about who: "Buys beef by the half", "Mount Vernon". */
  detail: string;
}

export interface Question {
  question: string;
  answer: string;
}

/** The quotes a visitor sees: words and a name, both present. */
export function completeQuotes<T extends Quote>(items: T[]): T[] {
  return items.filter((q) => q.quote.trim() !== "" && q.name.trim() !== "");
}

/** The questions a visitor sees: asked and answered. A starter question with no answer waits in the editor. */
export function completeQuestions<T extends Question>(items: T[]): T[] {
  return items.filter((q) => q.question.trim() !== "" && q.answer.trim() !== "");
}

/**
 * The FAQ as search engines read it (schema.org FAQPage), from the
 * answered questions only. Empty when there are none, and the caller
 * writes nothing.
 */
export function faqJsonLd(items: Question[]): Record<string, unknown> | null {
  const complete = completeQuestions(items);
  if (complete.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: complete.map((q) => ({
      "@type": "Question",
      name: q.question.trim(),
      acceptedAnswer: { "@type": "Answer", text: q.answer.trim() },
    })),
  };
}

/** The header's logo, by the owner's choice: its height and the widest it may grow. */
export const LOGO_SIZES = ["small", "medium", "large"] as const;
export type LogoSize = (typeof LOGO_SIZES)[number];
export const LOGO_SIZE_LABELS: Record<LogoSize, string> = { small: "Small", medium: "Medium", large: "Large" };

export function logoSizeClass(size: LogoSize): string {
  switch (size) {
    case "small":
      return "h-8 max-w-[160px]";
    case "medium":
      return "h-10 max-w-[200px]";
    case "large":
      return "h-12 max-w-[240px] sm:h-16 sm:max-w-[320px]";
  }
}
