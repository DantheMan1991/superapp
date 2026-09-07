import type { ReactNode } from "react";

/**
 * A field's name, shown only below `md`.
 *
 * For a form that is a grid with a header row on a wide screen and a stack of
 * blocks on a phone: the header row names the columns once up there, and
 * disappears down here, so each field needs its own name beside it. This is
 * that name. Rendering it always and hiding it with CSS keeps one markup for
 * both shapes — see the bill and invoice line editors.
 */
export function PhoneLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-xs text-muted-foreground md:hidden">
      {children}
    </span>
  );
}
