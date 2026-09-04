import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withWork } from "@/lib/work/with-work";
import { roleMayWrite } from "@/lib/work/vocabulary";
import { listWorkLists } from "@/modules/work/read";
import {
  ListManager,
  type ListRowView,
} from "@/modules/work/components/list-manager";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/work";

/**
 * Managing lists. The settings surface behind "my work" — reached often enough
 * to deserve a page, not often enough to be the front door.
 *
 * Archived lists ARE shown here and nowhere else: this is the one screen where
 * "where did that list go" is the question being asked.
 */
export default async function WorkListsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "work");

  const workCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  const lists = await withWork(workCtx, (tx) =>
    listWorkLists(tx, ctx.tenant.id, { includeArchived: true }),
  );

  const rows: ListRowView[] = lists.map((list) => ({
    id: list.id,
    name: list.name,
    color: list.color,
    visibility: list.visibility,
    isDefault: list.isDefault,
    archived: list.archivedAt !== null,
  }));

  return (
    <div className="space-y-4">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to my work
      </Link>
      {/* The same question `gate()` asks. This page called it nowhere until
          2026-09-03, so an accountant saw New list, Edit and Archive all
          enabled and every press came back `You do not have access to do
          that.` */}
      <ListManager
        lists={rows}
        isOwner={ctx.role === "owner"}
        canWrite={roleMayWrite(ctx.role)}
      />
    </div>
  );
}
