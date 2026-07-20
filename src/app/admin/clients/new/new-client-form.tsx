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
import { createClientBusiness } from "../../actions";

const INDUSTRIES = [
  { value: "real-estate", label: "Real estate (flipping / rentals)" },
  { value: "construction", label: "Construction / trades" },
  { value: "farm", label: "Farm / agriculture" },
  { value: "general", label: "Other / general" },
];

export function NewClientForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [industry, setIndustry] = useState("construction");
  const [kind, setKind] = useState<"prospect" | "client">("prospect");

  function onSubmit(formData: FormData) {
    formData.set("industry", industry);
    formData.set("kind", kind);
    startTransition(async () => {
      const result = await createClientBusiness(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.warning) toast.warning(result.warning);
      else toast.success(kind === "prospect" ? "Prospect added" : "Client created");
      router.push(
        result?.tenantId ? `/admin/tenants/${result.tenantId}` : "/admin",
      );
    });
  }

  return (
    <form action={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label>Stage</Label>
        <Select
          value={kind}
          onValueChange={(v) => setKind(v as "prospect" | "client")}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="prospect">
              Prospect — CRM record only, no platform access yet
            </SelectItem>
            <SelectItem value="client">
              Client — creates their workspace, ready to onboard
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Prospects can be converted to clients later with one click — same
          record, history intact.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Business name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Maple Street Properties LLC"
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
          Contact person{" "}
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
        <Label htmlFor="ownerEmail">
          {kind === "client" ? "Owner email" : "Contact email"}{" "}
          <span className="font-normal text-muted-foreground">
            {kind === "client"
              ? "(optional — sends an invitation to join)"
              : "(optional — used when you convert them later)"}
          </span>
        </Label>
        <Input
          id="ownerEmail"
          name="ownerEmail"
          type="email"
          placeholder="owner@business.com"
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending
          ? "Saving…"
          : kind === "prospect"
            ? "Add prospect"
            : "Create client"}
      </Button>
    </form>
  );
}
