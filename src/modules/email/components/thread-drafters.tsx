import type { TenantContext } from "@/lib/auth";
import {
  draftersFrom,
  enabledMailExtensions,
} from "@/lib/mail-extensions/resolve";
import { ThreadDraftBar } from "./thread-draft-controls";

/**
 * The server half: which modules can draft a record from this conversation.
 *
 * Resolved here rather than in the client component so the buttons are decided
 * by what the tenant actually has switched on, not by a round trip after the
 * pane has already rendered. A tenant without Accounting sees nothing at all —
 * an inert button advertising a module you have not bought is worse than no
 * button.
 */
export async function ThreadDrafters({
  ctx,
  mailboxId,
  threadId,
}: {
  ctx: TenantContext;
  mailboxId: string;
  threadId: string;
}) {
  // The outside accountant reads the books; they have no mail access at all,
  // and certainly no business raising records from somebody's correspondence.
  if (ctx.role === "expert") return null;

  const extensions = await enabledMailExtensions(ctx.tenant.id);
  const drafters = draftersFrom(extensions).map(({ extension, drafter }) => ({
    extensionSlug: extension.slug,
    kind: drafter.kind,
    label: drafter.label,
  }));
  if (drafters.length === 0) return null;

  return (
    <div className="mt-3">
      <ThreadDraftBar
        mailboxId={mailboxId}
        threadId={threadId}
        drafters={drafters}
      />
    </div>
  );
}
