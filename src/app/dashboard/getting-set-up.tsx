import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { withTenant } from "@/db";
import { collectSetup } from "@/lib/setup-sources/resolve";
import { Panel } from "@/components/app/panel";
import { SectionRow } from "@/components/app/section-row";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Getting set up — what each switched-on tool still needs before it can do its
 * job, on the Overview, for owners.
 *
 * Everything here is DERIVED (ADR 0033). A line goes away when the thing it
 * asks for exists; there is nothing to tick and nothing to dismiss, so the card
 * cannot nag about a thing already there and cannot be cleared by anything but
 * doing it. When nothing is left the card is not rendered at all — which is
 * why a source that could not be asked is stated in its place rather than
 * swallowed: an absent card must mean "set up", never "we could not tell".
 *
 * Owners only. Every step is an owner's act (a register, a kind of stock, an
 * animal, a parcel, a channel), so staff would be shown a list of things they
 * cannot do. The role decision is made HERE, once; the sources know nothing
 * about roles.
 *
 * Each row carries two links and is not itself a link: the guide for the
 * screen it points at, and the screen. The guide link is built from a slug the
 * source declares, because this page is not traced to read `docs/help` at
 * request time (next.config.ts) and must not go looking.
 */
export async function GettingSetUp({
  tenantId,
  role,
}: {
  tenantId: string;
  role: "owner" | "staff" | "expert";
}) {
  if (role !== "owner") return null;

  const result = await withTenant(
    tenantId,
    (tx) => collectSetup(tx, { tenantId }),
    { role },
  );
  if (result.steps.length === 0 && result.complete) return null;

  return (
    <SectionRow
      title="Getting set up"
      description="What each tool needs before it can do its job. A line goes away on its own once the thing is there."
    >
      <div className="space-y-3">
        {result.failed.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
            <div className="text-sm">
              <p className="font-medium">This list may be short.</p>
              <p className="text-muted-foreground">
                {result.failed.map((f) => f.label).join(" and ")} could not be
                checked just now. Reload in a moment.
              </p>
            </div>
          </div>
        )}

        {result.steps.length > 0 && (
          <Panel>
            <ul className="divide-y divide-divider">
              {result.steps.map((step) => (
                <li
                  key={step.key}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-subtle-foreground">{step.section}</p>
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-sm text-muted-foreground">{step.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {step.guide && (
                      <Link
                        href={`/dashboard/guides/${step.guide}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                      >
                        Guide
                      </Link>
                    )}
                    <Link
                      href={step.href}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      {step.cta}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* The card says WHAT is missing; the interview says what to do about
            it for THIS business, and in what order (ADR 0040). */}
        <p className="text-sm text-muted-foreground">
          Not sure where to start?{" "}
          <Link
            href="/dashboard/setup"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Walk through it with us
          </Link>{" "}
          and get a plan for your business.
        </p>
      </div>
    </SectionRow>
  );
}
