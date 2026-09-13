"use client";

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { fileReportAction } from "@/lib/feedback/actions";
import { KIND_CHOICES, screenLabel } from "@/lib/feedback/core";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_TITLE_MAX,
  type FeedbackKind,
} from "@/lib/feedback/vocabulary";
import { cn } from "@/lib/utils";

export const FEEDBACK_HREF = "/dashboard/feedback";

/**
 * TELL US THIS SCREEN IS WRONG, from the screen that is wrong.
 *
 * ── WHY IT IS BESIDE THE "?" AND NOT A SECOND FLOATING BUTTON ────────────────
 *
 * ADR 0051 put the microphone bottom right on the argument that it is where a
 * thumb is, and that argument does not survive being used twice: two floating
 * controls in one corner means the important one is now a target to miss. The
 * "?" is already the "this screen, right now" affordance — `PageHeader` renders
 * it on every screen in the product — and "I do not understand this" and "this
 * is broken" are the same reflex two seconds apart.
 *
 * ── THE CONTEXT IS THE POINT ─────────────────────────────────────────────────
 *
 * Every field this sends that the user did not type — the route, the query, the
 * viewport, and (server side, from the user agent) the shell and its version —
 * is a question a bug report otherwise makes somebody answer badly. "Which
 * screen were you on" gets "the animals one". The button already knows.
 *
 * ── AND WHY IT SHOWS A DOT ───────────────────────────────────────────────────
 *
 * Because the conversation is two-way and nothing else in the product would
 * tell them we answered. The count comes from the layout, not a fetch: this
 * component renders on every page, and a request per page to draw a dot that is
 * usually not there is the wrong trade.
 */

interface FeedbackState {
  /** Replies this person has not read, across all their reports. */
  unread: number;
  /**
   * False in a support view. A superadmin looking at a client's workspace must
   * not file a report in their name — the server refuses it anyway
   * (`requireTenant` throws on a non-GET), so this only keeps a button that
   * cannot work off the screen.
   */
  enabled: boolean;
}

const FeedbackContext = createContext<FeedbackState>({
  unread: 0,
  enabled: false,
});

/**
 * Wrapped around the dashboard's children by its layout, which is the only
 * thing that knows the count. The default above is `enabled: false`, so
 * `PageHeader` rendering outside the dashboard — `/admin`, the public share
 * page — draws nothing rather than a button with no server behind it.
 */
export function FeedbackProvider({
  unread,
  enabled,
  children,
}: FeedbackState & { children: ReactNode }) {
  return (
    <FeedbackContext.Provider value={{ unread, enabled }}>
      {children}
    </FeedbackContext.Provider>
  );
}

export function ReportButton({ className }: { className?: string }) {
  const pathname = usePathname();
  const { unread, enabled } = useContext(FeedbackContext);
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={
          unread > 0
            ? `Report a problem or suggest something (${unread} unread ${unread === 1 ? "reply" : "replies"})`
            : "Report a problem or suggest something"
        }
        title="Report a problem or suggest something"
        className={cn("relative text-muted-foreground", className)}
      >
        <MessageSquarePlus />
        {unread > 0 && (
          <span
            // A dot, not a number: the count is on the page it leads to, and a
            // badge with a digit in it on a 36px icon reads as noise.
            aria-hidden
            className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          /*
            THE DATA-VARIANT FORM, and a plain `w-full` here does nothing:
            `SheetContent`'s own base class carries `data-[side=right]:w-3/4`,
            which outranks an unqualified utility, so the first version rendered
            at three quarters on a phone and the override was silently dead.
            `help-button.tsx` next door already uses this form.

            FULL WIDTH ON A PHONE, unlike the help panel — deliberately. That
            panel stays narrow so the reader can still SEE the control the guide
            is naming; nothing in this sheet refers to the page behind it, and
            typing a bug report into 281px of a 375px screen is the cramped half
            of a trade with nothing on the other side.
          */
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle>Something to report</SheetTitle>
            <SheetDescription>
              You are on <strong>{screenLabel(pathname)}</strong>. We will send
              this screen along with your message, so you do not have to
              describe where you were.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {unread > 0 && (
              <Link
                href={FEEDBACK_HREF}
                onClick={() => setOpen(false)}
                className="mb-4 flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm hover:bg-muted"
              >
                <span>
                  {unread === 1
                    ? "We answered one of your reports"
                    : `We answered ${unread} of your reports`}
                </span>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              </Link>
            )}
            <ReportForm
              pathname={pathname}
              onSent={() => setOpen(false)}
            />
            <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
              Everything you have sent, and what we said back, is on{" "}
              <Link
                href={FEEDBACK_HREF}
                onClick={() => setOpen(false)}
                className="underline underline-offset-2"
              >
                your reports
              </Link>
              . Only you can see them.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ReportForm({
  pathname,
  onSent,
}: {
  pathname: string;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    start(async () => {
      const result = await fileReportAction({
        kind,
        title,
        body,
        // Read at SEND time from `window.location`, not from `useSearchParams`:
        // that hook demands a Suspense boundary on any statically rendered page,
        // and this sits on every page there is — the reasoning `help-button.tsx`
        // already wrote down for the same problem.
        route: pathname,
        routeQuery: window.location.search.slice(0, 512),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTitle("");
      setBody("");
      onSent();
      toast.success("Sent. We will answer you in Your reports.");
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What is it?</legend>
        <div className="grid gap-2">
          {KIND_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => setKind(choice.value)}
              aria-pressed={kind === choice.value}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                kind === choice.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <span className="block text-sm font-medium">{choice.label}</span>
              <span className="block text-xs text-muted-foreground">
                {choice.hint}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="feedback-title">In a few words</Label>
        <Input
          id="feedback-title"
          value={title}
          maxLength={FEEDBACK_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={
            kind === "bug"
              ? "Totals do not add up"
              : kind === "idea"
                ? "Let me filter by paddock"
                : "What does 'posted' mean here?"
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="feedback-body">What happened?</Label>
        <Textarea
          id="feedback-body"
          value={body}
          rows={6}
          maxLength={FEEDBACK_BODY_MAX}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            kind === "bug"
              ? "What you pressed, what you expected, what it did instead."
              : "What you are trying to do, and what would make it easier."
          }
        />
      </div>

      <Button
        type="submit"
        // Disabled on the same rule the server validates on, so the button and
        // the refusal cannot disagree.
        disabled={pending || title.trim().length < 3 || body.trim().length === 0}
        className="w-full"
      >
        {pending && <Loader2 className="animate-spin" />}
        Send
      </Button>
    </form>
  );
}
