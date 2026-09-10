import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import type { AuditMessage } from "@/db/schema";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { listClientCandidates, PACK } from "@/packs/professional-services/ops";
import {
  getDiscovery,
  loadDiscoveryBusiness,
  messagesOf,
} from "@/packs/professional-services/discovery-ops";
import { isBriefed } from "@/packs/professional-services/core/discovery-prompt";
import { DiscoveryWorkspace } from "@/packs/professional-services/components/discovery-workspace";
import {
  AttachDiscoveryButton,
  DeleteDiscoveryButton,
} from "@/packs/professional-services/components/discovery-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/professional-services/discovery";

/** One discovery: the conversation with the copilot, and the two deliverables. */
export default async function DiscoveryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const audit = await getDiscovery(tx, ctx.tenant.id, id);
      if (!audit) return null;
      const [clients, pack, business] = await Promise.all([
        listClientCandidates(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        loadDiscoveryBusiness(tx, ctx.tenant.id, ctx.tenant.industry, ctx.tenant.name),
      ]);
      return { audit, clients, labels: pack.labels, business };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { audit, clients, labels, business } = data;
  const clientWord = labelFor(labels, "client", "Client");
  const isOwner = allowsWrite(ctx.role, "owner");
  const messages: AuditMessage[] = messagesOf(audit);

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" /> Discovery
      </Link>

      <PageHeader
        title={audit.businessName}
        icon={<Search />}
        description={
          audit.context ? (
            <span className="line-clamp-2">{audit.context}</span>
          ) : (
            <span>Nothing was written down going in.</span>
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!audit.partyId && (
              <>
                <Badge variant="outline">Not attached</Badge>
                <AttachDiscoveryButton
                  discoveryId={audit.id}
                  clients={clients}
                  clientWord={clientWord}
                />
              </>
            )}
            {isOwner && (
              <DeleteDiscoveryButton
                discoveryId={audit.id}
                businessName={audit.businessName}
              />
            )}
          </div>
        }
      />

      <DiscoveryWorkspace
        discoveryId={audit.id}
        status={audit.status}
        messages={messages}
        report={audit.report}
        briefed={isBriefed(business)}
      />
    </div>
  );
}
