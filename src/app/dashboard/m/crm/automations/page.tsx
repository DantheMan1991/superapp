import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { healthForRules } from "@/modules/crm/automation-health";
import { listRules } from "@/modules/crm/automation-ops";
import { AutomationManager } from "@/modules/crm/components/automation-manager";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * The automation rules.
 *
 * READABLE BY EVERY MEMBER, WRITABLE BY OWNERS — and the read half is the
 * unusual choice worth defending. The merge tool and the duplicates page are
 * owner-only in full, because they are jobs only an owner can finish. This page
 * is different: a rule silently changes other people's data, and somebody who
 * finds a follow-up they did not create is owed the ability to discover which
 * rule made it. A rules engine nobody can inspect is indistinguishable from a
 * haunted database.
 *
 * Staff therefore see the same list, as sentences, with the controls absent.
 */
export default async function AutomationsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const { rules, members, health } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const rules = await listRules(tx, ctx.tenant.id);
      return {
        rules,
        // In the caller's own transaction, so the picker can only offer people
        // this person could already find.
        members: await listAssignableMembers(tx, ctx.tenant.id),
        // Usually empty — a row exists only while a rule is failing.
        health: await healthForRules(
          tx,
          ctx.tenant.id,
          rules.map((r) => r.id),
        ),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );

  const isOwner = ctx.role === "owner";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All records
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
        <p className="text-sm text-muted-foreground">
          Things that happen on their own. Each one runs as whoever triggered it,
          so a rule can only change what that person could change themselves.
        </p>
      </div>

      {!isOwner && rules.length > 0 && (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          Only an owner can add or change these. They are shown here so you can
          see what is running.
        </p>
      )}

      <AutomationManager
        rules={rules}
        isOwner={isOwner}
        members={members.map((m) => ({
          clerkUserId: m.clerkUserId,
          label: memberLabel(m),
        }))}
        health={Object.fromEntries(
          [...health].map(([ruleId, h]) => [
            ruleId,
            {
              consecutiveFailures: h.consecutiveFailures,
              lastError: h.lastError,
              lastErrorAt: h.lastErrorAt.toISOString(),
            },
          ]),
        )}
      />
    </div>
  );
}
