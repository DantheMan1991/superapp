"use client";

import Link from "next/link";
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
import { provisionWorkspace } from "../../actions";

export interface PartyOption {
  id: string;
  name: string;
}

export interface ProfileOption {
  slug: string;
  name: string;
  description: string;
}

const NO_PROFILE = "general";

/**
 * New workspace — provisioned FROM a party (ADR 0041, slice 3). The
 * relationship already exists in the operator's CRM; this makes the Clerk
 * organization, the tenant row and the pointer, installs a profile when one
 * is chosen, and invites the owner when an address is given.
 */
export function NewWorkspaceForm({
  parties,
  profiles,
}: {
  parties: PartyOption[];
  profiles: ProfileOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [partyId, setPartyId] = useState("");
  const [profileSlug, setProfileSlug] = useState(NO_PROFILE);

  function onSubmit(formData: FormData) {
    if (!partyId) {
      toast.error("Pick the business from the CRM first");
      return;
    }
    formData.set("partyId", partyId);
    formData.set("profileSlug", profileSlug === NO_PROFILE ? "" : profileSlug);
    startTransition(async () => {
      const result = await provisionWorkspace(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      if (result?.warning) toast.warning(result.warning);
      else toast.success("Workspace created");
      router.push(
        result?.tenantId ? `/admin/tenants/${result.tenantId}` : "/admin",
      );
    });
  }

  return (
    <form action={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label>Business</Label>
        <Select value={partyId} onValueChange={setPartyId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick from the operator's CRM…" />
          </SelectTrigger>
          <SelectContent>
            {parties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Only businesses without a workspace are listed. Not there yet? Add the
          company in the CRM first — a workspace is made for a relationship
          that already exists. Back to{" "}
          <Link href="/admin" className="underline hover:text-foreground">
            Clients
          </Link>
          .
        </p>
      </div>

      <div className="space-y-2">
        <Label>Industry profile</Label>
        <Select value={profileSlug} onValueChange={setProfileSlug}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROFILE}>
              General — no profile, core tools only
            </SelectItem>
            {profiles.map((p) => (
              <SelectItem key={p.slug} value={p.slug}>
                {p.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.description}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          A profile switches on its packs and sets the vocabulary. It can be
          installed later from the workspace&apos;s page.
        </p>
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

      <Button type="submit" disabled={pending || !partyId} className="w-full">
        {pending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}
