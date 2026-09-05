"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, Globe, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  domainReasonMessage,
  domainStatusLine,
  normalizeDomain,
  type DnsRecordToPublish,
  type SiteDomainStatus,
} from "@/lib/sites/domains";
import { cn } from "@/lib/utils";
import {
  checkDomainAction,
  connectDomainAction,
  removeDomainAction,
} from "../domain-actions";

export interface DomainRowView {
  id: string;
  domain: string;
  status: SiteDomainStatus;
  records: DnsRecordToPublish[];
  vercelVerified: boolean;
  vercelConfiguredBy: string;
  lastError: string;
  /** ISO string, or null. */
  lastCheckedAt: string | null;
}

/**
 * Connect a domain the business already owns, and read what to publish.
 * Nothing here decides a status: the row shows what Vercel last said, and
 * "Check again" asks it once more.
 */
export function ConnectDomainForm({
  enabled,
  platformHosts,
  siteDomain,
}: {
  enabled: boolean;
  platformHosts: string[];
  siteDomain: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const check = normalizeDomain(value, { platformHosts, siteDomain });
  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Connecting your own domain isn&rsquo;t switched on for this deployment yet. Your free
        address works in the meantime.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="connect-domain">Domain you own</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="connect-domain"
          value={value}
          maxLength={260}
          placeholder="www.example.com"
          className="max-w-sm font-mono"
          onChange={(e) => setValue(e.target.value)}
        />
        <Button
          disabled={pending || !check.ok}
          onClick={() =>
            startTransition(async () => {
              const result = await connectDomainAction({ domain: value });
              if ("error" in result) {
                toast.error(result.error);
                return;
              }
              toast.success(
                result.data?.status === "active"
                  ? "Connected and live."
                  : "Connected. Publish the records below at your registrar, then check again.",
              );
              setValue("");
              router.refresh();
            })
          }
        >
          <Globe className="size-4" />
          {pending ? "Connecting…" : "Connect"}
        </Button>
      </div>
      <p className={cn("text-xs", value === "" || check.ok ? "text-muted-foreground" : "text-destructive")}>
        {value === ""
          ? "Use the www address, like www.example.com. A bare domain works too, with an A record."
          : check.ok
            ? `Yosher will ask Vercel to serve ${check.domain}${check.apex ? " (an A record at your registrar)" : " (a CNAME at your registrar)"}.`
            : domainReasonMessage(check.reason)}
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<SiteDomainStatus, string> = {
  pending: "Waiting for DNS",
  active: "Live",
  error: "Needs attention",
};

export function DomainRow({ row, canWrite }: { row: DomainRowView; canWrite: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono">{row.domain}</span>
            <Badge
              variant={row.status === "error" ? "destructive" : row.status === "active" ? "outline" : "secondary"}
              className={row.status === "active" ? "border-transparent bg-success/15 text-emerald-700 dark:text-emerald-300" : undefined}
            >
              {STATUS_LABEL[row.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{domainStatusLine(row)}</p>
          {row.lastCheckedAt && (
            <p className="text-xs text-muted-foreground">
              Last checked {new Date(row.lastCheckedAt).toLocaleString()}
            </p>
          )}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await checkDomainAction({ id: row.id });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(
                    result.data?.status === "active" ? "Live. Visitors to this domain see your site." : "Checked. Not there yet.",
                  );
                  router.refresh();
                })
              }
            >
              {pending ? "Checking…" : "Check again"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (
                  !window.confirm(
                    `Disconnect ${row.domain}? Visitors to it stop seeing your site at once. Your free address keeps working.`,
                  )
                ) {
                  return;
                }
                startTransition(async () => {
                  const result = await removeDomainAction({ id: row.id });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Domain disconnected.");
                  router.refresh();
                });
              }}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          </div>
        )}
      </div>
      {row.status !== "active" && row.records.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm">
            At your registrar, where the domain&rsquo;s DNS is managed, add
            {row.records.length === 1 ? " this record" : " these records"}:
          </p>
          <RecordsTable records={row.records} />
        </div>
      )}
    </div>
  );
}

function RecordsTable({ records }: { records: DnsRecordToPublish[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy. Select the value and copy it by hand.");
    }
  }
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {records.map((r) => (
            <tr key={`${r.type}-${r.name}`}>
              <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
              <td className="px-3 py-2 font-mono text-xs break-all">{r.name}</td>
              <td className="max-w-md px-3 py-2 font-mono text-xs break-all">
                {r.value}
                <div className="mt-0.5 font-sans text-xs text-muted-foreground">{r.purpose}</div>
              </td>
              <td className="px-3 py-2 text-right">
                <Button variant="ghost" size="sm" aria-label={`Copy ${r.type} value`} onClick={() => copy(r.value)}>
                  {copied === r.value ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
