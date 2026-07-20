"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const INDUSTRIES = [
  { value: "real-estate", label: "Real estate (flipping / rentals)" },
  { value: "construction", label: "Construction / trades" },
  { value: "farm", label: "Farm / agriculture" },
  { value: "general", label: "Other / general" },
];

export function NewAuditForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [industry, setIndustry] = useState("construction");

  function onSubmit(formData: FormData) {
    formData.set("industry", industry);
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
        <Label htmlFor="businessName">Business name</Label>
        <Input
          id="businessName"
          name="businessName"
          placeholder="Rossi Concrete LLC"
          required
          minLength={2}
          maxLength={120}
        />
      </div>

      <div className="space-y-2">
        <Label>Industry</Label>
        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contactName">
          Contact{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="contactName"
          name="contactName"
          placeholder="Mike Rossi, owner"
          maxLength={120}
        />
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

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Start discovery"}
      </Button>
    </form>
  );
}
