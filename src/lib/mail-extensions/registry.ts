import "server-only";
import { accountingMailExtension } from "@/modules/accounting/mail/extension";
import { documentsMailExtension } from "@/modules/documents/mail/extension";
import type { MailExtension } from "./types";

/**
 * THE COMPOSITION ROOT. The only file in `src/lib/mail-extensions/` that may
 * import from `src/modules/**`.
 *
 * Exactly the job `src/modules/index.ts` does for module renderers, and for
 * exactly the same reason: somebody has to name the concrete implementations,
 * and confining that to one file is what keeps every other arrow in the
 * dependency graph pointing one way. Mail imports this; it never imports a
 * module. A module imports `types.ts`; it never imports this, and never another
 * module.
 *
 * eslint.config.mjs carves this file out by name. If you find yourself wanting
 * to add a module import somewhere else to avoid a plumbing chore, that is the
 * rule doing its job — add the hook to `types.ts` instead.
 *
 * Registration order is presentation order in the "Attach to…" picker.
 */
export const mailExtensions: readonly MailExtension[] = [
  accountingMailExtension,
  documentsMailExtension,
];

/** By slug, for turning a stored `mail_links.extension_slug` back into code. */
export function getMailExtension(slug: string): MailExtension | null {
  return mailExtensions.find((e) => e.slug === slug) ?? null;
}
