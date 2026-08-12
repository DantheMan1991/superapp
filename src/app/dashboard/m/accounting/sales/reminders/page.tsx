import { and, eq, inArray, isNotNull, like } from "drizzle-orm";
import { BellRing } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { todayInTimezone } from "@/lib/timezone";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getReminderSettings } from "@/modules/accounting/invoicing/reminders";
import {
  describeOffset,
  nextReminder,
  REMINDER_SEND_HOUR,
} from "@/modules/accounting/invoicing/reminder-schedule";
import {
  reminderKeyPrefix,
  sentOffsetsFromKeys,
} from "@/modules/accounting/invoicing/reminder-email";
import { formatCentsSigned } from "@/modules/accounting/lib/money";
import { SalesNav } from "../sales-nav";
import { ReminderSettingsForm } from "./reminder-controls";

export const dynamic = "force-dynamic";

const CHASEABLE = ["issued", "partial"] as const;

export default async function RemindersPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const settings = await getReminderSettings(tx, ctx.tenant.id);

    // The same selection the sweep makes, so the preview cannot disagree with
    // what actually goes out — including both mutes.
    const candidates = await tx
      .select({
        id: schema.invoices.id,
        number: schema.invoices.invoiceNumber,
        dueDate: schema.invoices.dueDate,
        totalCents: schema.invoices.totalCents,
        customerName: schema.customers.name,
      })
      .from(schema.invoices)
      .innerJoin(
        schema.customers,
        and(
          eq(schema.customers.tenantId, schema.invoices.tenantId),
          eq(schema.customers.id, schema.invoices.customerId),
        ),
      )
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenant.id),
          inArray(schema.invoices.status, [...CHASEABLE]),
          isNotNull(schema.invoices.dueDate),
          eq(schema.invoices.remindersMuted, false),
          eq(schema.customers.remindersMuted, false),
        ),
      );

    if (candidates.length === 0) return { settings, upcoming: [] };

    const ids = candidates.map((c) => c.id);
    const [payments, sends] = await Promise.all([
      tx
        .select({
          invoiceId: schema.invoicePayments.invoiceId,
          amountCents: schema.invoicePayments.amountCents,
        })
        .from(schema.invoicePayments)
        .where(
          and(
            eq(schema.invoicePayments.tenantId, ctx.tenant.id),
            inArray(schema.invoicePayments.invoiceId, ids),
          ),
        ),
      tx
        .select({ idempotencyKey: schema.outboundEmails.idempotencyKey })
        .from(schema.outboundEmails)
        .where(
          and(
            eq(schema.outboundEmails.tenantId, ctx.tenant.id),
            eq(schema.outboundEmails.kind, "invoice_reminder"),
            like(schema.outboundEmails.idempotencyKey, "reminder:%"),
          ),
        ),
    ]);

    const paid = new Map<string, number>();
    for (const p of payments) {
      paid.set(p.invoiceId, (paid.get(p.invoiceId) ?? 0) + p.amountCents);
    }

    const upcoming = candidates
      .map((c) => {
        const balanceCents = c.totalCents - (paid.get(c.id) ?? 0);
        if (balanceCents <= 0) return null;
        const keys = sends
          .map((s) => s.idempotencyKey)
          .filter((k) => k.startsWith(reminderKeyPrefix(c.id)));
        const next = nextReminder({
          dueDate: c.dueDate,
          today,
          offsets: settings.offsets,
          sentOffsets: sentOffsetsFromKeys(keys),
        });
        if (next === null) return null;
        return {
          id: c.id,
          number: c.number,
          customerName: c.customerName,
          dueDate: c.dueDate!,
          balanceCents,
          next,
          sentCount: keys.length,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.next.date.localeCompare(b.next.date));

    return { settings, upcoming };
  });

  const isOwner = ctx.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reminders"
        description={`Chase unpaid invoices on a schedule you set. Reminders go out around ${REMINDER_SEND_HOUR}am in your business's timezone.`}
        actions={
          <Badge variant={data.settings.enabled ? "default" : "outline"}>
            {data.settings.enabled ? "On" : "Off"}
          </Badge>
        }
      />

      <AccountingNav />
      <SalesNav />

      <Panel>
        {isOwner ? (
          <ReminderSettingsForm
            initialEnabled={data.settings.enabled}
            initialOffsets={data.settings.offsets}
          />
        ) : (
          <div className="space-y-2 p-5">
            <p className="text-sm font-medium">
              Reminders are {data.settings.enabled ? "on" : "off"}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.settings.offsets.length === 0
                ? "No schedule set."
                : data.settings.offsets.map(describeOffset).join(" · ")}
            </p>
            <p className="text-xs text-subtle-foreground">
              Only the owner can change this.
            </p>
          </div>
        )}
      </Panel>

      <div className="space-y-3">
        <h2 className="text-sm font-medium tracking-heading">
          Next reminders
          {!data.settings.enabled && (
            <span className="ml-2 font-normal text-muted-foreground">
              — nothing will send while reminders are off
            </span>
          )}
        </h2>

        <DataTable
          isEmpty={data.upcoming.length === 0}
          empty={
            <EmptyState
              icon={<BellRing />}
              title="Nothing to chase"
              description="Invoices appear here once they are issued, unpaid, and have a due date the schedule can act on."
            />
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-subtle-foreground">
                <th className="px-4 py-2 font-medium">Invoice</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Due</th>
                <th className="px-4 py-2 text-right font-medium">Balance</th>
                <th className="px-4 py-2 font-medium">Next reminder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {data.upcoming.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-muted/60">
                  <td className="px-4 py-3 font-medium">
                    <a
                      href={`/dashboard/m/accounting/sales/invoices/${row.id}`}
                      className="hover:underline"
                    >
                      {row.number}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.customerName}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                    {row.dueDate}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCentsSigned(row.balanceCents)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs tabular-nums">
                      {row.next.date}
                    </span>
                    <span className="ml-2 text-xs text-subtle-foreground">
                      {describeOffset(row.next.offset)}
                      {row.sentCount > 0 &&
                        ` · ${row.sentCount} sent`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </div>
    </div>
  );
}
