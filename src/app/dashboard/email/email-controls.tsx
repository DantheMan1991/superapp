"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { EmailDnsRecord } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  checkDomainAction,
  connectDomainAction,
  disconnectDomainAction,
  sendTestEmailAction,
} from "./actions";

export function ConnectDomainForm() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [localPart, setLocalPart] = useState("notifications");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await connectDomainAction({
            domain,
            fromLocalPart: localPart,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          if (result.data?.warning) toast.warning(result.data.warning);
          toast.success("Domain added — now add the DNS records below");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          <Label htmlFor="local-part">Send as</Label>
          <Input
            id="local-part"
            value={localPart}
            maxLength={63}
            onChange={(e) => setLocalPart(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="domain">At domain</Label>
          <Input
            id="domain"
            value={domain}
            maxLength={253}
            placeholder="mail.yourcompany.com"
            onChange={(e) => setDomain(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A subdomain such as <code>mail.yourcompany.com</code> is best — it keeps
        this mail&apos;s reputation separate from the address you use every day,
        so a bad send can never affect your normal email.
      </p>
      <Button type="submit" disabled={pending || domain.trim().length < 4}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Add domain
      </Button>
    </form>
  );
}

export function DnsRecords({ records }: { records: EmailDnsRecord[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No records to add yet — check again in a moment.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Value</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={`${record.type}-${record.name}`}>
              <TableCell className="font-mono text-xs">{record.type}</TableCell>
              <TableCell className="font-mono text-xs break-all">
                {record.name}
              </TableCell>
              <TableCell className="max-w-md font-mono text-xs break-all">
                {record.value}
                {record.priority !== undefined && (
                  <span className="ml-2 text-muted-foreground">
                    priority {record.priority}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Copy ${record.type} value`}
                  onClick={() => {
                    void navigator.clipboard.writeText(record.value);
                    setCopied(record.name);
                    toast.success("Copied");
                  }}
                >
                  {copied === record.name ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DomainActions({ verified }: { verified: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {!verified && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await checkDomainAction();
              if ("error" in result) {
                toast.error(result.error);
                return;
              }
              if (result.data?.status === "verified") {
                toast.success("Verified — your mail now sends from your domain");
              } else {
                toast.info(
                  "Not verified yet. DNS changes can take up to an hour to spread.",
                );
              }
              router.refresh();
            })
          }
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Check DNS
        </Button>
      )}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await disconnectDomainAction();
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("Disconnected — mail falls back to the Yosher address");
            router.refresh();
          })
        }
      >
        Disconnect
      </Button>
    </div>
  );
}

export function SendTestForm() {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await sendTestEmailAction({ to });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(
            result.data?.duplicate
              ? "Already sent that one — check your inbox"
              : `Sent from ${result.data?.sentFrom}`,
          );
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="test-to">Send a test to</Label>
        <Input
          id="test-to"
          type="email"
          value={to}
          maxLength={254}
          placeholder="you@yourcompany.com"
          onChange={(e) => setTo(e.target.value)}
          className="w-64"
        />
      </div>
      <Button type="submit" variant="outline" disabled={pending || to.length < 6}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Send test
      </Button>
    </form>
  );
}
