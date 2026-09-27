"use client";

import { UserButton } from "@clerk/nextjs";
import { UserRound } from "lucide-react";
import { PERSONAL_OPEN } from "@/lib/personal-space-core";

/**
 * The account button, with "Personal space" in its menu when the door is open
 * (ADR 0111, `personalSpacesOpen`).
 *
 * A client component for one reason: `UserButton.MenuItems` is a property of a
 * client module, and a server component cannot dot into one — it can only
 * pass the imported name through. The layout decides `personalSpace` and this
 * draws it.
 *
 * Two renders rather than a conditional child, so Clerk never has to decide
 * what a `false` among its menu items means.
 */
export function AccountMenu({ personalSpace }: { personalSpace: boolean }) {
  if (!personalSpace) return <UserButton />;
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link
          label="Personal space"
          labelIcon={<UserRound className="size-4" />}
          href={PERSONAL_OPEN}
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}
