import { Link2 } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listShares } from "@/modules/documents/shares/shares";
import {
  resolveShareStatus,
  shareStatusLabel,
} from "@/modules/documents/shares/status";
import { listFolders } from "@/modules/documents/folders";
import { buildFolderLabels } from "@/modules/documents/lib/folder-labels";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import { ShareRowActions } from "./share-row-actions";

export const dynamic = "force-dynamic";

/**
 * Every link the business has handed out. The point of the page is answering
 * "what is currently reachable from outside, and who made it reachable?" — so
 * revoked and expired links stay listed rather than disappearing.
 */
export default async function SharedLinksPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      shares: await listShares(tx, ctx.tenant.id),
      folders: await listFolders(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );

  const folderLabels = buildFolderLabels(data.folders);
  const folderVisibility = new Map(
    data.folders.map((f) => [f.id, f.effectiveVisibility]),
  );

  const rows = data.shares.map((share) => {
    // A share whose root RLS now hides reads as gone, which is exactly what
    // the recipient experiences too.
    const currentRootVisibility = share.folderId
      ? ((folderVisibility.get(share.folderId) ?? null) as
          | "members"
          | "owners"
          | null)
      : "members";
    const status = resolveShareStatus({
      revokedAt: share.revokedAt,
      expiresAt: share.expiresAt,
      maxUses: share.maxUses,
      useCount: share.useCount,
      failedUnlockCount: share.failedUnlockCount,
      createdRootVisibility: share.createdRootVisibility,
      currentRootVisibility,
    });
    return { share, status };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shared links"
        description="Anyone holding one of these can open what it points at, without signing in. Turning a link off takes effect immediately."
      />

      <DocumentsNav />

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Link2 />}
            title="Share something"
            description="Open a file or folder in Browse and create a link. Anyone holding it can see what it points at without signing in."
          />
        </Panel>
      ) : (
        <DataTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Points at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Expires</TableHead>
                <TableHead className="hidden sm:table-cell">Opened</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ share, status }) => (
                <TableRow key={share.id}>
                  <TableCell className="font-medium">
                    {share.label || "Untitled link"}
                    {share.passcodeHash && (
                      <Badge variant="secondary" className="ml-2">
                        Passcode
                      </Badge>
                    )}
                    {!share.canDownload && (
                      <Badge variant="secondary" className="ml-2">
                        View only
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {share.folderId
                      ? (folderLabels.get(share.folderId) ?? "A folder")
                      : "A file"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={status === "active" ? "default" : "secondary"}
                    >
                      {shareStatusLabel(status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {share.expiresAt.toLocaleDateString()}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {share.useCount === 0
                      ? "Never"
                      : `${share.useCount}×${
                          share.lastAccessedAt
                            ? ` · ${share.lastAccessedAt.toLocaleDateString()}`
                            : ""
                        }`}
                  </TableCell>
                  <TableCell className="text-right">
                    <ShareRowActions
                      shareId={share.id}
                      version={share.version}
                      status={status}
                      isOwner={ctx.role === "owner"}
                      hasPasscode={share.passcodeHash !== null}
                      label={share.label || "Untitled link"}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      )}
    </div>
  );
}
