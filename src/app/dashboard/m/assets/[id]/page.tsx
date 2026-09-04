import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Wrench } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { listEntities } from "@/modules/accounting/core";
import { requireTenant } from "@/lib/auth";
import { allowsWrite } from "@/lib/packs/authorize";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { attachmentsForRecord } from "@/modules/documents/attachments";
import { RecordPhotos } from "@/modules/documents/components/record-photos";
import { isDisplayableImage } from "@/modules/documents/allowlist";
import {
  attachAssetPhotoAction,
  detachAssetPhotoAction,
  setAssetPhotoPrimaryAction,
} from "@/packs/assets/actions";
import { formatMoney } from "@/lib/money";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/app/panel";
import {
  getAsset,
  listChildren,
  listContainerCandidates,
  listKindsInUse,
} from "@/packs/assets/ops";
import { assetKindLabel } from "@/packs/assets/vocabulary";
import { listAccounts } from "@/modules/accounting/core";
import {
  AssetControls,
  type AssetDetailView,
} from "@/packs/assets/components/asset-controls";
import {
  DepreciationPanel,
  type DepreciationView,
} from "@/packs/assets/components/depreciation-panel";
import {
  getDepreciationStatus,
  postedToDateCents,
} from "@/packs/assets/depreciation-ops";
import { periodOf } from "@/packs/assets/core/depreciation";
import {
  getScheduleStatuses,
  latestMeter,
  listMaintenanceWork,
} from "@/packs/assets/maintenance-ops";
import { dueSummary } from "@/packs/assets/core/maintenance";
import {
  MaintenancePanel,
  type MaintenanceView,
} from "@/packs/assets/components/maintenance-panel";
import { listAssignableMembers, memberLabel } from "@/lib/team";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/assets";

/**
 * One asset.
 *
 * A PACK'S SUB-ROUTE LIVES IN `src/app/`, not in `src/packs/`. That is the same
 * arrangement core modules have — the renderer is in the module, the route file
 * is here — because Next resolves routes from the app directory and nothing
 * about a pack changes that. The pack still owns everything this page does; the
 * file is a thin entry point that guards and delegates.
 *
 * `requireModuleEnabled` is not optional here. A route file is reachable by URL
 * whether or not the pack is switched on for the tenant, so the guard is what
 * makes "switched off" mean something.
 */
export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "assets");

  // The tenant's today decides which periods are due, never the server's.
  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  const currentPeriod = periodOf(today);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const asset = await getAsset(tx, ctx.tenant.id, id);
      if (!asset) return null;
      const [parent, children, containers, kinds, depreciation, accounts, accumulated, schedules, maintWork, meter, teamMembers, attachments] =
        await Promise.all([
          asset.parentId ? getAsset(tx, ctx.tenant.id, asset.parentId) : null,
          listChildren(tx, ctx.tenant.id, asset.id),
          // Excludes this asset AND its descendants, so the picker cannot offer
          // a cycle. The refusal in ops.ts stays as the backstop.
          listContainerCandidates(tx, ctx.tenant.id, asset.id),
          listKindsInUse(tx, ctx.tenant.id),
          getDepreciationStatus(tx, ctx.tenant.id, asset, currentPeriod),
          listAccounts(tx, ctx.tenant.id),
          postedToDateCents(tx, ctx.tenant.id, asset.id),
          getScheduleStatuses(tx, ctx.tenant.id, asset, today),
          listMaintenanceWork(tx, ctx.tenant.id, asset.id),
          latestMeter(tx, ctx.tenant.id, asset.id),
          listAssignableMembers(tx, ctx.tenant.id),
          attachmentsForRecord(tx, ctx.tenant.id, {
            extensionSlug: "assets",
            entityType: "asset",
            entityId: asset.id,
          }),
        ]);
      // Registers so the proceeds picker can exclude other companies', and
      // companies so the page can name this asset's owner (ADR 0010).
      const registers = await tx.query.bankAccounts.findMany({
        where: eq(schema.bankAccounts.tenantId, ctx.tenant.id),
        columns: { accountId: true, entityId: true },
      });
      const companies = await listEntities(tx, ctx.tenant.id, {
        includeInactive: true,
      });
      return { asset, parent, children, containers, kinds, depreciation, accounts, accumulated, schedules, maintWork, meter, teamMembers, registers, companies, attachments };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { asset, parent, children, containers, kinds, depreciation, accounts, accumulated, schedules, maintWork, meter, teamMembers, registers, companies, attachments } = data;
  // The picture per asset the founder asked for on 2026-08-15, arriving with
  // livestock's — one Layer 0 table, two packs. The FILE is the DMS's, so the
  // panel exists only where the DMS does.
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");
  const photos = attachments
    .filter((a) => isDisplayableImage(a.document.mimeType))
    .map((a) => ({
      documentId: a.document.id,
      fileName: a.document.fileName,
      title: a.document.title ?? "",
      mimeType: a.document.mimeType,
      isPrimary: a.isPrimary,
    }));
  const isOwner = ctx.role === "owner";
  /**
   * **IS THIS A DECISION, OR IS IT A CHORE?** (`src/lib/packs/authorize.ts`.)
   * Everything on this page that changes what the business OWNS is the owner's;
   * recording what happened to a thing that already exists is open to anyone
   * with a tenant context, **the accountant included** — `allowsWrite` clears
   * `expert` at member level deliberately.
   *
   * Asked of the same pure function the ops layer asks, rather than restated as
   * a role comparison here. A screen that spells the rule out in its own words
   * is a screen that can disagree with the server, which is what both of this
   * page's gates were doing.
   */
  const canRecord = allowsWrite(ctx.role, "member");
  /**
   * WHOSE BOOKS THIS ASSET IS ON. Undefined at one company, so nobody who has
   * never heard of the concept sees it — and shown otherwise, because this page
   * is where somebody presses Post depreciation and Dispose, and both write to
   * exactly one set of books.
   */
  const companyName =
    companies.length > 1
      ? (companies.find((c) => c.id === asset.entityId)?.name ?? null)
      : null;

  const dueTotal =
    depreciation?.due.reduce((s, r) => s + r.amountCents, 0) ?? 0;

  // Money is formatted HERE, on the server, so the client component never
  // needs a currency helper and can stay a dumb renderer.
  const depreciationView: DepreciationView = {
    method: asset.depreciationMethod,
    inServiceOn: asset.inServiceOn,
    usefulLifeMonths: asset.usefulLifeMonths,
    salvageInput:
      asset.salvageValueCents === null
        ? ""
        : (asset.salvageValueCents / 100).toFixed(2),
    costLabel:
      asset.acquisitionCostCents === null
        ? "not recorded"
        : formatMoney(asset.acquisitionCostCents, currencySymbol),
    postedToDateLabel: depreciation
      ? formatMoney(depreciation.postedToDateCents, currencySymbol)
      : null,
    bookValueLabel: depreciation
      ? formatMoney(depreciation.bookValueCents, currencySymbol)
      : null,
    dueCount: depreciation?.due.length ?? 0,
    dueTotalLabel: depreciation ? formatMoney(dueTotal, currencySymbol) : null,
    strandedCount: depreciation?.strandedCount ?? 0,
    catchUpPeriod: depreciation?.catchUpPeriod ?? null,
    currentPeriod,
    scheduleLength: depreciation?.schedule.length ?? 0,
    postedCount: depreciation?.postedPeriods.length ?? 0,
  };

  const view: AssetDetailView = {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    identifier: asset.identifier,
    model: asset.model,
    status: asset.status,
    acquiredOn: asset.acquiredOn,
    // Cents on the wire, dollars in the field. Empty string rather than "0"
    // when unknown — the two are different facts.
    costInput:
      asset.acquisitionCostCents === null
        ? ""
        : (asset.acquisitionCostCents / 100).toFixed(2),
    parentId: asset.parentId,
    notes: asset.notes,
    assetAccountId: asset.assetAccountId,
    isStorageLocation: asset.isStorageLocation,
    accumulatedLabel: formatMoney(accumulated, currencySymbol),
    bookValueLabel: formatMoney(
      (asset.acquisitionCostCents ?? 0) - accumulated,
      currencySymbol,
    ),
    // Mirrors postDisposal's own refusals, so the dialog can explain BEFORE
    // the button is pressed rather than after.
    cannotSettle:
      asset.acquisitionCostCents === null
        ? "no_cost"
        : !asset.assetAccountId
          ? "no_asset_account"
          : null,
  };

  // Fixed-asset accounts hold cost; bank, cash and receivable accounts are
  // where sale proceeds could land. Filtering here keeps the pickers honest
  // without the client needing to know the chart of accounts.
  const assetAccounts = accounts
    .filter((a) => a.isActive && a.subtype === "fixed_asset")
    .map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }));
  /**
   * Proceeds can land in a register, in AR, or in another current asset — but
   * ONLY IN THIS ASSET'S OWN COMPANY'S REGISTERS (ADR 0010).
   *
   * A disposal posts in the company that owns the asset, and `postEntry`
   * refuses a line touching another company's register, so an unfiltered list
   * offers a choice that always fails. That is the fifth time this shape has
   * come up — the recurring invoice coded to Checking, the invoice's Deposit-to,
   * the bill's Paid-from, the transfer dialog — so the register ids are
   * filtered here rather than discovered by somebody selling a tractor.
   *
   * Selling one company's asset and banking the money in another IS a real
   * thing, and it is intercompany: the same shape as the invoice and the bill.
   * It is not built, and offering the account without building it would be the
   * one option that cannot work.
   */
  const foreignRegisterIds = new Set(
    registers.filter((r) => r.entityId !== asset.entityId).map((r) => r.accountId),
  );
  const proceedsAccounts = accounts
    .filter(
      (a) =>
        a.isActive &&
        !foreignRegisterIds.has(a.id) &&
        ["bank", "cash", "accounts_receivable", "other_current_asset"].includes(
          a.subtype,
        ),
    )
    .map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }));

  const maintenanceView: MaintenanceView = {
    schedules: schedules.map((s) => ({
      id: s.schedule.id,
      name: s.schedule.name,
      summary: dueSummary(s.due, s.schedule.meterUnit),
      status: s.due.status,
      hasOpenWork: s.openWorkItemId !== null,
    })),
    work: maintWork.map((w) => ({
      id: w.id,
      title: w.title,
      dueOn: w.dueOn,
      assigneeClerkUserId: w.assigneeClerkUserId,
      completedAt: w.completedAt,
      version: w.version,
    })),
    currentMeter: meter?.reading ?? null,
    meterUnit: meter?.unit ?? "hours",
    // Only counts what has no work raised yet, so the button never offers to
    // raise something that is already on somebody's list.
    dueCount: schedules.filter(
      (s) => s.due.status === "due" && s.openWorkItemId === null,
    ).length,
    today,
  };

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All assets
      </Link>

      <PageHeader
        icon={<Wrench />}
        title={asset.name}
        description={
          <span className="flex items-center gap-2">
            {assetKindLabel(asset.kind)}
            {companyName && (
              <>
                <span className="text-muted-foreground">·</span>
                <span>{companyName}</span>
              </>
            )}
            {asset.status === "disposed" && (
              <Badge variant="outline">
                disposed {asset.disposedOn ?? ""}
              </Badge>
            )}
          </span>
        }
        actions={
          isOwner ? (
            <AssetControls
              asset={view}
              containers={containers.map((c) => ({ id: c.id, name: c.name }))}
              kindsInUse={kinds.map((k) => k.kind)}
              assetAccounts={assetAccounts}
              proceedsAccounts={proceedsAccounts}
              // The tenant's today, never the browser's, so two people in one
              // workspace agree what "today" means on a disposal.
              today={today}
            />
          ) : null
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">Details</h2>
          <div className="mt-3">
            <dl className="grid grid-cols-[9rem_1fr] gap-y-3 text-sm">
              <dt className="text-muted-foreground">Model</dt>
              <dd>{asset.model || "—"}</dd>

              <dt className="text-muted-foreground">Serial or tag</dt>
              <dd>{asset.identifier || "—"}</dd>

              <dt className="text-muted-foreground">Acquired</dt>
              <dd className="tabular-nums">{asset.acquiredOn ?? "—"}</dd>

              <dt className="text-muted-foreground">Cost</dt>
              <dd className="tabular-nums">
                {asset.acquisitionCostCents === null
                  ? "—"
                  : formatMoney(asset.acquisitionCostCents, currencySymbol)}
              </dd>

              <dt className="text-muted-foreground">Kept in</dt>
              <dd>
                {parent ? (
                  <Link
                    href={`${BASE}/${parent.id}`}
                    className="hover:underline"
                  >
                    {parent.name}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>

              {asset.notes && (
                <>
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap">{asset.notes}</dd>
                </>
              )}
            </dl>
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="font-heading text-base font-semibold tracking-heading">
              Contains {children.length > 0 && `(${children.length})`}
            </h2>
          <div className="mt-3">
            {children.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is kept in this one.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {children.map((child) => (
                  <li key={child.id} className="flex items-center gap-2">
                    <Link
                      href={`${BASE}/${child.id}`}
                      className="font-medium hover:underline"
                    >
                      {child.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {assetKindLabel(child.kind)}
                    </span>
                    {child.status === "disposed" && (
                      <Badge variant="outline">disposed</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <DepreciationPanel
          assetId={asset.id}
          view={depreciationView}
          canEdit={isOwner}
        />

        {/* **WHOEVER CHANGED THE OIL LOGS THE OIL CHANGE.** Two props, because
            this panel holds both kinds of act: setting a schedule up and
            raising jobs off it are decisions, and marking one done or reading
            the meter is what the person who did the work records. That was the
            ops layer's rule from the day it was written
            (`maintenance-ops.ts:379-385`) and this page passed `isOwner` to
            both halves anyway, so for three weeks no staff member could log a
            service. */}
        <MaintenancePanel
          assetId={asset.id}
          view={maintenanceView}
          members={teamMembers.map((m) => ({
            clerkUserId: m.clerkUserId,
            label: memberLabel(m),
          }))}
          canEdit={isOwner}
          canRecord={canRecord}
        />

        {documentsOn && (
          <Panel className="p-5">
            <h2 className="font-heading text-base font-semibold tracking-heading">
              Photos {photos.length > 0 && `(${photos.length})`}
            </h2>
            <div className="mt-3">
              {/* `canEdit` is NOT `isOwner`, unlike the panels above.
                  Editing an asset is a decision about what the business owns;
                  photographing one is a record of what is there, and the
                  person holding the phone in the yard is rarely the owner.

                  **TWO GATES, BOTH ASKED.** `canRecord` is the pack's answer
                  about a pack chore; `roleMayWrite` is the DMS's answer about a
                  row in `documents`, where the accountant is read-only by
                  design. On 2026-09-03 only the first was asked and the
                  accountant got an upload control that `registerAttachedPhoto`
                  refused. Both, or neither. */}
              <RecordPhotos
                entityId={asset.id}
                tenantId={ctx.tenant.id}
                photos={photos}
                canEdit={canRecord && roleMayWrite(ctx.role)}
                subject="asset"
                attachAction={attachAssetPhotoAction}
                setPrimaryAction={setAssetPhotoPrimaryAction}
                detachAction={detachAssetPhotoAction}
              />
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
