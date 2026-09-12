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
import { GRANT_DAYS, MAX_GRANTS_PER_PERSON } from "@/lib/device-grants/types";
import { addPhoneAction, revokePhoneAction } from "./actions";

export interface PhoneRow {
  id: string;
  label: string;
  platform: "ios" | "android";
  lastUsedAt: string | null;
  expiresAt: string;
}

/**
 * Set a phone up, and switch one off.
 *
 * THE TOKEN IS SHOWN EXACTLY ONCE and never again, because only its hash is
 * stored. The panel says so before it is minted rather than after, so nobody
 * closes the card expecting to find it later.
 */
export function PhoneControls({ phones }: { phones: PhoneRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const [minted, setMinted] = useState<string | null>(null);

  const full = phones.length >= MAX_GRANTS_PER_PERSON;

  function onAdd() {
    startTransition(async () => {
      const result = await addPhoneAction({ label, platform });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setMinted(result.data.token);
      setLabel("");
      router.refresh();
    });
  }

  function onRevoke(id: string, name: string) {
    startTransition(async () => {
      const result = await revokePhoneAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} can no longer speak to Yosher`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {minted ? (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <p className="text-sm font-medium">
            Put this in the phone now — you will not see it again.
          </p>
          <code className="block break-all rounded-md bg-background px-3 py-2 font-mono text-xs">
            {minted}
          </code>
          <p className="text-xs text-muted-foreground">
            Only a scrambled copy is stored here, so there is no way to show it
            a second time. Lost it? Switch this phone off and set it up again.
          </p>
          <Button variant="outline" size="sm" onClick={() => setMinted(null)}>
            I have saved it
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="phone-label">Which phone is it?</Label>
          <Input
            id="phone-label"
            value={label}
            maxLength={60}
            placeholder="Dan&rsquo;s iPhone"
            onChange={(e) => setLabel(e.target.value)}
            disabled={pending || full}
          />
        </div>
        <div className="w-40 space-y-2">
          <Label htmlFor="phone-platform">Kind</Label>
          <Select
            value={platform}
            onValueChange={(v) => setPlatform(v as "ios" | "android")}
            disabled={pending || full}
          >
            <SelectTrigger id="phone-platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ios">iPhone</SelectItem>
              <SelectItem value="android">Android</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onAdd} disabled={pending || full || label.trim() === ""}>
          Set up
        </Button>
      </div>

      {full ? (
        <p className="text-xs text-muted-foreground">
          That is {MAX_GRANTS_PER_PERSON} phones, which is the limit. Switch one
          off to set up another.
        </p>
      ) : null}

      {phones.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No phones set up yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {phones.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.label}</p>
                <p className="text-xs text-muted-foreground">
                  {p.platform === "ios" ? "iPhone" : "Android"} ·{" "}
                  {p.lastUsedAt
                    ? `last spoke ${p.lastUsedAt}`
                    : "has not spoken yet"}{" "}
                  · stops working {p.expiresAt} if unused
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => onRevoke(p.id, p.label)}
              >
                Switch off
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        A phone stops working {GRANT_DAYS} days after it last said anything, and
        straight away if you leave this business. Switching one off here takes
        effect the next time it tries to speak — nothing is sent to the phone
        itself.
      </p>
    </div>
  );
}
