import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VerticalSectionView } from "@/components/marketing/vertical-sections";
import { getVertical, listVerticals } from "@/lib/verticals";
import { faqJsonLd } from "@/lib/sites/proof";
import { jsonLdText } from "@/lib/sites/seo";
import { SITE } from "@/lib/site";

/**
 * One industry's page: `/for/homestead`.
 *
 * PUBLIC, no auth, nothing tenant-scoped — every word comes from
 * `src/lib/verticals/`, which is static data compiled into the bundle. The
 * page is a `switch` over typed sections and nothing else, so a new industry
 * never touches this file.
 *
 * On its own domain later: this route is the rewrite target. `classifyHost`
 * would learn the extra hostname and `src/proxy.ts` would map
 * `yosherhomestead.com/*` → `/for/homestead/*`. Nothing here reads the host,
 * which is what keeps that a routing change rather than a rewrite.
 */

type Params = Promise<{ vertical: string }>;

/**
 * The valid slugs, from the registry.
 *
 * These do NOT render statically today — the `(marketing)` layout calls
 * `auth()` to decide the header's call to action, which makes the whole group
 * dynamic. It is here because it is the honest enumeration of what this route
 * serves, and because the day that layout stops needing a session these pages
 * become static with no further change.
 */
export function generateStaticParams() {
  return listVerticals().map((v) => ({ vertical: v.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { vertical } = await params;
  const found = getVertical(vertical);
  if (!found) return {};
  const url = `${SITE.url}/for/${found.slug}`;
  return {
    // ABSOLUTE, deliberately. The root layout's template is `%s · Yosher`, and
    // a sub-brand already carries the name — "Yosher Homestead … · Yosher" says
    // it twice and spends nine characters of a tab doing it.
    title: { absolute: found.seo.title },
    description: found.seo.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title: found.seo.title,
      description: found.seo.description,
      siteName: SITE.name,
    },
  };
}

export default async function VerticalPage({ params }: { params: Params }) {
  const { vertical } = await params;
  const found = getVertical(vertical);
  if (!found) notFound();

  // The answered questions as search engines read them, through the same one
  // implementation the tenant sites use (`src/lib/sites/proof.ts`). A page
  // with no FAQ section writes no script.
  const faq = found.sections.find((s) => s.kind === "faq");
  const faqLd = faq ? faqJsonLd([...faq.items]) : null;

  return (
    <>
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdText(faqLd) }}
        />
      )}
      {found.sections.map((section, i) => (
        <VerticalSectionView
          key={`${section.kind}-${i}`}
          section={section}
          // The hero is index 0 and bands itself; everything after alternates,
          // starting muted.
          banded={i % 2 === 1}
        />
      ))}
    </>
  );
}
