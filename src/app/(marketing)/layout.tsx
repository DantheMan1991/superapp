import { auth } from "@clerk/nextjs/server";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/**
 * Chrome for every public page — home, about, contact, health check.
 *
 * Before this existed each public page hand-rolled its own header and footer,
 * which is why they had drifted apart. Adding a page now means writing the page
 * and nothing else.
 *
 * `auth()` here makes the whole group dynamic, which is correct: the header's
 * call to action differs for a signed-in visitor, and serving a cached "Get
 * started" to someone with a session is the kind of small wrongness that reads
 * as a broken site.
 */
export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader signedIn={Boolean(userId)} />
      <main id="content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
