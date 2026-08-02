"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { schema, withTenant } from "@/db";
import { logAudit } from "@/lib/audit";
import { authorizedClient, loadConnection } from "@/lib/email/oauth/accounts";
import { MailError, friendlyMessage } from "../core/errors";
import {
  compileRules,
  MAX_SCRIPT_BYTES,
  RULES_SCRIPT_NAME,
  type MailRule,
} from "./compile";

/**
 * Rules: stored here, executed there.
 *
 * Every write recompiles ALL of a person's rules into one Sieve script and
 * republishes it. There is no incremental path and there should not be: `stop`
 * makes rules order-dependent, so a script assembled from a partial view of
 * them would sort mail differently from the list somebody is looking at.
 */

const BASE = "/dashboard/m/email";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

const testSchema = z.object({
  field: z.enum(["from", "to", "subject"]),
  contains: z.string().min(1).max(200),
});

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  isEnabled: z.boolean(),
  matchMode: z.enum(["all", "any"]),
  tests: z.array(testSchema).min(1).max(10),
  fileIntoMailboxId: z.string().max(255).nullable(),
  fileIntoName: z.string().max(255).nullable(),
  markRead: z.boolean(),
  flag: z.boolean(),
  stopAfter: z.boolean(),
});

const saveSchema = z.object({
  mailboxId: z.string().uuid(),
  /** The COMPLETE list, in order. Order is semantic — see `stop`. */
  rules: z.array(ruleSchema).max(50),
});

export interface PublishOutcome {
  published: number;
  /** Rules that compiled to nothing, by name. */
  inert: string[];
}

export async function saveRulesAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<PublishOutcome>> {
  try {
    const ctx = await requireTenant();
    await requireModuleEnabled(ctx.tenant.id, "email");
    if (ctx.role === "expert") {
      throw new MailError("FORBIDDEN_EXPERT", "accountant has no mail access");
    }
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { mailboxId, rules } = parsed.data;

    const account = await loadConnection(ctx.tenant.id, ctx.userId, mailboxId);
    if (!account) throw new MailError("ACCOUNT_NOT_FOUND", "no connection");

    const compiled = compileRules(
      rules.map(
        (rule): MailRule => ({
          name: rule.name,
          isEnabled: rule.isEnabled,
          match: rule.matchMode,
          tests: rule.tests,
          action: {
            fileIntoMailboxId: rule.fileIntoMailboxId,
            fileIntoName: rule.fileIntoName,
            markRead: rule.markRead,
            flag: rule.flag,
          },
          stop: rule.stopAfter,
        }),
      ),
    );

    if (compiled.script.length > MAX_SCRIPT_BYTES) {
      return {
        error: "That's more rules than the mail server will accept. Remove a few.",
      };
    }

    const client = await authorizedClient(account);
    if (!client.ok) {
      throw new MailError(
        client.needsReauth ? "ACCOUNT_NEEDS_REAUTH" : "MAIL_SERVER_UNREACHABLE",
        client.message,
      );
    }

    /**
     * THE MAIL SERVER GOES FIRST.
     *
     * If it refuses the script, nothing is written here — so the rules in the
     * database always describe the script that is actually running. The other
     * order would leave somebody editing a list that has no relationship to
     * how their mail is being sorted, which is worse than a failed save.
     */
    const published = await client.data.putSieveScript(
      RULES_SCRIPT_NAME,
      compiled.script,
    );
    if (!published.ok) return { error: published.message };

    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        // Replace wholesale. Order carries meaning and ids do not, so
        // reconciling row by row would be more code to reach the same state.
        await tx
          .delete(schema.mailRules)
          .where(
            and(
              eq(schema.mailRules.tenantId, ctx.tenant.id),
              eq(schema.mailRules.clerkUserId, ctx.userId),
              eq(schema.mailRules.mailAccountId, account.id),
            ),
          );
        if (rules.length === 0) return;
        await tx.insert(schema.mailRules).values(
          rules.map((rule, index) => ({
            tenantId: ctx.tenant.id,
            clerkUserId: ctx.userId,
            mailAccountId: account.id,
            name: rule.name,
            isEnabled: rule.isEnabled,
            matchMode: rule.matchMode,
            tests: rule.tests,
            action: {
              fileIntoMailboxId: rule.fileIntoMailboxId,
              fileIntoName: rule.fileIntoName,
              markRead: rule.markRead,
              flag: rule.flag,
            },
            stopAfter: rule.stopAfter,
            sortOrder: index,
          })),
        );
      },
      { role: ctx.role, userId: ctx.userId },
    );

    await logAudit({
      action: "mail.rules_published",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "mailbox",
      targetId: mailboxId,
      // Counts and size only. A rule name says what somebody is filing away
      // and often why — "anything from the solicitor" is correspondence (S9).
      meta: {
        rules: rules.length,
        enabled: rules.filter((r) => r.isEnabled).length,
        bytes: compiled.script.length,
      },
    });

    revalidatePath(BASE);
    return {
      ok: true,
      data: { published: rules.filter((r) => r.isEnabled).length, inert: compiled.inert },
    };
  } catch (err) {
    if (!(err instanceof MailError)) console.error("rules save failed", err);
    return { error: friendlyMessage(err) };
  }
}

/** Everything this person has configured for this connection, in order. */
export async function loadRules(
  tenantId: string,
  userId: string,
  role: "owner" | "staff" | "expert",
  mailAccountId: string,
) {
  return withTenant(
    tenantId,
    (tx) =>
      tx
        .select()
        .from(schema.mailRules)
        .where(
          and(
            eq(schema.mailRules.tenantId, tenantId),
            eq(schema.mailRules.mailAccountId, mailAccountId),
          ),
        )
        .orderBy(asc(schema.mailRules.sortOrder)),
    { role, userId },
  );
}
