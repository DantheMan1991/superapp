"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  addTenantNote,
  convertProspectToClient,
  setTenantStatus,
  toggleModule,
} from "../../actions";

const STATUSES = ["prospect", "onboarding", "active", "paused", "churned"] as const;

export function TenantStatusSelect({
  tenantId,
  status,
}: {
  tenantId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={status}
      disabled={pending}
      onValueChange={(next) =>
        startTransition(async () => {
          const res = await setTenantStatus({
            tenantId,
            status: next as (typeof STATUSES)[number],
          });
          if (res?.error) toast.error(res.error);
          else toast.success(`Status set to ${next}`);
        })
      }
    >
      <SelectTrigger className="w-36 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="capitalize">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ModuleToggle({
  tenantId,
  moduleId,
  enabled,
  available,
}: {
  tenantId: string;
  moduleId: string;
  enabled: boolean;
  available: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Switch
      checked={enabled}
      disabled={pending || !available}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const res = await toggleModule({ tenantId, moduleId, enabled: next });
          if (res?.error) toast.error(res.error);
          else toast.success(`${moduleId} ${next ? "enabled" : "disabled"}`);
        })
      }
      aria-label={`Toggle ${moduleId}`}
    />
  );
}

export function ConvertProspectForm({
  tenantId,
  contactEmail,
}: {
  tenantId: string;
  contactEmail: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await convertProspectToClient(formData);
          if (res?.error) toast.error(res.error);
          else if (res?.warning) toast.warning(res.warning);
          else toast.success("Converted — they're a client now");
        })
      }
      className="space-y-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <Input
        name="ownerEmail"
        type="email"
        defaultValue={contactEmail ?? ""}
        placeholder="owner@business.com (optional invite)"
      />
      <Button type="submit" size="sm" disabled={pending} className="w-full">
        {pending ? "Converting…" : "Convert to client"}
      </Button>
    </form>
  );
}

export function AddNoteForm({ tenantId }: { tenantId: string }) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await addTenantNote(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Note added");
            formRef.current?.reset();
          }
        })
      }
      className="space-y-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <Textarea
        name="body"
        placeholder="Call recap, next steps, gotchas…"
        required
        maxLength={5000}
        rows={3}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Add note"}
      </Button>
    </form>
  );
}
