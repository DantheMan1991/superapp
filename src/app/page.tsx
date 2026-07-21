import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight, FileCheck2, Landmark, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";

const PILLARS = [
  {
    icon: Landmark,
    title: "Books that stay clean",
    body: "Every transaction categorized, invoices out the door, and unpaid bills chased automatically — so your books are always current and ready to close.",
  },
  {
    icon: FileCheck2,
    title: "Contracts, done right",
    body: "Generate contracts and change orders from proven templates, with every key date tracked so nothing slips through.",
  },
  {
    icon: Megaphone,
    title: "A pipeline that never goes quiet",
    body: "Content, review requests, and lead follow-up handled automatically — so the next job is already lined up.",
  },
];

export default async function LandingPage() {
  const { userId } = await auth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
              Y
            </div>
            <div className="leading-tight">
              <span className="font-semibold tracking-tight">Yosher</span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                Your business, built right.
              </span>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            {userId ? (
              <Button asChild>
                <Link href="/dashboard">
                  Open dashboard <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/sign-up">Get started</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-6 py-24 text-center">
          <p className="mx-auto mb-4 w-fit rounded-full border bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            The outsourced business office
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Grow without building an office.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Custom software handles the administrative volume — books,
            invoicing, contracts, follow-up. When judgment matters, a real
            professional reviews and signs off. You stay focused on the work
            only you can do.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href={userId ? "/dashboard" : "/sign-up"}>
                {userId ? "Open dashboard" : "Get started"}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="border-t bg-muted/40">
          <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-16 md:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.title}>
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <p.icon className="size-5" />
                </div>
                <h3 className="font-medium">{p.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              Software does the volume. You keep the judgment.
            </h2>
            {/* Stage-accurate wording per the brand doc: describes the
                professional-review layer as the direction being built toward.
                Do not claim live accountant/attorney review until those
                professionals are under contract. */}
            <p className="mt-4 text-muted-foreground">
              Yosher automates the administrative work that eats your evenings
              — but it never pretends to replace real expertise. As your
              business grows, Yosher brings in licensed professionals to
              review and sign off on what matters: an accountant to close your
              books, an attorney for the contracts that carry risk.
              You&apos;re never trusting a machine with the decisions that
              count.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">Yosher</span> — Your
            business, built right.
          </span>
          <span>© {new Date().getFullYear()} Yosher</span>
        </div>
      </footer>
    </div>
  );
}
