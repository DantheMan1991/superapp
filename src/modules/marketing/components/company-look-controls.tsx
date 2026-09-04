"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeCompanyLookAction, startCompanyLookAction } from "../actions";

/** A company steps out from under the business look … */
export function StartCompanyLookButton({
  entityId,
  name,
}: {
  entityId: string;
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
          const result = await startCompanyLookAction({ entityId });
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

/** … and steps back under it. A `confirm()`, as the settings pages do. */
export function RemoveCompanyLookButton({
  entityId,
  name,
}: {
  entityId: string;
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
            `Use your brand for ${name}? Its own name, tagline, colors and logo are removed and its invoices carry your brand again.`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const result = await removeCompanyLookAction({ entityId });
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
