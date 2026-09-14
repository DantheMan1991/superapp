"use client";

import { createContext, useContext, type ReactNode } from "react";
import { partyWords, type PartyWords } from "@/lib/parties/vocabulary";

/**
 * THE TENANT'S VOCABULARY, available to any client component under the
 * dashboard.
 *
 * **Why a provider and not props**, which is the question a reviewer should ask
 * because prop-threading is what every pack does. The packs thread ONE word into
 * ONE component and that is the right call at that size. Core's party words are
 * a different shape: four words across roughly twenty files, and the worst case
 * is `SalesNav` — a client component rendered by eight separate server pages, so
 * a prop would mean eight identical plumbing edits for one navigation label, and
 * eight chances for the ninth page to forget.
 *
 * The layout is also the only thing holding `ctx.tenant`, which carries both the
 * industry and the tenant's overrides. That is the same argument
 * `FeedbackProvider` states two lines above where this one is mounted: *"the
 * provider rather than the button, because the button is rendered by
 * `PageHeader` deep inside `children` and this layout is the only thing that
 * knows the count."* Words are rendered deeper still.
 *
 * **Server components must NOT use this.** They have `ctx.tenant` themselves and
 * should call `labelsForTenant` then `partyWords` — a context read in a server
 * component is a bug that renders the fallback silently, which is the one
 * failure mode here that nothing would catch. Every call site swept in this
 * slice was checked for `"use client"` first.
 *
 * Outside the dashboard — /admin, the public share page — there is no provider
 * and every word falls back to the core English, which is correct: those
 * surfaces are not a tenant's workspace.
 */
const LabelContext = createContext<Record<string, string>>({});

export function LabelProvider({
  labels,
  children,
}: {
  /** Already resolved by `labelsForTenant`: profile defaults, tenant on top. */
  labels: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <LabelContext.Provider value={labels}>{children}</LabelContext.Provider>
  );
}

/**
 * One renameable word, with the core word when nobody has renamed it.
 *
 * Mirrors `labelFor` from `lib/packs/resolve.ts` deliberately, so a reader
 * moving between a server and a client component sees the same call. **Pass the
 * key as a literal string**, not a constant: `tests/vocabulary.test.ts` scans
 * the source for these calls to prove every rendered key is declared, and a
 * constant slips past the scan — which is how `enterprise` came to be rendered
 * across the product while declared nowhere.
 */
export function useLabel(key: string, fallback: string): string {
  return useContext(LabelContext)[key] ?? fallback;
}

/** The four party words, resolved from context. The common case in a screen. */
export function usePartyWords(): PartyWords {
  return partyWords(useContext(LabelContext));
}
