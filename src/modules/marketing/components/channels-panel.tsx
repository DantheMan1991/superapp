"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, Pause, Pencil, Play, Plus, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { EmptyState } from "@/components/app/empty-state";
import { Panel } from "@/components/app/panel";
import { useConfirm } from "@/components/app/use-confirm";
import {
  AUDIENCE_MAX,
  CHANNEL_STATUS_LABELS,
  canEverConnect,
  channelDisplay,
  normalizeHandle,
  profileUrlFor,
  VOICE_MAX,
  type ChannelStatus,
} from "@/lib/social/channels";
import { SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/sites/links";
import {
  addChannelAction,
  editChannelAction,
  removeChannelAction,
  setChannelStatusAction,
  showChannelInFooterAction,
  type ChannelView,
} from "../social-actions";

/**
 * The accounts this brand posts to (slice S0, ADR 0047).
 *
 * ONE FORM FOR ADDING AND EDITING, because they take the same fields and a
 * second one would be a second place for the rule about `other`. The list is
 * the server's; every action refreshes the route rather than patching state,
 * so what is on screen is what is in the database.
 */
export interface ChannelsPanelProps {
  channels: ChannelView[];
  /** The website these belong to, or null for the business's own accounts. */
  siteId: string | null;
  /** What the footer of that website currently shows, to say when a mark is already there. */
  footerUrls: { network: string; url: string }[];
  canWrite: boolean;
}

const BLANK = {
  network: "facebook" as SocialNetwork,
  handle: "",
  label: "",
  profileUrl: "",
  audience: "",
  voice: "",
};

type Draft = typeof BLANK;

function draftFrom(c: ChannelView): Draft {
  return {
    network: c.network as SocialNetwork,
    handle: c.handle,
    label: c.label,
    profileUrl: c.profileUrl,
    audience: c.audience,
    voice: c.voice,
  };
}

/** Same comparison the server makes, so the row's badge and the action agree. */
function sameAccount(a: string, b: string): boolean {
  const tidy = (s: string) => s.trim().replace(/\/+$/, "").toLowerCase();
  return tidy(a) === tidy(b);
}

export function ChannelsPanel({ channels, siteId, footerUrls, canWrite }: ChannelsPanelProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: true } | { error: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      setAdding(false);
      setEditingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      <Panel
        isEmpty={channels.length === 0 && !adding}
        empty={
          <EmptyState
            icon={<Share2 className="size-5" />}
            title="No accounts yet"
            description={
              siteId
                ? "Add the accounts this website's brand posts from. Yosher keeps who reads each one and how it sounds there, so what it writes later fits the place it is going."
                : "Add the accounts the business posts from. If you run more than one brand, add each brand's accounts on its own website instead."
            }
            action={
              canWrite ? (
                <Button onClick={() => setAdding(true)}>
                  <Plus className="size-4" /> Add an account
                </Button>
              ) : undefined
            }
          />
        }
      >
        <ul className="divide-y divide-divider">
          {channels.map((c) => {
            const url = c.profileUrl || profileUrlFor(c.network as SocialNetwork, c.handle);
            const inFooter = footerUrls.some(
              (f) => f.network === c.network && sameAccount(f.url, url),
            );
            if (editingId === c.id) {
              return (
                <li key={c.id} className="p-4">
                  <ChannelForm
                    initial={draftFrom(c)}
                    pending={pending}
                    submitLabel="Save"
                    onCancel={() => setEditingId(null)}
                    onSubmit={(d) =>
                      run(() => editChannelAction({ id: c.id, ...d }), "Saved.")
                    }
                  />
                </li>
              );
            }
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {SOCIAL_NETWORK_LABELS[c.network as SocialNetwork]}
                    </span>
                    <span className="truncate text-sm text-subtle-foreground">
                      {channelDisplay({
                        network: c.network as SocialNetwork,
                        handle: c.handle,
                        label: c.label,
                      })}
                    </span>
                    {c.status === "paused" && (
                      <Badge variant="secondary">{CHANNEL_STATUS_LABELS.paused}</Badge>
                    )}
                    {inFooter && <Badge variant="outline">In the footer</Badge>}
                  </div>
                  {(c.audience || c.voice) && (
                    <p className="max-w-prose text-sm text-muted-foreground">
                      {[c.audience, c.voice].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-xs text-subtle-foreground hover:text-foreground"
                    >
                      {url} <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                {canWrite && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {siteId && !inFooter && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => showChannelInFooterAction({ id: c.id }),
                            "Added to the website's footer.",
                          )
                        }
                      >
                        Show in footer
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={c.status === "paused" ? "Start posting here" : "Pause this account"}
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            setChannelStatusAction({
                              id: c.id,
                              status: (c.status === "paused" ? "active" : "paused") as ChannelStatus,
                            }),
                          c.status === "paused" ? "Back on." : "Paused.",
                        )
                      }
                    >
                      {c.status === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit this account"
                      disabled={pending}
                      onClick={() => {
                        setAdding(false);
                        setEditingId(c.id);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove this account"
                      disabled={pending}
                      onClick={async () => {
                        const yes = await confirm({
                          title: `Remove ${channelDisplay({
                            network: c.network as SocialNetwork,
                            handle: c.handle,
                            label: c.label,
                          })}?`,
                          // Says the thing the ADR decided, where it matters.
                          description: inFooter
                            ? "Yosher stops offering this account. The mark stays in your website's footer until you remove it there — telling visitors where you are and posting there are two different things."
                            : "Yosher stops offering this account. Nothing on your website changes.",
                          confirmLabel: "Remove",
                          destructive: true,
                        });
                        if (!yes) return;
                        run(() => removeChannelAction({ id: c.id }), "Removed.");
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
          {adding && (
            <li className="p-4">
              <ChannelForm
                initial={BLANK}
                pending={pending}
                submitLabel="Add"
                onCancel={() => setAdding(false)}
                onSubmit={(d) =>
                  run(
                    () => addChannelAction({ siteId: siteId ?? "", ...d }),
                    "Account added.",
                  )
                }
              />
            </li>
          )}
        </ul>
      </Panel>
      {canWrite && !adding && channels.length > 0 && (
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Add an account
        </Button>
      )}
    </div>
  );
}

/**
 * The fields. The address is FILLED IN from the handle as it is typed and
 * stays editable — LinkedIn is `/company/` for a business and `/in/` for a
 * person, and YouTube honours several shapes, so a guess that cannot be
 * overwritten would be worse than no guess.
 */
function ChannelForm({
  initial,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  pending: boolean;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  // Empty means "use the guess", so the field shows the guess and the action
  // derives the same one. Typing over it makes the value the owner's.
  const guess = profileUrlFor(draft.network, draft.handle);
  const shown = draft.profileUrl || guess;
  const isOther = draft.network === "other";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="space-y-2">
          <Label htmlFor="channel-network">Network</Label>
          <Select
            value={draft.network}
            onValueChange={(v) =>
              setDraft((d) => ({
                ...d,
                network: v as SocialNetwork,
                // The old address belonged to the old network.
                profileUrl: "",
              }))
            }
          >
            <SelectTrigger id="channel-network" className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOCIAL_NETWORKS.map((n) => (
                <SelectItem key={n} value={n}>
                  {SOCIAL_NETWORK_LABELS[n]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="channel-handle">
            {isOther ? "Name on that site" : "Account name"}
          </Label>
          <Input
            id="channel-handle"
            value={draft.handle}
            maxLength={80}
            placeholder="oakrowfarm"
            onChange={(e) => setDraft((d) => ({ ...d, handle: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            Without the @. Yosher fills in the address below.
          </p>
        </div>
      </div>
      {isOther && (
        <div className="space-y-2">
          <Label htmlFor="channel-label">What to call it</Label>
          <Input
            id="channel-label"
            value={draft.label}
            maxLength={80}
            placeholder="Our Substack"
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="channel-url">Address</Label>
        <Input
          id="channel-url"
          value={shown}
          maxLength={500}
          placeholder="https://www.facebook.com/oakrowfarm"
          className="font-mono text-sm"
          onChange={(e) => setDraft((d) => ({ ...d, profileUrl: e.target.value }))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="channel-audience">Who reads this one</Label>
        <Textarea
          id="channel-audience"
          value={draft.audience}
          maxLength={AUDIENCE_MAX}
          rows={2}
          placeholder="Neighbours and regulars within an hour's drive. Most of them have bought from us at the market."
          onChange={(e) => setDraft((d) => ({ ...d, audience: e.target.value }))}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="channel-voice">How you sound here</Label>
        <Textarea
          id="channel-voice"
          value={draft.voice}
          maxLength={VOICE_MAX}
          rows={2}
          placeholder="Warm and plain. Short sentences, no exclamation marks, and we never call ourselves a brand."
          onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.value }))}
        />
        <p className="text-xs text-muted-foreground">
          Both are for later: when Yosher writes a post for this account, these two are what it
          reads first. Leave them blank for now if you would rather.
        </p>
      </div>
      {!canEverConnect(draft.network) && (
        <p className="text-sm text-muted-foreground">
          Yosher can plan and write for this one, and you post it yourself. It is the one kind of
          account Yosher will never be able to post to on its own.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={pending || normalizeHandle(draft.handle) === ""}
          onClick={() => onSubmit(draft)}
        >
          {submitLabel}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
