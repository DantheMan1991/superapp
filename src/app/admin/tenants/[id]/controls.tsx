"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  installProfile,
  setTenantLabels,
  setTenantStatus,
  toggleModule,
} from "../../actions";
import { operatorRefusal } from "@/lib/operator-guard";

// `prospect` left with back-office slice 3: a business without a workspace is
// a party in the operator's CRM, never a tenant row.
const STATUSES = ["onboarding", "active", "paused", "churned"] as const;

export function TenantStatusSelect({
  tenantId,
  status,
  isOperator,
}: {
  tenantId: string;
  status: string;
  isOperator: boolean;
}) {
  const [pending, startTransition] = useTransition();

  // Where the control is the point, a refused control is not drawn: the
  // sentence the action would answer with stands in its place, from the same
  // predicate the action calls (src/lib/operator-guard.ts).
  const refusal = operatorRefusal({ isOperator }, "status");
  if (refusal) {
    return <p className="max-w-56 text-xs text-muted-foreground">{refusal}</p>;
  }

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
  isOperator,
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
  /** The operator tenant's features stay on: the off-switch is not offered. */
  isOperator: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const stayOn =
    enabled && operatorRefusal({ isOperator }, "moduleOff") !== null;

  return (
    <Switch
      checked={enabled}
      disabled={pending || !canToggle || stayOn}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const res = await toggleModule({ tenantId, moduleId, enabled: next });
          if (res?.error) toast.error(res.error);
          else if (res?.warning) toast.warning(res.warning);
          else toast.success(`${moduleId} ${next ? "enabled" : "disabled"}`);
        })
      }
      aria-label={`Toggle ${moduleId}`}
    />
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
 *
 * ── IT TELLS THE TRUTH ABOUT BEING ADDITIVE ─────────────────────────────────
 *
 * Installing does not BIND (ADR 0009): it switches a profile's packs on and
 * seeds, and a client may perfectly well run two profiles' packs at once. The
 * screen denied that. One select, "Installed: construction", and a button that
 * said *Install profile* for any profile other than the stamped one — so the
 * founder's own reading of it was "I don't see how to install multiple
 * industries", when he already had.
 *
 * Now every profile shows how much of it is ON, which is the fact that answers
 * "what is this client running". `tenants.industry` is named for what it really
 * decides — the WORDS — because that is the one thing which genuinely cannot
 * stack: labels are tenant-wide by a deliberate correction (a paddock is a
 * paddock everywhere on a farm), so the last profile installed supplies them.
 */
export function ProfileInstaller({
  tenantId,
  currentIndustry,
  profiles,
}: {
  tenantId: string;
  currentIndustry: string;
  profiles: {
    slug: string;
    name: string;
    description: string;
    packs: string[];
    /** Which of `packs` are already switched on for this client. */
    packsOn: string[];
    /** What the profile contributes on install, counted (slice 7a); a line per pack seed (ADR 0057). */
    seed: { accounts: number; folders: number; packs: string[] };
  }[];
}) {
  const [pending, startTransition] = useTransition();
  const [slug, setSlug] = useState(
    profiles.some((p) => p.slug === currentIndustry) ? currentIndustry : "",
  );
  const chosen = profiles.find((p) => p.slug === slug);
  /** Every pack it lists is already on — installed in the only sense that shows. */
  const fullyOn = chosen !== undefined && chosen.packsOn.length === chosen.packs.length;
  const speaksFor = profiles.find((p) => p.slug === currentIndustry);

  return (
    <div className="space-y-3">
      {/*
        The state of every profile at a glance, which is what "does this client
        run more than one industry" actually asks. A profile with all its packs
        on is installed whether or not it is the one supplying the words.
      */}
      <ul className="space-y-1 text-sm">
        {profiles.map((p) => (
          <li key={p.slug} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.name}</span>
            {p.packsOn.length === p.packs.length ? (
              <Badge variant="secondary" className="bg-success/15 text-success-foreground">
                All {p.packs.length} packs on
              </Badge>
            ) : p.packsOn.length > 0 ? (
              <Badge variant="secondary" className="bg-warning/15 text-warning-foreground">
                {p.packsOn.length} of {p.packs.length} packs on
              </Badge>
            ) : (
              <Badge variant="outline">Not installed</Badge>
            )}
            {p.slug === currentIndustry && (
              <span className="text-xs text-muted-foreground">supplies the words</span>
            )}
          </li>
        ))}
      </ul>

      <Select value={slug} onValueChange={setSlug}>
        <SelectTrigger>
          <SelectValue placeholder="Install another profile" />
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
          {(chosen.seed.accounts > 0 ||
            chosen.seed.folders > 0 ||
            chosen.seed.packs.length > 0) && (
            <p>
              {/* The seed, named before the button too: a chart of accounts
                  landing in a client's books is a change they will notice. */}
              Adds{" "}
              {[
                chosen.seed.accounts > 0 &&
                  `${chosen.seed.accounts} account${chosen.seed.accounts === 1 ? "" : "s"} to the chart`,
                chosen.seed.folders > 0 &&
                  `${chosen.seed.folders} folder${chosen.seed.folders === 1 ? "" : "s"}`,
                ...chosen.seed.packs,
              ]
                .filter(Boolean)
                .join(" and ")}
              , when those modules are on — and when they are switched on
              later.
            </p>
          )}
          <p>
            Installing is additive and can be re-run — it never switches
            anything off, because a pack the tenant disabled is a decision
            rather than drift. The client keeps every pack it already has.
          </p>
          {/*
            The one thing that does NOT stack, said before the button rather
            than discovered afterwards: there is a single vocabulary per client.
          */}
          {speaksFor && speaksFor.slug !== chosen.slug && (
            <p className="text-warning-foreground">
              The words change: {chosen.name}
              {" "}
              becomes this client&apos;s vocabulary in place of{" "}
              {speaksFor.name}. Anything renamed by hand on the Vocabulary card
              below is kept.
            </p>
          )}
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
            const seeded = result.seeded;
            const added = [
              seeded && seeded.accountsCreated > 0 && `${seeded.accountsCreated} accounts added`,
              seeded && seeded.foldersCreated > 0 && `${seeded.foldersCreated} folders added`,
              ...(seeded?.packs.map((p) => `${p.description} added`) ?? []),
            ].filter(Boolean);
            const waiting =
              seeded && seeded.waitingOn.length > 0
                ? `; the seed for ${seeded.waitingOn.join(" and ")} waits until switched on`
                : "";
            toast.success(
              (on === 0
                ? `Installed — nothing to change, all ${listed} packs were already on`
                : `Installed — ${on} of ${listed} packs switched on`) +
                (added.length > 0 ? `; ${added.join(", ")}` : "") +
                waiting,
            );
          })
        }
      >
        {pending
          ? "Installing…"
          : fullyOn
            ? "Re-run install"
            : chosen && chosen.packsOn.length > 0
              ? `Switch on the other ${chosen.packs.length - chosen.packsOn.length}`
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
