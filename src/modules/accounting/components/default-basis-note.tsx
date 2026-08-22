"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setDefaultBasis } from "../actions";

const LABEL = { accrual: "Accrual", cash: "Cash" } as const;

/**
 * "Reports open on Accrual. Make Cash the default?"
 *
 * **SHOWN AT THE MOMENT SOMEBODY DEMONSTRATES THE PREFERENCE**, which is the
 * only moment they will ever think about it. A default basis is set once in the
 * life of a business and then never again, so a settings screen is where it goes
 * to be undiscovered — whereas a person who has just switched a report to Cash
 * has said exactly what they want, out loud, in the only vocabulary that
 * matters.
 *
 * It renders only when the report's basis differs from the saved default, so it
 * is absent for everybody who is already on the right one, and it disappears the
 * moment it is used.
 *
 * Owner-only, because it changes the figure every other person in the business
 * sees first — and the two bases give different, both-correct profits.
 */
export function DefaultBasisNote({
  basis,
  defaultBasis,
  isOwner,
}: {
  basis: "accrual" | "cash";
  defaultBasis: "accrual" | "cash";
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (basis === defaultBasis) return null;

  function save() {
    startTransition(async () => {
      const result = await setDefaultBasis({ basis });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Reports will open on ${LABEL[basis].toLowerCase()} basis`);
      router.refresh();
    });
  }

  return (
    <p className="text-xs text-muted-foreground">
      Reports open on {LABEL[defaultBasis].toLowerCase()} basis.{" "}
      {isOwner ? (
        <>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={save}
            disabled={pending}
          >
            {pending
              ? "Saving…"
              : `Always open them on ${LABEL[basis].toLowerCase()}`}
          </Button>
          {" — this is the basis you file on, not a change to the books."}
        </>
      ) : (
        `You are looking at ${LABEL[basis].toLowerCase()}. An owner can change what opens by default.`
      )}
    </p>
  );
}
