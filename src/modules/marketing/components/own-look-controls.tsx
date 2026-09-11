"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ownerFields, type KitOwner } from "@/lib/brand/owner";
import { removeCompanyLookAction, startCompanyLookAction } from "../actions";

/**
 * Stepping out from under the business look, and stepping back under it.
 *
 * One pair for both kinds of owner since ADR 0045 — a company AND a website
 * may each have a look of its own, and the two controls differ only in the
 * noun and in what the warning says is at stake. The actions were already
 * generalised; keeping two near-identical pairs of buttons is how the wording
 * drifts apart.
 *
 * The business itself never gets these: there is always a business look, and
 * `deleteKit`'s type refuses to take it away.
 */

/** What the warning has to name, because it is what visibly changes. */
const CARRIES: Record<"company" | "site", string> = {
  company: "its invoices carry your brand again",
  site: "its pages carry your brand again",
};

function ownerNoun(owner: KitOwner): "company" | "site" {
  return owner.kind === "site" ? "site" : "company";
}

export function StartOwnLookButton({
  owner,
  name,
}: {
  owner: Exclude<KitOwner, { kind: "business" }>;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await startCompanyLookAction(ownerFields(owner));
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`${name} now has its own look. Fill in what should differ.`);
          router.refresh();
        })
      }
    >
      {pending ? "One moment…" : "Give it its own look"}
    </Button>
  );
}

/** A `confirm()`, as the settings pages do: this deletes a logo. */
export function RemoveOwnLookButton({
  owner,
  name,
}: {
  owner: Exclude<KitOwner, { kind: "business" }>;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (
          !window.confirm(
            `Use your brand for ${name}? Its own name, tagline, colors and logo are removed and ${CARRIES[ownerNoun(owner)]}.`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await removeCompanyLookAction(ownerFields(owner));
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`${name} uses your brand.`);
          router.refresh();
        });
      }}
    >
      {pending ? "One moment…" : "Use your brand instead"}
    </Button>
  );
}
