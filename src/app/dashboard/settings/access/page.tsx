import { KeyRound } from "lucide-react";
import { eq } from "drizzle-orm";
import { requireTenantOwner } from "@/lib/auth";
import { withTenant, schema } from "@/db";
import { getActiveModules } from "@/lib/modules";
import { getRenderableFeature } from "@/lib/features";
import { listAccessLevels } from "@/lib/access/levels";
import { moduleOf } from "@/lib/access/can";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccessLevelControls, AccessLevelForm } from "./access-controls";

export const dynamic = "force-dynamic";

/**
 * WHAT PEOPLE CAN REACH (ADR 0093).
 *
 * Owner-only, and `requireTenantOwner()` rather than a role check in the body:
 * every write behind this screen is refused by Postgres for anybody else
 * (`drizzle/0385`), so a staff member who found the URL would get a page of
 * controls that could not save. A redirect is the honest answer.
 *
 * Not gated on any module. An access level is Layer 0, like a membership —
 * gating it would hide the permission screen from a workspace that had switched
 * that module off.
 */
export default async function AccessPage() {
  const ctx = await requireTenantOwner();

  const { levels, active, staffCount } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      levels: await listAccessLevels(tx, ctx.tenant.id),
      active: await getActiveModules(ctx.tenant.id),
      // How many people a level could apply to. Owners are excluded because
      // they can never be on one, which is also why a workspace of one owner
      // sees the explanation rather than an empty table it cannot use.
      staffCount: (
        await tx
          .select({ role: schema.memberships.role })
          .from(schema.memberships)
          .where(eq(schema.memberships.tenantId, ctx.tenant.id))
      ).filter((m) => m.role !== "owner").length,
    }),
    { role: ctx.role },
  );

  /**
   * The tools a level can take away: switched on AND renderable, exactly the
   * list the rail draws from. A pack that is declared but has no screen yet
   * cannot be taken away, because there is nothing to take.
   */
  const tools = active
    .filter(({ module }) => getRenderableFeature(module.id))
    .map(({ module }) => ({ slug: module.id, name: module.name }));
  const nameOf = new Map(tools.map((t) => [t.slug, t.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Access"
        description="What each person can open. Everyone starts able to reach everything you have switched on; a level takes things away."
        icon={<KeyRound />}
        actions={<AccessLevelForm tools={tools} />}
      />

      {levels.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title="No levels yet"
          description="A level is a job — “Field crew”, “Bookkeeper” — with the tools that job does not need switched off. You make it once and put people on it."
        />
      ) : (
        <DataTable isEmpty={false}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Level</TableHead>
                <TableHead className="hidden sm:table-cell">Cannot open</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {levels.map((level) => {
                // Only the whole-tool denials are named here; an area reads as
                // its tool, and the dialog is where the detail belongs.
                const off = [
                  ...new Set(level.denied.map((k) => nameOf.get(moduleOf(k)) ?? moduleOf(k))),
                ].sort();
                return (
                  <TableRow key={level.id}>
                    <TableCell className="text-sm font-medium">
                      {level.name}
                      {level.notes !== "" && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {level.notes}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-[22rem] text-sm text-muted-foreground sm:table-cell">
                      {off.length === 0 ? (
                        <span className="text-subtle-foreground">Nothing — reaches everything</span>
                      ) : (
                        /*
                          NAMED UP TO FOUR, THEN COUNTED. A level that takes away
                          eleven tools listed them all and pushed the actions
                          column off the side of the table — and "Accounting,
                          Assets, Inventory, Land, Livestock, Mail, Marketing,
                          Production, Retail, Scheduling, Work" is not a sentence
                          anybody reads anyway. The dialog is where the full list
                          belongs, one tick box at a time.
                        */
                        <span title={off.join(", ")}>
                          {off.slice(0, 4).join(", ")}
                          {off.length > 4 && ` and ${off.length - 4} more`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {level.members}
                    </TableCell>
                    <TableCell className="text-right">
                      <AccessLevelControls
                        level={{
                          id: level.id,
                          name: level.name,
                          notes: level.notes,
                          denied: level.denied,
                          members: level.members,
                        }}
                        tools={tools}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTable>
      )}

      {/*
        SAID PLAINLY, on the screen, because the gap between what this does and
        what somebody will assume it does is where the harm lives. An owner who
        believes a level hides money will act on that belief.
      */}
      <div className="space-y-3 rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <p>
          <strong className="font-medium text-foreground">
            A level decides which screens somebody can open.
          </strong>{" "}
          Not in their menu, and not by typing the address either — the page
          answers as if it were not there.
        </p>
        <p>
          <strong className="font-medium text-foreground">
            Which company&rsquo;s books somebody sees is set on the Team page,
          </strong>{" "}
          beside their level, and it is a different kind of limit: a level takes
          a screen away, while a company limit means the figures for the others
          are never given to them at all &mdash; on any screen, including ones
          built later.
        </p>
        <p>
          <strong className="font-medium text-foreground">Owners always reach everything.</strong>{" "}
          {staffCount === 0
            ? "Nobody on this team is staff yet, so there is nobody to put on a level."
            : "A level can only be given to staff and to your accountant."}
        </p>
      </div>
    </div>
  );
}
