"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createAuditEngagement } from "../actions";

export interface BusinessOption {
  id: string;
  name: string;
  industry: string;
  status: string;
}

export function NewAuditForm({
  businesses,
  preselectedId,
}: {
  businesses: BusinessOption[];
  preselectedId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState(preselectedId ?? "");

  function onSubmit(formData: FormData) {
    if (!tenantId) {
      toast.error("Pick a business from the CRM first");
      return;
    }
    formData.set("tenantId", tenantId);
    startTransition(async () => {
      const result = await createAuditEngagement(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      router.push(
        result?.auditId ? `/admin/audits/${result.auditId}` : "/admin/audits",
      );
    });
  }

  return (
    <form action={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label>Business</Label>
        <Select value={tenantId} onValueChange={setTenantId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick from the CRM…" />
          </SelectTrigger>
          <SelectContent>
            {businesses.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
                <span className="ml-2 text-xs text-muted-foreground capitalize">
                  {b.industry} · {b.status.replace("_", " ")}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Not in the CRM yet?{" "}
          <Link
            href="/admin/clients/new"
            className="underline hover:text-foreground"
          >
            Add the business first
          </Link>{" "}
          — every engagement hangs off a CRM record.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="context">
          What do you know going in?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="context"
          name="context"
          rows={5}
          maxLength={10000}
          placeholder="3-person crew, mostly driveways and patios. Referral from Dave. Complains about quoting jobs at night and chasing checks…"
        />
      </div>

      <Button
        type="submit"
        disabled={pending || !tenantId}
        className="w-full"
      >
        {pending ? "Creating…" : "Start discovery"}
      </Button>
    </form>
  );
}
