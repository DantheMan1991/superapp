import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/auth";
import { findPersonalSpace, personalSpacesOpenFor } from "@/lib/personal-space";
import { reconcileTenantMemberships } from "@/lib/membership-sync";
import { OpenPersonalSpace } from "./open-personal-space";

export const dynamic = "force-dynamic";

/**
 * THE DOOR INTO A PERSONAL SPACE (ADR 0111), reached from "Personal space" in
 * the account menu.
 *
 * Outside the space's own layout on purpose: until the browser has switched
 * the active organization the caller is still in their business, and
 * `requirePersonalSpace` would send them straight back there.
 *
 * Somebody with a space is switched into it. Somebody without one is told what
 * it is and asked, because the button creates a Clerk organization — and only
 * while personal spaces are open (`personalSpacesOpen`); before that the menu
 * item is not drawn, and a typed URL lands back on the dashboard.
 */
export default async function OpenPersonalSpacePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const existing = await findPersonalSpace(userId);
  if (!existing && !(await personalSpacesOpenFor(await isSuperAdmin()))) {
    redirect("/dashboard");
  }
  // The documented idempotent fallback, as onboarding is for a business: a
  // membership the webhook never delivered is mirrored the next time the
  // owner comes through the door. It only ever mirrors the owner.
  if (existing) await reconcileTenantMemberships(existing);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="max-w-md space-y-2 text-center">
        {/* Not `PageHeader`: a centred single-purpose screen, like onboarding. */}
        <h1 className="font-heading text-2xl font-semibold tracking-heading">
          {existing ? "Your personal space" : "A space of your own"}
        </h1>
        {!existing && (
          <>
            <p className="text-sm text-muted-foreground">
              Your personal space sits beside your business. It is where your
              own things go: your workouts first, then recipes and meal
              planning.
            </p>
            <p className="text-sm text-muted-foreground">
              Only you can open it. Nobody from your business can see into it,
              nobody can be invited, and Yosher staff cannot open it from the
              product either.
            </p>
          </>
        )}
      </div>
      <OpenPersonalSpace existingOrgId={existing?.clerkOrgId ?? null} />
    </div>
  );
}
