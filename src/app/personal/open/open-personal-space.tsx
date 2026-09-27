"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useOrganizationList } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { PERSONAL_HOME } from "@/lib/personal-space-core";
import { createPersonalSpaceAction } from "./actions";

/**
 * THE DOOR, CLIENT HALF. Switching the active organization is the browser's to
 * do — Clerk's `setActive`, the same call the sidebar switcher makes — so the
 * server hands over an organization id and this does the switch, then goes
 * home.
 *
 * Somebody who already has a space is switched to it as soon as Clerk has
 * loaded: they asked for it from the menu, and a second click to confirm
 * would be a question with one answer. Somebody who has none is asked first,
 * because making one creates something.
 */
export function OpenPersonalSpace({ existingOrgId }: { existingOrgId: string | null }) {
  const router = useRouter();
  const { isLoaded, setActive } = useOrganizationList();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const switched = useRef(false);

  useEffect(() => {
    if (!existingOrgId || !isLoaded || !setActive || switched.current) return;
    switched.current = true;
    setActive({ organization: existingOrgId })
      .then(() => router.replace(PERSONAL_HOME))
      .catch(() => setError("Your personal space could not be opened. Try again."));
  }, [existingOrgId, isLoaded, setActive, router]);

  const create = () =>
    startTransition(async () => {
      setError(null);
      const outcome = await createPersonalSpaceAction({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if ("error" in outcome) {
        setError(outcome.error);
        return;
      }
      try {
        await setActive?.({ organization: outcome.clerkOrgId });
      } catch {
        setError(
          "Your personal space is ready, but switching to it failed. Pick Personal in the workspace switcher.",
        );
        return;
      }
      router.replace(PERSONAL_HOME);
    });

  if (existingOrgId) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-muted-foreground">
          {error ?? "Opening your personal space…"}
        </p>
        {error && (
          <Button
            onClick={() => {
              switched.current = false;
              setError(null);
              setActive?.({ organization: existingOrgId })
                .then(() => router.replace(PERSONAL_HOME))
                .catch(() => setError("Your personal space could not be opened. Try again."));
            }}
          >
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-center">
      <Button onClick={create} disabled={pending || !isLoaded}>
        {pending ? "Making your space…" : "Create my personal space"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
