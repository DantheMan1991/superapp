import Link from "next/link";
import { Mail } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isModuleEnabled } from "@/lib/modules";
import {
  enabledMailExtensions,
  entityTypeIndex,
} from "@/lib/mail-extensions/resolve";
import type { LinkableEntityRef } from "@/lib/mail-extensions/types";
import {
  listLinksForEntity,
  listLinksOnThreads,
  resolveLinks,
  type ResolvedLink,
} from "../links";
import { linkIcon } from "./link-icons";

/**
 * "Emails on this invoice" — the other end of the link, rendered on a business
 * record's own page.
 *
 * WHAT THIS SHOWS, AND WHY IT IS THE FILED COPIES RATHER THAN THE THREADS. A
 * colleague reading an invoice is not the person whose mailbox the conversation
 * lives in. `mail_accounts` and `mail_thread_index` are scoped to one user by
 * RLS (0043), so a thread's own subject line is invisible to them — correctly,
 * because it is somebody's private correspondence. What IS visible is what was
 * deliberately published: the copy filed into Documents, under Documents' own
 * visibility rules. So this view walks link → thread → filed copy and shows the
 * thing a person can actually open.
 *
 * That walk is two reads of one table, which is why no new join table was
 * needed: "the emails on this invoice" and "the invoice on this email" are
 * `mail_links` read from opposite ends. An industry pack registering a `job`
 * type gets this view for nothing.
 *
 * It renders NOTHING when there is nothing attached. A permanently empty card on
 * every invoice in the product would be an advertisement, not a feature.
 */
export async function EntityThreads({
  ctx,
  target,
}: {
  ctx: TenantContext;
  target: LinkableEntityRef;
}) {
  // Mail switched off means no chips, no card, and no queries. The links stay in
  // the database untouched and come back if it is switched on again.
  if (!(await isModuleEnabled(ctx.tenant.id, "email"))) return null;
  // The external accountant is denied mail entirely, and that has to hold on
  // every surface mail data reaches — not just inside the mail module.
  if (ctx.role === "expert") return null;

  const extensions = await enabledMailExtensions(ctx.tenant.id);
  const types = entityTypeIndex(extensions);
  const scope = { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };

  const attached = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const direct = await listLinksForEntity(tx, ctx.tenant.id, target);
      if (direct.length === 0) return [] as ResolvedLink[];

      const threads = direct.map((l) => ({
        mailAccountId: l.mailAccountId,
        threadId: l.threadId,
      }));
      const onThreads = await listLinksOnThreads(tx, ctx.tenant.id, threads);
      // Everything on those threads EXCEPT the record we are already looking at.
      // Listing the invoice on the invoice's own page is noise.
      const others = onThreads.filter(
        (l) =>
          !(l.entityType === target.entityType && l.entityId === target.entityId),
      );
      return resolveLinks(tx, scope, extensions, others);
    },
    { role: ctx.role, userId: ctx.userId },
  );

  if (attached.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" /> Email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {attached.map((link) => {
            const Icon = linkIcon(
              types.get(link.entityType)?.entityType.icon ?? "link",
            );
            const label = link.entity?.label ?? "No longer available";
            return (
              <li key={link.linkId} className="flex items-start gap-2 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  {link.entity?.href ? (
                    <Link href={link.entity.href} className="hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{label}</span>
                  )}
                  {link.entity?.sublabel && (
                    <span className="block text-xs text-muted-foreground">
                      {link.entity.sublabel}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          {/* The single most important sentence on this card. A filed copy is a
              snapshot of one message at one moment — not a live view of a
              mailbox — and somebody reading it needs to know a later reply will
              not appear here on its own. */}
          Filed copies, captured when each email was attached. Later replies are
          new messages and have to be attached too.
        </p>
      </CardContent>
    </Card>
  );
}
