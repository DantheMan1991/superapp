"use client";

import { useActionState, useId, useState } from "react";
import { answerInputName, ENQUIRY_MESSAGE_MAX, type EnquiryState } from "@/lib/sites/enquiry-schema";
import type { FormField } from "@/lib/sites/schema";
import { submitSiteEnquiry } from "./enquiry-action";

/**
 * The enquiry form — one of the two client islands on a public site (the
 * other is the view beacon).
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
 *
 * The business's own questions come from the section and are asked between
 * the phone and the message. The server checks the answers against the
 * PUBLISHED questions, not against these props.
 */

const INITIAL: EnquiryState = { status: "idle" };

export const INPUT =
  "block w-full rounded-[var(--site-radius-field)] border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 shadow-sm placeholder:text-neutral-400 focus:border-[var(--site-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--site-primary)]/30 disabled:bg-neutral-100 disabled:text-neutral-500";
export const LABEL = "block text-sm font-medium text-neutral-800";

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-700">
      {error}
    </p>
  );
}

function Optional({ quiet }: { quiet: string }) {
  return <span className={`font-normal ${quiet}`}> (optional)</span>;
}

export function EnquiryForm({
  siteSlug,
  pagePath,
  sectionIndex,
  buttonLabel,
  askPhone,
  thanks,
  fields,
  disabled,
  onDark = false,
}: {
  siteSlug: string;
  pagePath: string;
  sectionIndex: number;
  buttonLabel: string;
  askPhone: boolean;
  thanks: string;
  fields: FormField[];
  /** The draft preview: the form is shown but takes nothing. */
  disabled?: boolean;
  /** On a dark band, the brand colour or a photo: labels and notes turn light. */
  onDark?: boolean;
}) {
  const label = onDark ? "block text-sm font-medium text-white" : LABEL;
  const quiet = onDark ? "text-neutral-200" : "text-neutral-500";
  const [state, formAction, pending] = useActionState(submitSiteEnquiry, INITIAL);
  const id = useId();
  const [values, setValues] = useState({ name: "", email: "", phone: "", message: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set =
    (field: keyof typeof values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value }));
  const setAnswer = (name: string, value: string) => setAnswers((a) => ({ ...a, [name]: value }));

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="mt-6 rounded-[var(--site-radius)] border border-neutral-200 bg-neutral-50 p-6 text-neutral-800"
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
  const describedBy = (name: string) => (errors[name] ? field(`${name}-error`) : undefined);

  return (
    <form action={formAction} className="mt-6 max-w-xl">
      <input type="hidden" name="site" value={siteSlug} />
      <input type="hidden" name="page" value={pagePath} />
      <input type="hidden" name="section" value={sectionIndex} />
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
            <label htmlFor={field("name")} className={label}>
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
              aria-describedby={describedBy("name")}
              className={`${INPUT} mt-1`}
            />
            <FieldError id={field("name-error")} error={errors.name} />
          </div>
          <div>
            <label htmlFor={field("email")} className={label}>
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
              aria-describedby={describedBy("email")}
              className={`${INPUT} mt-1`}
            />
            <FieldError id={field("email-error")} error={errors.email} />
          </div>
        </div>
        {askPhone && (
          <div>
            <label htmlFor={field("phone")} className={label}>
              Phone
              <Optional quiet={quiet} />
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
              aria-describedby={describedBy("phone")}
              className={`${INPUT} mt-1`}
            />
            <FieldError id={field("phone-error")} error={errors.phone} />
          </div>
        )}

        {fields.map((q) => {
          const name = answerInputName(q.id);
          const value = answers[name] ?? "";
          const caption = (
            <label htmlFor={field(name)} className={label}>
              {q.label}
              {!q.required && q.kind !== "yesno" && <Optional quiet={quiet} />}
            </label>
          );
          switch (q.kind) {
            case "text":
              return (
                <div key={q.id}>
                  {caption}
                  <input
                    id={field(name)}
                    name={name}
                    type="text"
                    maxLength={200}
                    value={value}
                    onChange={(e) => setAnswer(name, e.target.value)}
                    aria-invalid={!!errors[name]}
                    aria-describedby={describedBy(name)}
                    className={`${INPUT} mt-1`}
                  />
                  <FieldError id={field(`${name}-error`)} error={errors[name]} />
                </div>
              );
            case "long":
              return (
                <div key={q.id}>
                  {caption}
                  <textarea
                    id={field(name)}
                    name={name}
                    rows={3}
                    maxLength={1000}
                    value={value}
                    onChange={(e) => setAnswer(name, e.target.value)}
                    aria-invalid={!!errors[name]}
                    aria-describedby={describedBy(name)}
                    className={`${INPUT} mt-1`}
                  />
                  <FieldError id={field(`${name}-error`)} error={errors[name]} />
                </div>
              );
            case "choice":
              return (
                <div key={q.id}>
                  {caption}
                  <select
                    id={field(name)}
                    name={name}
                    value={value}
                    onChange={(e) => setAnswer(name, e.target.value)}
                    aria-invalid={!!errors[name]}
                    aria-describedby={describedBy(name)}
                    className={`${INPUT} mt-1`}
                  >
                    <option value="">Choose one</option>
                    {q.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <FieldError id={field(`${name}-error`)} error={errors[name]} />
                </div>
              );
            case "yesno":
              return (
                <div key={q.id}>
                  <label htmlFor={field(name)} className="flex items-start gap-3 text-sm text-neutral-800">
                    <input
                      id={field(name)}
                      name={name}
                      type="checkbox"
                      checked={value === "on"}
                      onChange={(e) => setAnswer(name, e.target.checked ? "on" : "")}
                      aria-invalid={!!errors[name]}
                      aria-describedby={describedBy(name)}
                      className="mt-1 size-4 rounded border-neutral-300"
                      style={{ accentColor: "var(--site-primary)" }}
                    />
                    <span>{q.label}</span>
                  </label>
                  <FieldError id={field(`${name}-error`)} error={errors[name]} />
                </div>
              );
          }
        })}

        <div>
          <label htmlFor={field("message")} className={label}>
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
            aria-describedby={describedBy("message")}
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
            className="inline-block rounded-[var(--site-radius-button)] px-6 py-3 text-sm font-medium shadow-sm disabled:opacity-60"
            style={{ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" }}
          >
            {pending ? "Sending…" : buttonLabel || "Send"}
          </button>
          {disabled && (
            <p className={`text-sm ${quiet}`}>
              Visitors can send this once the site is published.
            </p>
          )}
        </div>
      </fieldset>
    </form>
  );
}
