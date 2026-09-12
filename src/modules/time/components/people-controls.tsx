"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addWorkerAction,
  setOvertimeRulesetAction,
  setPayFrequencyAction,
  setPostsLaborAction,
  setRoundingAction,
  setWeekStartsOnAction,
  setWorkerActiveAction,
  setWorkerUserAction,
} from "../actions";
import { PAY_FREQUENCIES, payFrequencyLabel } from "../core/periods";
import { ROUNDING_CHOICES, roundingLabel } from "../core/rounding";
import { RULESETS, rulesetFor } from "../core/rulesets";
import { WEEKDAYS } from "../core/week";

export interface PersonOption {
  id: string;
  name: string;
}

export interface MemberOption {
  clerkUserId: string;
  label: string;
}

const NEW_PERSON = "__new__";
const NO_SIGN_IN = "__none__";

/**
 * Add somebody whose hours the business records.
 *
 * TWO DOORS, because there are two kinds of new worker. Somebody the business
 * already deals with — a subcontractor who is also a vendor — should become a
 * worker without a second record of the same human being; that is the whole
 * point of hanging this off the party spine. Somebody nobody has ever invoiced
 * should need nothing but a name.
 */
export function AddWorker({
  people,
  members,
}: {
  /** People already on the party spine who are not workers yet. */
  people: PersonOption[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [who, setWho] = useState(NEW_PERSON);
  const [signIn, setSignIn] = useState(NO_SIGN_IN);

  function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (who === NEW_PERSON && !name) {
      toast.error("Give the person a name.");
      return;
    }
    startTransition(async () => {
      const result = await addWorkerAction({
        partyId: who === NEW_PERSON ? null : who,
        name: who === NEW_PERSON ? name : undefined,
        clerkUserId: signIn === NO_SIGN_IN ? null : signIn,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setOpen(false);
      setWho(NEW_PERSON);
      setSignIn(NO_SIGN_IN);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add someone</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add someone</DialogTitle>
            <DialogDescription>
              Anybody whose hours you want to keep. They do not need to be able
              to sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="who">Who</Label>
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger id="who">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_PERSON}>Somebody new</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {people.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  People you already deal with are listed here, so nobody ends
                  up in your records twice.
                </p>
              )}
            </div>
            {who === NEW_PERSON && (
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" maxLength={120} autoFocus />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="signIn">Signs in as</Label>
              <Select value={signIn} onValueChange={setSignIn}>
                <SelectTrigger id="signIn">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SIGN_IN}>Nobody — they do not use the app</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Linking a sign-in means their own time is the one the Log time
                box offers first.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mark that somebody has left, or bring them back.
 *
 * NEVER A DELETE, and the button says "Has left" rather than "Remove" for that
 * reason: their hours are what the business paid, and nothing on this screen
 * should suggest those can be made to disappear.
 */
export function WorkerActiveButton({
  workerId,
  version,
  isActive,
  name,
}: {
  workerId: string;
  version: number;
  isActive: boolean;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setWorkerActiveAction({
            workerId,
            expectedVersion: version,
            isActive: !isActive,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(isActive ? `${name} marked as left` : `${name} is back`);
          router.refresh();
        })
      }
    >
      {isActive ? "Has left" : "Bring back"}
    </Button>
  );
}

/** Link a worker to the sign-in they use, or unlink them. */
export function WorkerSignInPicker({
  workerId,
  version,
  clerkUserId,
  members,
}: {
  workerId: string;
  version: number;
  clerkUserId: string | null;
  members: MemberOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      disabled={pending}
      value={clerkUserId ?? NO_SIGN_IN}
      onValueChange={(value) =>
        startTransition(async () => {
          const result = await setWorkerUserAction({
            workerId,
            expectedVersion: version,
            clerkUserId: value === NO_SIGN_IN ? null : value,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Saved");
          router.refresh();
        })
      }
    >
      <SelectTrigger className="h-8 w-[220px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_SIGN_IN}>No sign-in</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Which day the week starts on.
 *
 * Looks like a display preference and is not. From slice 2 this is the anchor
 * of the workweek — the fixed recurring period overtime is computed over, which
 * is not the pay period — so the sentence under it says what it is for rather
 * than what it does.
 */
export function WeekStartPicker({ weekStartsOn }: { weekStartsOn: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        disabled={pending}
        value={String(weekStartsOn)}
        onValueChange={(value) =>
          startTransition(async () => {
            const result = await setWeekStartsOnAction({
              weekStartsOn: Number(value),
            });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("Saved");
            router.refresh();
          })
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEEKDAYS.map((day, i) => (
            <SelectItem key={day} value={String(i)}>
              {day}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Your week runs from here. Weekly totals are grouped by it.
      </p>
    </div>
  );
}

/**
 * What a clocked span is rounded to.
 *
 * NO DIRECTION IS OFFERED, and the sentence under the picker says why in the
 * reader's terms. Rounding is lawful while it is neutral — it has to cost as
 * often as it pays — so every option here is to the NEAREST increment. A
 * business that wants to always round down is asking for something this
 * product will not do.
 */
export function RoundingPicker({
  roundingMinutes,
}: {
  roundingMinutes: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        disabled={pending}
        value={String(roundingMinutes)}
        onValueChange={(value) =>
          startTransition(async () => {
            const result = await setRoundingAction({
              roundingMinutes: Number(value),
            });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("Saved");
            router.refresh();
          })
        }
      >
        <SelectTrigger className="w-[220px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROUNDING_CHOICES.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {roundingLabel(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Only applies to time from a clock. Always to the nearest, so it costs as
        often as it pays. Typed hours are kept exactly as typed.
      </p>
    </div>
  );
}

/**
 * How often people are paid — which is NOT how overtime is measured.
 *
 * The sentence under it says so, because the two settings sit next to each
 * other and a reader who conflates them will believe a fortnight of 80 hours
 * has no overtime in it. Biweekly asks for a starting date, because nothing in
 * the calendar says which of two weeks begins a period.
 */
export function PayFrequencyPicker({
  frequency,
  anchor,
  weekExample,
}: {
  frequency: string;
  anchor: string | null;
  /** A real upcoming week start, so the date box opens somewhere sensible. */
  weekExample: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(frequency);

  function save(value: string, anchorValue: string | null) {
    startTransition(async () => {
      const result = await setPayFrequencyAction({
        frequency: value as (typeof PAY_FREQUENCIES)[number],
        anchor: anchorValue,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        disabled={pending}
        value={frequency}
        onValueChange={(value) => {
          setChoice(value);
          // Biweekly cannot be saved without knowing which fortnight it is, so
          // it asks before saving rather than after failing.
          if (value === "biweekly") {
            setOpen(true);
            return;
          }
          save(value, null);
        }}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAY_FREQUENCIES.map((f) => (
            <SelectItem key={f} value={f}>
              {payFrequencyLabel(f)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        When people are paid. Overtime is still worked out for each week on its
        own, so a fortnight is two weeks and not eighty hours.
        {frequency === "biweekly" && anchor ? ` Periods start from ${anchor}.` : ""}
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            action={(formData: FormData) =>
              save(choice, String(formData.get("anchor") ?? "") || null)
            }
          >
            <DialogHeader>
              <DialogTitle>When does a pay period start?</DialogTitle>
              <DialogDescription>
                Pick the first day of any one of your two-week periods. Every
                other period is counted from it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4">
              <Label htmlFor="anchor">First day of a period</Label>
              <Input
                id="anchor"
                name="anchor"
                type="date"
                required
                defaultValue={anchor ?? weekExample}
              />
              <p className="text-xs text-muted-foreground">
                If this is not the day your week starts on, we move it back to
                the start of that week so a period is always two whole weeks.
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Which overtime rules the business follows.
 *
 * THE COPY MATTERS MORE THAN THE CONTROL. This is a legal choice the business
 * makes with whoever does its payroll, and the product must not appear to have
 * made it for them — so the summary of whatever is picked is shown in full,
 * and the line underneath says whose decision it is.
 */
export function OvertimeRulesetPicker({ slug }: { slug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = rulesetFor(slug);

  return (
    <div className="flex flex-col gap-2">
      <Select
        disabled={pending}
        value={slug}
        onValueChange={(value) =>
          startTransition(async () => {
            const result = await setOvertimeRulesetAction({ slug: value });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("Saved");
            router.refresh();
          })
        }
      >
        <SelectTrigger className="w-[260px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULESETS.map((r) => (
            <SelectItem key={r.slug} value={r.slug}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{current.summary}</p>
      <p className="text-xs text-muted-foreground">
        Which rules apply to you is your decision, with whoever does your
        payroll. We do the arithmetic; we do not know where your people work.
      </p>
    </div>
  );
}

/**
 * Whether locking a pay period puts its wages in the books.
 *
 * A SWITCH RATHER THAN A SILENT DEFAULT, because both answers are ordinary. A
 * farm that does its own books wants the accrual; one whose accountant keys
 * payroll in from a report wants nothing written at all, and would rightly
 * treat journal entries it never asked for as a bug.
 *
 * Turning it off again is refused once anything has posted — the server says so
 * and this only relays the message, because the screen has no way to know what
 * is in the ledger and should not pretend to.
 */
export function PostsLaborSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent-time)]"
          checked={on}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            startTransition(async () => {
              const result = await setPostsLaborAction({ postsLabor: next });
              if ("error" in result) {
                toast.error(result.error);
                router.refresh();
                return;
              }
              toast.success(
                next ? "Wages will go to your books" : "Wages will stay here",
              );
              router.refresh();
            });
          }}
        />
        Send wages to the books when a period is locked
      </label>
      <p className="text-xs text-subtle-foreground">
        Locking a pay period writes a payroll accrual: what the approved hours
        came to, charged to Salaries &amp; Wages and split by what the hours were
        for, owed under Payroll Liabilities until you pay it. Unlocking the
        period reverses it.
      </p>
    </div>
  );
}
