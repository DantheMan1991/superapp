"use client";

import { useRef, useState, useTransition } from "react";
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
  installProfile,
  setTenantLabels,
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
  canToggle,
}: {
  tenantId: string;
  moduleId: string;
  enabled: boolean;
  /**
   * Whether the module has a renderer — NOT whether it is sellable.
   *
   * Named for the question it answers after the two were separated on
   * 2026-08-09; it was `available`, which read as the catalog state and
   * therefore got the catalog's value, leaving an implemented module
   * un-switchable. See the comment in page.tsx.
   */
  canToggle: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Switch
      checked={enabled}
      disabled={pending || !canToggle}
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

/**
 * Install an industry profile.
 *
 * `installProfile` has existed, superadmin-guarded and audited, since Layer 2
 * shipped — with NO CALLER. A profile could only be installed by invoking the
 * action directly, which is why the pilot tenant ran four packs for a day with
 * `industry` still set to `general` and every profile-supplied word and setting
 * missing. This is the button.
 */
export function ProfileInstaller({
  tenantId,
  currentIndustry,
  profiles,
}: {
  tenantId: string;
  currentIndustry: string;
  profiles: { slug: string; name: string; description: string; packs: string[] }[];
}) {
  const [pending, startTransition] = useTransition();
  const [slug, setSlug] = useState(
    profiles.some((p) => p.slug === currentIndustry) ? currentIndustry : "",
  );
  const chosen = profiles.find((p) => p.slug === slug);
  const already = currentIndustry === slug;

  return (
    <div className="space-y-3">
      <Select value={slug} onValueChange={setSlug}>
        <SelectTrigger>
          <SelectValue placeholder="Pick a profile" />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((p) => (
            <SelectItem key={p.slug} value={p.slug}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {chosen && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{chosen.description}</p>
          <p>
            {/* Named before the button is pressed. Installing switches on
                every pack listed, and that is a change to what the client
                sees. */}
            Switches on: {chosen.packs.join(", ")}.
          </p>
          <p>
            Installing is additive and can be re-run — it never switches
            anything off, because a pack the tenant disabled is a decision
            rather than drift.
          </p>
        </div>
      )}

      <Button
        size="sm"
        disabled={pending || !slug}
        onClick={() =>
          startTransition(async () => {
            const result = await installProfile({ tenantId, profileSlug: slug });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            // What CHANGED, not what the profile lists. A re-run that switched
            // nothing on used to report the full list, which made an idempotent
            // button look like it had done something.
            const on = result.switchedOn?.length ?? 0;
            const listed = result.installed?.length ?? 0;
            toast.success(
              on === 0
                ? `Installed — nothing to change, all ${listed} packs were already on`
                : `Installed — ${on} of ${listed} packs switched on`,
            );
          })
        }
      >
        {pending
          ? "Installing…"
          : already
            ? "Re-run install"
            : "Install profile"}
      </Button>
    </div>
  );
}

/**
 * Edit a tenant's vocabulary.
 *
 * The fields come from what the FEATURES declare, so this screen lists exactly
 * what is renameable rather than requiring somebody to know. Before the
 * registry existed the answer to "what words can I change" was a grep for
 * `labelFor`, and the honest answer was "one".
 */
export function VocabularyEditor({
  tenantId,
  labels,
  values,
}: {
  tenantId: string;
  labels: {
    key: string;
    /** The pack's own built-in word. */
    fallback: string;
    describes: string;
    ownerName?: string;
    /** What an EMPTY box means — the profile's word, or the pack's. */
    inherited: string;
    /** The profile supplying `inherited`, or null when it is the pack's own. */
    inheritedFrom: string | null;
  }[];
  values: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>(values);

  if (labels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No features with renameable words are switched on for this client.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {labels.map((label) => (
        <div key={label.key} className="grid gap-1">
          <label
            htmlFor={`label-${label.key}`}
            className="text-sm font-medium"
          >
            {/* The word the CLIENT sees, not the pack's. This heading read
                "Zone" on a farm whose every screen said "Paddock". */}
            {draft[label.key]?.trim() || label.inherited}
            {label.ownerName && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {label.ownerName}
              </span>
            )}
          </label>
          <Input
            id={`label-${label.key}`}
            value={draft[label.key] ?? ""}
            placeholder={label.inherited}
            maxLength={60}
            onChange={(e) =>
              setDraft((d) => ({ ...d, [label.key]: e.target.value }))
            }
          />
          <p className="text-xs text-muted-foreground">
            {label.describes}
            {label.inheritedFrom && (
              // Where the word came from, so clearing the box is a known
              // outcome rather than a guess. Only shown when a profile is
              // actually overriding the pack — otherwise it is noise.
              <>
                {" "}
                <span className="text-foreground/70">
                  {label.inheritedFrom} calls this {label.inherited}; the
                  built-in word is {label.fallback}.
                </span>
              </>
            )}
          </p>
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        {/* Empty means the inherited word, and saying so is what stops somebody
            typing that word back in to "clear" it. */}
        Leave a field empty to use the word already shown in it. Changes apply
        everywhere that word appears, immediately.
      </p>

      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setTenantLabels({ tenantId, labels: draft });
            if ("error" in result) toast.error(result.error);
            else toast.success("Vocabulary saved");
          })
        }
      >
        {pending ? "Saving…" : "Save vocabulary"}
      </Button>
    </div>
  );
}
