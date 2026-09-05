"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteEnquiryAction } from "../enquiry-actions";

export interface EnquiryRowView {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  /** The business's own questions, answered, in the order asked. */
  answers: { label: string; value: string }[];
  pagePath: string;
  /** Already formatted in the workspace's timezone. */
  receivedOn: string;
  partyId: string | null;
  /** Null when the contact no longer exists. */
  partyName: string | null;
  workItemId: string | null;
  followUp: "open" | "done" | "gone" | "none";
  notifyVia: string;
}

/**
 * The messages the site's form received, newest first, with where each one
 * went. Everything an enquiry became lives elsewhere — the contact in CRM,
 * the follow-up in Work — so every row links out; only removing the record
 * of the message happens here.
 */
export function EnquiriesPanel({
  rows,
  canWrite,
  crmOn,
  workOn,
}: {
  rows: EnquiryRowView[];
  canWrite: boolean;
  /** Where the contact and the follow-up can be opened. A switched-off
   *  module's page is a 404, so its link is not offered; the follow-up and
   *  the record exist either way (ADR 0021). */
  crmOn: boolean;
  workOn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No messages yet. When someone fills in the form on your site, it lands here.
      </p>
    );
  }

  const remove = (row: EnquiryRowView) => {
    if (
      !window.confirm(
        `Remove the message from ${row.name}? The contact and the follow-up it made stay where they are.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteEnquiryAction({ id: row.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Message removed.");
      router.refresh();
    });
  };

  return (
    <ul className="divide-y divide-divider">
      {rows.map((row) => {
        const expanded = open === row.id;
        return (
          <li key={row.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-sm text-muted-foreground">{row.receivedOn}</span>
                  <FollowUpBadge state={row.followUp} />
                </div>
                <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                  <a href={`mailto:${row.email}`} className="underline-offset-4 hover:underline">
                    {row.email}
                  </a>
                  {row.phone && (
                    <a href={`tel:${row.phone}`} className="underline-offset-4 hover:underline">
                      {row.phone}
                    </a>
                  )}
                  {row.pagePath !== "/" && <span>from {row.pagePath}</span>}
                </div>
                {row.answers.length > 0 && (
                  <dl className="text-sm">
                    {row.answers.map((a, i) => (
                      <div key={i}>
                        <dt className="inline text-muted-foreground">{a.label}: </dt>
                        <dd className="inline whitespace-pre-line">{a.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className={expanded ? "whitespace-pre-line text-sm" : "truncate text-sm"}>
                  {row.message}
                </p>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => setOpen(expanded ? null : row.id)}
                >
                  {expanded ? "Show less" : "Show the whole message"}
                </button>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {workOn && row.workItemId && row.followUp !== "gone" && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/m/work?item=${row.workItemId}`}>Follow-up</Link>
                  </Button>
                )}
                {crmOn && row.partyId && row.partyName && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/m/crm/records/${row.partyId}`}>Contact</Link>
                  </Button>
                )}
                {canWrite && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={`Remove the message from ${row.name}`}
                    onClick={() => remove(row)}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{whereItWent(row, crmOn)}</p>
          </li>
        );
      })}
    </ul>
  );
}

function FollowUpBadge({ state }: { state: EnquiryRowView["followUp"] }) {
  switch (state) {
    case "open":
      return (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
          to reply
        </Badge>
      );
    case "done":
      return (
        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
          replied
        </Badge>
      );
    case "gone":
      return <Badge variant="outline">follow-up removed</Badge>;
    case "none":
      return null;
  }
}

function whereItWent(row: EnquiryRowView, crmOn: boolean): string {
  const parts: string[] = [];
  if (row.partyId) {
    parts.push(
      row.partyName
        ? crmOn
          ? `Contact: ${row.partyName}.`
          : `Saved as ${row.partyName} in your contacts.`
        : "The contact it made has since been removed.",
    );
  }
  switch (row.notifyVia) {
    case "site_email":
      parts.push("Emailed to the site's email address.");
      break;
    case "owners":
      parts.push("Emailed to the owners; add an email to the site's details to send it there instead.");
      break;
    default:
      parts.push("Not emailed: the site has no email address and no owner has one.");
  }
  return parts.join(" ");
}
