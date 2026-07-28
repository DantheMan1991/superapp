"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CONTACT } from "@/lib/site";
import { cn } from "@/lib/utils";
import { sendContactMessage } from "./actions";
import { CONTACT_MESSAGE_MAX, type ContactState } from "./schema";

const INITIAL: ContactState = { status: "idle" };

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {error}
    </p>
  );
}

export function ContactForm() {
  const [state, formAction, pending] = useActionState(
    sendContactMessage,
    INITIAL,
  );

  // Controlled, deliberately. React resets a <form action={...}> once the
  // action resolves, so with uncontrolled inputs a validation error would hand
  // the visitor an empty form and their message would be gone. Losing what
  // someone just wrote is the one failure this form must not have.
  const [values, setValues] = useState({
    name: "",
    email: "",
    business: "",
    message: "",
  });
  const set = (field: keyof typeof values) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setValues((v) => ({ ...v, [field]: e.target.value }));

  if (state.status === "success") {
    return (
      <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-6" />
        </div>
        <h2 className="mt-5 text-lg font-medium">Message sent.</h2>
        <p className="mx-auto mt-2 max-w-sm text-pretty text-muted-foreground">
          {CONTACT.responseTime} If it&apos;s urgent, email us directly at{" "}
          <a
            href={`mailto:${CONTACT.email}`}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {CONTACT.email}
          </a>
          .
        </p>
      </div>
    );
  }

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      {/* Honeypot. Hidden from people and from screen readers; bots fill it in
          and the action silently discards the submission. Not `display:none` —
          some bots skip those. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this field empty</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            name="name"
            required
            autoComplete="name"
            className="h-10"
            value={values.name}
            onChange={set("name")}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "name-error" : undefined}
          />
          <FieldError id="name-error" error={errors.name} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="h-10"
            value={values.email}
            onChange={set("email")}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          <FieldError id="email-error" error={errors.email} />
        </div>
      </div>

      <div className="mt-5 grid gap-2">
        <Label htmlFor="business">
          Business name
          <span className="font-normal text-muted-foreground">optional</span>
        </Label>
        <Input
          id="business"
          name="business"
          autoComplete="organization"
          className="h-10"
          value={values.business}
          onChange={set("business")}
          aria-invalid={Boolean(errors.business)}
          aria-describedby={errors.business ? "business-error" : undefined}
        />
        <FieldError id="business-error" error={errors.business} />
      </div>

      <div className="mt-5 grid gap-2">
        <Label htmlFor="message">What can we help with?</Label>
        <Textarea
          id="message"
          name="message"
          required
          rows={6}
          maxLength={CONTACT_MESSAGE_MAX}
          placeholder="What you do, what's eating your time, and what you'd like to stop doing yourself."
          className="min-h-32"
          value={values.message}
          onChange={set("message")}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "message-error" : undefined}
        />
        <FieldError id="message-error" error={errors.message} />
      </div>

      <div className="mt-6 flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          aria-live="polite"
          className={cn(
            "text-sm",
            state.status === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {state.status === "error" ? state.message : CONTACT.responseTime}
        </p>
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="h-11 w-full px-6 text-base sm:w-auto"
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Sending
            </>
          ) : (
            <>
              Send message <Send className="size-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
