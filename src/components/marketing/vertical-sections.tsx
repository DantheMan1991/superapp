import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VerticalLink, VerticalSection } from "@/lib/verticals";
import { cn } from "@/lib/utils";

/**
 * The renderer for every vertical page. One component, every industry
 * (`src/lib/verticals/`) — which is the entire reason a new industry is a data
 * file rather than a site.
 *
 * A server component on purpose: nothing here needs state, so a vertical page
 * ships no JavaScript of its own. The FAQ opens and closes with `<details>`,
 * the same script-free disclosure the tenant sites' phone header uses — it
 * works before hydration and it works with JavaScript off, which matters on a
 * page whose visitors arrive on one bar of signal in a field.
 *
 * BANDS ARE COMPUTED, NOT DECLARED. Sections after the hero alternate plain and
 * muted by index, so the rhythm can't be got wrong in a data file and a section
 * inserted in the middle re-stripes everything below it automatically.
 */

/** Shared shell: the band, the width, the vertical rhythm. */
function Band({
  banded,
  id,
  children,
  className,
}: {
  banded: boolean;
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      // `scroll-mt` clears the sticky header when a hero button jumps here.
      className={cn("border-t scroll-mt-16", banded && "bg-muted/40")}
    >
      <div className={cn("mx-auto w-full max-w-6xl px-6 py-20", className)}>
        {children}
      </div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function Intro({
  eyebrow,
  heading,
  body,
  centered = false,
}: {
  eyebrow: string;
  heading: string;
  body: string | null;
  centered?: boolean;
}) {
  return (
    <div className={cn(centered ? "mx-auto max-w-2xl text-center" : "max-w-2xl")}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {heading}
      </h2>
      {body && <p className="mt-4 text-pretty text-muted-foreground">{body}</p>}
    </div>
  );
}

/** A vertical's own button. An anchor href stays on the page; a path navigates. */
function LinkButton({
  link,
  variant = "default",
  withArrow = false,
}: {
  link: VerticalLink;
  variant?: "default" | "outline" | "ghost";
  withArrow?: boolean;
}) {
  return (
    <Button
      asChild
      size="lg"
      variant={variant}
      className="h-11 w-full px-6 text-base sm:w-auto"
    >
      <Link href={link.href}>
        {link.label}
        {withArrow && <ArrowRight className="size-4" />}
      </Link>
    </Button>
  );
}

export function VerticalSectionView({
  section,
  banded,
}: {
  section: VerticalSection;
  banded: boolean;
}) {
  switch (section.kind) {
    /* ---------------------------------------------------------------- hero */
    case "hero":
      return (
        <section className="relative overflow-hidden">
          {/* Soft brand wash, purely decorative — the same one the front page
              opens with, so a visitor who came in sideways still recognises
              where they are. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent)_0%,transparent_70%)] opacity-70"
          />
          <div className="mx-auto w-full max-w-6xl px-6 pt-20 pb-20 text-center sm:pt-28">
            <p className="mx-auto mb-5 w-fit rounded-full border bg-background/70 px-3.5 py-1.5 text-xs font-medium text-accent-foreground shadow-sm">
              {section.eyebrow}
            </p>
            <h1 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {section.heading}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
              {section.body}
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <LinkButton link={section.primary} withArrow />
              {section.secondary && (
                <LinkButton link={section.secondary} variant="outline" />
              )}
            </div>
            {section.note && (
              <p className="mt-4 text-xs text-muted-foreground">{section.note}</p>
            )}
          </div>
        </section>
      );

    /* ------------------------------------------------------------ problems */
    case "problems":
      return (
        <Band banded={banded}>
          <Intro
            eyebrow={section.eyebrow}
            heading={section.heading}
            body={section.body}
          />
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {section.items.map((item) => (
              <div
                key={item.title}
                className="rounded-xl border bg-card p-6 shadow-sm"
              >
                <h3 className="font-medium text-pretty">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </Band>
      );

    /* -------------------------------------------------------- capabilities */
    case "capabilities":
      return (
        <Band banded={banded} id={section.id}>
          <Intro
            eyebrow={section.eyebrow}
            heading={section.heading}
            body={section.body}
          />
          <div className="mt-12 grid gap-10 sm:grid-cols-2 md:gap-8 lg:grid-cols-4">
            {section.items.map((item) => (
              <div key={item.title}>
                <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <item.icon className="size-5" />
                </div>
                <h3 className="font-medium text-pretty">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </Band>
      );

    /* ----------------------------------------------------------- spotlight */
    case "spotlight":
      return (
        <Band banded={banded}>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <Eyebrow>{section.eyebrow}</Eyebrow>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {section.heading}
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground">
                {section.body}
              </p>
            </div>
            {/* The rule down the left is the run itself. Decorative, so it is
                drawn on the list rather than between items — one element
                instead of n-1, and it can't leave a stub under the last step. */}
            <ol className="relative space-y-8 border-l pl-8">
              {section.points.map((point, i) => (
                <li key={point.title} className="relative">
                  <span
                    aria-hidden
                    className="absolute top-0 -left-[2.3rem] flex size-8 items-center justify-center rounded-full border bg-background text-sm font-semibold tabular-nums shadow-sm"
                  >
                    {i + 1}
                  </span>
                  <h3 className="font-medium text-pretty">{point.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {point.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          {section.footnote && (
            <p className="mt-12 max-w-2xl text-sm text-pretty text-muted-foreground lg:ml-[calc(22rem+4rem)] lg:mt-8">
              {section.footnote}
            </p>
          )}
        </Band>
      );

    /* --------------------------------------------------------------- steps */
    case "steps":
      return (
        <Band banded={banded}>
          <Intro
            eyebrow={section.eyebrow}
            heading={section.heading}
            body={section.body}
          />
          <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
            {section.items.map((item, i) => (
              <li key={item.title}>
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-semibold tabular-nums">
                    {i + 1}
                  </span>
                  <item.icon className="size-5 text-muted-foreground" />
                </div>
                <h3 className="mt-4 font-medium text-pretty">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
        </Band>
      );

    /* ----------------------------------------------------------------- faq */
    case "faq":
      return (
        <Band banded={banded} className="max-w-3xl">
          {/* Centred, unlike the wide sections: this column is narrower than
              the rest of the page, so a left-aligned heading reads as an
              indent against the section above rather than as a new column. */}
          <Intro
            eyebrow={section.eyebrow}
            heading={section.heading}
            body={null}
            centered
          />
          <div className="mt-10 divide-y border-y">
            {section.items.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="text-pretty">{item.question}</span>
                  {/* Rotates to a minus. Drawn rather than iconed so it needs
                      no client component to change state. */}
                  <span
                    aria-hidden
                    className="relative size-4 shrink-0 text-muted-foreground"
                  >
                    <span className="absolute top-1/2 left-0 h-px w-4 -translate-y-1/2 bg-current" />
                    <span className="absolute top-1/2 left-0 h-px w-4 -translate-y-1/2 rotate-90 bg-current transition-transform group-open:rotate-0" />
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-pretty text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </Band>
      );

    /* ----------------------------------------------------------------- cta */
    case "cta":
      return (
        <Band banded={banded} className="max-w-3xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {section.heading}
          </h2>
          <p className="mt-5 text-pretty text-muted-foreground">{section.body}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LinkButton link={section.primary} withArrow />
            {section.secondary && (
              <LinkButton link={section.secondary} variant="outline" />
            )}
          </div>
        </Band>
      );
  }
}
