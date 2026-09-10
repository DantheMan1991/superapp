import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import { isModuleEnabled } from "@/lib/modules";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { createParty, loadParty, PartyError } from "@/lib/parties";
import { addContactPoint } from "@/lib/parties/contacts";
import { logActivity } from "@/modules/crm/timeline-ops";

/**
 * A client is a party in the operator tenant (ADR 0041, back-office slice 1).
 *
 * The console's half of the seam. `tenants` holds the workspace; the
 * relationship — who they are, what was said, what comes next — is a party
 * in the operator's own CRM, and `tenants.operator_party_id` is the one
 * pointer between them, written here and nowhere else. The CRM never writes
 * `tenants`; this file never writes anything of the CRM's except through the
 * CRM's own door.
 *
 * WHY THIS FILE LIVES UNDER src/app/admin AND NOT src/lib. It imports CRM's
 * own door (`logActivity`) beside the shared party doors, and the house rule
 * is that `src/lib` never imports a module — only a registry may know an
 * implementation exists. The console is Layer 0 shell code and already
 * imports module code to provision (accounting's chart of accounts,
 * documents' folders, in actions.ts); this is the same permission, used the
 * same way.
 *
 * WHY A CONSOLE ACTION AND NOT A SCRIPT. Every door here is `server-only` —
 * the party subsystem, CRM's ops, `logAudit` — and a tsx script cannot load
 * one. The plan said "a backfill script"; it was wrong about the tooling, not
 * the job. `createOperatorPartiesAction` IS the backfill, run from the
 * Clients page, audited per workspace.
 *
 * WHAT IT WRITES, AND IN WHOSE CONTEXT. Under the OPERATOR's context as an
 * owner — not `withSystem`, because the party table is the operator's and
 * RLS should be the one deciding what a superadmin may put in it: an
 * organization party named for the business; its contact email as a contact
 * point; when CRM is switched on for the operator, a CRM record with
 * `source = 'platform'` (the enquiry's shape, ADR 0021) and every console
 * note as a `note` activity by its original author, dated when it was
 * written. Then, under `withSystem`, the pointer — the only platform-level
 * write, and the only one this file makes.
 */

export interface EnsureResult {
  partyId: string;
  /** False when the workspace was already linked; nothing was written. */
  created: boolean;
  /** Console notes carried onto the party's timeline (0 when CRM is off). */
  notesMoved: number;
}

export type RelationshipRefusal = "NO_OPERATOR" | "NOT_FOUND" | "IS_OPERATOR";

export class RelationshipError extends Error {
  constructor(
    readonly code: RelationshipRefusal,
    message: string,
  ) {
    super(message);
    this.name = "RelationshipError";
  }
}

/** The sentence the console shows for a refusal. */
export function relationshipMessage(code: RelationshipRefusal): string {
  switch (code) {
    case "NO_OPERATOR":
      return "No operator tenant is named yet — run scripts/operator-tenant.ts first.";
    case "NOT_FOUND":
      return "No such business.";
    case "IS_OPERATOR":
      return "The operator tenant is not a client of itself.";
  }
}

export async function ensureOperatorParty(
  tenantId: string,
  actor: { userId: string },
): Promise<EnsureResult> {
  const operator = await getOperatorTenant();
  if (!operator) {
    throw new RelationshipError("NO_OPERATOR", "no operator tenant is named");
  }

  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
      columns: {
        id: true,
        name: true,
        contactEmail: true,
        isOperator: true,
        operatorPartyId: true,
      },
    }),
  );
  if (!tenant) throw new RelationshipError("NOT_FOUND", "no such business");
  if (tenant.isOperator) {
    throw new RelationshipError(
      "IS_OPERATOR",
      "the operator is not a client of itself",
    );
  }
  if (tenant.operatorPartyId) {
    return { partyId: tenant.operatorPartyId, created: false, notesMoved: 0 };
  }

  // Read under withSystem: `tenant_notes` is superadmin-only by policy. They
  // are carried across, never deleted here — the table's DROP is slice 3's,
  // after this move has been read on production.
  const notes = await withSystem((tx) =>
    tx.query.tenantNotes.findMany({
      where: eq(schema.tenantNotes.tenantId, tenantId),
      orderBy: asc(schema.tenantNotes.createdAt),
    }),
  );
  const crmOn = await isModuleEnabled(operator.id, "crm");

  const written = await withTenant(
    operator.id,
    async (tx) => {
      const party = await createParty(tx, operator.id, {
        kind: "organization",
        displayName: tenant.name,
      });
      if (tenant.contactEmail) {
        try {
          await addContactPoint(tx, operator.id, party.id, {
            kind: "email",
            value: tenant.contactEmail,
          });
        } catch (err) {
          // An address the console accepted years ago and the contact door
          // refuses today is not worth losing the party over.
          if (!(err instanceof PartyError && err.code === "CONTACT_VALUE_INVALID")) {
            throw err;
          }
        }
      }

      // Discovery records that moved home before this business had a party
      // (slice 2's migration) remember where they came from; now they attach.
      await tx
        .update(schema.audits)
        .set({ partyId: party.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.audits.tenantId, operator.id),
            eq(schema.audits.originTenantId, tenantId),
            isNull(schema.audits.partyId),
          ),
        );

      let notesMoved = 0;
      if (crmOn) {
        await tx
          .insert(schema.crmPartyDetails)
          .values({ tenantId: operator.id, partyId: party.id, source: "platform" })
          .onConflictDoNothing();
        for (const note of notes) {
          await logActivity(
            tx,
            { tenantId: operator.id, userId: note.authorClerkUserId, role: "owner" },
            {
              partyId: party.id,
              kind: "note",
              subject: "Console note",
              body: note.body,
              occurredAt: note.createdAt,
            },
          );
          notesMoved += 1;
        }
      }
      return { partyId: party.id, notesMoved };
    },
    { role: "owner", userId: actor.userId },
  );

  // The pointer, guarded against a second click racing this one: only a row
  // still unlinked takes it. Losing the race leaves an orphan party the
  // operator can merge in its own CRM, which beats a workspace pointing at
  // two.
  const [linked] = await withSystem((tx) =>
    tx
      .update(schema.tenants)
      .set({ operatorPartyId: written.partyId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.tenants.id, tenantId),
          isNull(schema.tenants.operatorPartyId),
        ),
      )
      .returning({ id: schema.tenants.id }),
  );
  if (!linked) {
    const now = await withSystem((tx) =>
      tx.query.tenants.findFirst({
        where: eq(schema.tenants.id, tenantId),
        columns: { operatorPartyId: true },
      }),
    );
    return {
      partyId: now?.operatorPartyId ?? written.partyId,
      created: false,
      notesMoved: written.notesMoved,
    };
  }
  return { partyId: written.partyId, created: true, notesMoved: written.notesMoved };
}

export interface OperatorPartyView {
  id: string;
  displayName: string;
  isActive: boolean;
}

/**
 * The party a workspace points at, read through the OPERATOR's own context
 * as `staff` — the first place the console reads a tenant's rows through RLS
 * rather than the god view, and narrower for it. Null when no operator is
 * named or the party is gone; a dangling pointer is a fact to show, not an
 * error to throw.
 */
export async function readOperatorParty(
  partyId: string,
): Promise<OperatorPartyView | null> {
  const operator = await getOperatorTenant();
  if (!operator) return null;
  try {
    const party = await withTenant(
      operator.id,
      (tx) => loadParty(tx, operator.id, partyId),
      { role: "staff" },
    );
    return { id: party.id, displayName: party.displayName, isActive: party.isActive };
  } catch (err) {
    if (err instanceof PartyError && err.code === "PARTY_NOT_FOUND") return null;
    throw err;
  }
}
