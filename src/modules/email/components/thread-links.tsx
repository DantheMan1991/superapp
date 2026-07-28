import Link from "next/link";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import {
  enabledMailExtensions,
  entityTypeIndex,
  filingTargetFor,
} from "@/lib/mail-extensions/resolve";
import { listLinksForThread, resolveLinks } from "../links";
import { AttachToButton, RemoveLinkButton } from "./thread-link-controls";
import { linkIcon } from "./link-icons";

/**
 * What this conversation is attached to, and the way to attach it to something
 * else — the strip under the message header.
 *
 * A server component, like every other pane here: the links are a database read
 * in the same request that already fetched the message, so a client fetch would
 * be a second round trip for data we are holding.
 *
 * The filed copy is shown as a chip like any other attachment. That is deliberate
 * rather than incidental — it makes the copy visible instead of an invisible side
 * effect, so nobody discovers weeks later that linking published a message.
 */
export async function ThreadLinks({
  ctx,
  mailboxId,
  mailAccountId,
  emailId,
  threadId,
}: {
  ctx: TenantContext;
  mailboxId: string;
  mailAccountId: string;
  emailId: string;
  threadId: string;
}) {
  const extensions = await enabledMailExtensions(ctx.tenant.id);
  const filer = filingTargetFor(extensions);
  // Icons come from the extension that registered the type, never from a table
  // in here: an extension that changes its icon should not need this file
  // edited, and a copy stored on the link row would go stale the day it did.
  const types = entityTypeIndex(extensions);
  const scope = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  const links = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const rows = await listLinksForThread(tx, ctx.tenant.id, {
        mailAccountId,
        threadId,
      });
      return resolveLinks(tx, scope, extensions, rows);
    },
    { role: ctx.role, userId: ctx.userId },
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {links.map((link) => {
        const Icon = linkIcon(
          types.get(link.entityType)?.entityType.icon ?? "link",
        );
        return (
          <span
            key={link.linkId}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-secondary/40 py-1 pr-1.5 pl-2.5 text-xs"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            {link.entity?.href ? (
              <Link
                href={link.entity.href}
                className="max-w-[16rem] truncate hover:underline"
              >
                {link.entity.label}
              </Link>
            ) : (
              <span className="max-w-[16rem] truncate text-muted-foreground">
                {/* "Restricted" and "gone" are the same sentence on purpose:
                    naming the difference would confirm the record exists. */}
                {link.entity?.label ?? "No longer available"}
              </span>
            )}
            <RemoveLinkButton linkId={link.linkId} />
          </span>
        );
      })}

      {filer?.filing ? (
        <AttachToButton
          mailboxId={mailboxId}
          emailId={emailId}
          destinationLabel={filer.filing.destinationLabel}
        />
      ) : (
        <span className="text-xs text-muted-foreground">
          {/* Honest about WHY rather than hiding the feature. Attaching without
              somewhere to file a readable copy would leave a colleague with a
              pointer into a mailbox they have no credential for. */}
          Attaching a conversation needs the Documents module.
        </span>
      )}
    </div>
  );
}
