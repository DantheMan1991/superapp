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
  { value: "general", label: "Other / general" },
];

export function NewClientForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [industry, setIndustry] = useState("real-estate");

  function onSubmit(formData: FormData) {
    formData.set("industry", industry);
    startTransition(async () => {
      const result = await createClientBusiness(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.warning) toast.warning(result.warning);
      else toast.success("Client created");
      router.push(
        result?.tenantId ? `/admin/tenants/${result.tenantId}` : "/admin",
      );
    });
  }

  return (
    <form action={onSubmit} className="space-y-5">
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
        <Label htmlFor="ownerEmail">
          Owner email{" "}
          <span className="font-normal text-muted-foreground">
            (optional — sends an invitation to join)
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
        {pending ? "Creating…" : "Create client"}
      </Button>
    </form>
  );
}
