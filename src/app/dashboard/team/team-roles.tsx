"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setMemberAccountantAction } from "./actions";
import { setMemberAccessLevelAction } from "../settings/access/actions";

/** Radix refuses an empty string as a value, so "no level" carries a sentinel. */
const NO_LEVEL = "__none__";

export function AccountantToggle({
  membershipId,
  accountant,
}: {
  membershipId: string;
  accountant: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Switch
      checked={accountant}
      disabled={pending}
      onCheckedChange={(next) =>
        startTransition(async () => {
          const res = await setMemberAccountantAction({
            membershipId,
            accountant: next,
          });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success(
            next
              ? "Marked as accountant — read and review access only."
              : "Accountant access removed.",
          );
          router.refresh();
        })
      }
      aria-label="Accountant access"
    />
  );
}

/**
 * WHICH ACCESS LEVEL SOMEBODY IS ON (ADR 0093).
 *
 * A select rather than a switch, because the answer is one of several and
 * "none" is a real, ordinary choice rather than an off state — most people in
 * most workspaces will be on none for ever.
 *
 * It is NOT shown for an owner or for yourself. An owner cannot be put on a
 * level at all (Clerk owns owner-vs-member, and `drizzle/0085` refuses the
 * write), and "you can't change your own access" is the rule the accountant
 * toggle beside it already keeps — a locked-out owner with nobody else to
 * unlock them is a support call nothing in the product can answer.
 */
export function AccessLevelPicker({
  membershipId,
  levelId,
  levels,
}: {
  membershipId: string;
  levelId: string | null;
  levels: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Select
      value={levelId ?? NO_LEVEL}
      disabled={pending}
      onValueChange={(next) =>
        startTransition(async () => {
          const res = await setMemberAccessLevelAction({
            membershipId,
            levelId: next === NO_LEVEL ? null : next,
          });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success(
            next === NO_LEVEL
              ? "Back to reaching everything."
              : "Access level set.",
          );
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="w-[190px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LEVEL}>Everything</SelectItem>
        {levels.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
