"use client";

import { useActionState, useId, useState } from "react";
import { ENQUIRY_MESSAGE_MAX, type EnquiryState } from "@/lib/sites/enquiry-schema";
import { submitSiteEnquiry } from "./enquiry-action";

/**
 * The enquiry form — the one client island on a public site.
 *
 * Plain elements styled with the site's CSS variables rather than the
 * product's components: this is the business's page, not Yosher's, and it
 * must look like the rest of the section around it. Works without
 * JavaScript too (a form with a server action posts and re-renders), which
 * is what a visitor on a slow connection gets.
 *
 * Controlled inputs, deliberately: React resets a `<form action>` once the
 * action resolves, so with uncontrolled inputs a validation error would hand
 * the visitor an empty form and their message would be gone. Losing what
 * someone just wrote is the one failure this form must not have.
 */

const INITIAL: EnquiryState = { status: "idle" };

const INPUT =
  "block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 shadow-sm placeholder:text-neutral-400 focus:border-[var(--site-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-primary)]/30 disabled:bg-neutral-100 disabled:text-neutral-500";
const LABEL = "block text-sm font-medium text-neutral-800";

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-700">
      {error}
    </p>
  );
}

export function EnquiryForm({
  siteSlug,
  pagePath,
  buttonLabel,
  askPhone,
  thanks,
  disabled,
}: {
  siteSlug: string;
  pagePath: string;
  buttonLabel: string;
  askPhone: boolean;
  thanks: string;
  /** The draft preview: the form is shown but takes nothing. */
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitSiteEnquiry, INITIAL);
  const id = useId();
  const [values, setValues] = useState({ name: "", email: "", phone: "", message: "" });
  const set =
    (field: keyof typeof values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value }));

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-neutral-800"
      >
        <p className="font-medium" style={{ color: "var(--site-primary)" }}>
          Message sent.
        </p>
        <p className="mt-1">{thanks || "Thanks. We'll be in touch."}</p>
      </div>
    );
  }

  const errors = state.fieldErrors ?? {};
  const field = (name: string) => `${id}-${name}`;

  return (
    <form action={formAction} className="mt-6 max-w-xl">
      <input type="hidden" name="site" value={siteSlug} />
      <input type="hidden" name="page" value={pagePath} />
      {/* Honeypot. Hidden from people and from screen readers; bots fill it in
          and the action silently discards the submission. Not `display:none`:
          some bots skip those. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={field("website")}>Leave this field empty</label>
        <input id={field("website")} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset disabled={disabled || pending} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={field("name")} className={LABEL}>
              Name
            </label>
            <input
              id={field("name")}
              name="name"
              type="text"
              autoComplete="name"
              required
              maxLength={120}
              value={values.name}
              onChange={set("name")}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? field("name-error") : undefined}
              className={`${INPUT} mt-1`}
            />
            <FieldError id={field("name-error")} error={errors.name} />
          </div>
          <div>
            <label htmlFor={field("email")} className={LABEL}>
              Email
            </label>
            <input
              id={field("email")}
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={values.email}
              onChange={set("email")}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? field("email-error") : undefined}
              className={`${INPUT} mt-1`}
            />
            <FieldError id={field("email-error")} error={errors.email} />
          </div>
        </div>
        {askPhone && (
          <div>
            <label htmlFor={field("phone")} className={LABEL}>
              Phone <span className="font-normal text-neutral-500">(optional)</span>
            </label>
            <input
              id={field("phone")}
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={values.phone}
              onChange={set("phone")}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? field("phone-error") : undefined}
              className={`${INPUT} mt-1`}
            />
            <FieldError id={field("phone-error")} error={errors.phone} />
          </div>
        )}
        <div>
          <label htmlFor={field("message")} className={LABEL}>
            Message
          </label>
          <textarea
            id={field("message")}
            name="message"
            required
            rows={5}
            maxLength={ENQUIRY_MESSAGE_MAX}
            value={values.message}
            onChange={set("message")}
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? field("message-error") : undefined}
            className={`${INPUT} mt-1`}
          />
          <FieldError id={field("message-error")} error={errors.message} />
        </div>

        {state.status === "error" && state.message && (
          <p role="alert" className="text-sm text-red-700">
            {state.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="inline-block rounded-full px-6 py-3 text-sm font-medium shadow-sm disabled:opacity-60"
            style={{ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" }}
          >
            {pending ? "Sending…" : buttonLabel || "Send"}
          </button>
          {disabled && (
            <p className="text-sm text-neutral-500">
              Visitors can send this once the site is published.
            </p>
          )}
        </div>
      </fieldset>
    </form>
  );
}
