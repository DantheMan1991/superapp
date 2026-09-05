"use client";

import { useActionState, useEffect, useId, useState } from "react";
import type { BookingState, OfferedDay } from "@/lib/sites/booking-core";
import { submitSiteBooking } from "./booking-action";
import { INPUT, LABEL } from "./enquiry-form";

/**
 * Book a time — the site's fourth client island (ADR 0025), the enquiry
 * form's twin with a time picker in front of it. The open times come from
 * `/api/sites/slots` (a public read; the section names its page and place
 * so the server reads the rules from the PUBLISHED page), the booking goes
 * through the server action, and a time that was taken in the meantime is
 * answered with the rest. Plain elements in the site's own variables, as the
 * enquiry form: this is the business's page.
 */
const INITIAL: BookingState = { status: "idle" };

interface Times {
  status: "loading" | "ready" | "failed";
  days: OfferedDay[];
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-700">
      {error}
    </p>
  );
}

export function BookingForm({
  siteSlug,
  pagePath,
  sectionIndex,
  title,
  minutes,
  buttonLabel,
  askPhone,
  thanks,
  disabled,
  onDark = false,
}: {
  siteSlug: string;
  pagePath: string;
  sectionIndex: number;
  /** What is being booked, for the words around the picker. */
  title: string;
  minutes: number;
  buttonLabel: string;
  askPhone: boolean;
  thanks: string;
  /** The draft preview: the form is shown but offers nothing and takes nothing. */
  disabled?: boolean;
  onDark?: boolean;
}) {
  const label = onDark ? "block text-sm font-medium text-white" : LABEL;
  const quiet = onDark ? "text-neutral-200" : "text-neutral-500";
  const chip = onDark
    ? "border-white/40 text-white hover:border-white"
    : "border-neutral-300 bg-white text-neutral-800 hover:border-[var(--site-primary)]";
  const [state, formAction, pending] = useActionState(submitSiteBooking, INITIAL);
  const id = useId();
  const [times, setTimes] = useState<Times>({ status: "loading", days: [] });
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [values, setValues] = useState({ name: "", email: "", phone: "", note: "" });
  const set =
    (field: keyof typeof values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [field]: e.target.value }));

  // The open times: on mount, and again after every answer from the action,
  // which is what shows the rest when a time was just taken.
  useEffect(() => {
    if (disabled || state.status === "success") return;
    let cancelled = false;
    const query = new URLSearchParams({ site: siteSlug, page: pagePath, section: String(sectionIndex) });
    fetch(`/api/sites/slots?${query}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { days?: OfferedDay[] }) => {
        if (cancelled) return;
        const days = Array.isArray(data.days) ? data.days : [];
        setTimes({ status: "ready", days });
        setDay((d) => (d && days.some((x) => x.date === d) ? d : (days[0]?.date ?? null)));
        setStart((s) => (s && days.some((x) => x.slots.some((slot) => slot.start === s)) ? s : null));
      })
      .catch(() => {
        if (!cancelled) setTimes({ status: "failed", days: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [disabled, siteSlug, pagePath, sectionIndex, state]);

  if (state.status === "success") {
    return (
      <div role="status" className="mt-6 rounded-[var(--site-radius)] border border-neutral-200 bg-neutral-50 p-6 text-neutral-800">
        <p className="font-medium" style={{ color: "var(--site-primary)" }}>
          Booked{state.booked ? `: ${state.booked}` : "."}
        </p>
        <p className="mt-1">{thanks || "Thanks. We'll confirm by email."}</p>
      </div>
    );
  }

  const errors = state.fieldErrors ?? {};
  const field = (name: string) => `${id}-${name}`;
  const describedBy = (name: string) => (errors[name] ? field(`${name}-error`) : undefined);
  const chosenDay = times.days.find((d) => d.date === day) ?? null;
  const chosen = times.days.flatMap((d) => d.slots).find((s) => s.start === start) ?? null;

  return (
    <form action={formAction} className="mt-6 max-w-xl">
      <input type="hidden" name="site" value={siteSlug} />
      <input type="hidden" name="page" value={pagePath} />
      <input type="hidden" name="section" value={sectionIndex} />
      <input type="hidden" name="start" value={start ?? ""} />
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={field("website")}>Leave this field empty</label>
        <input id={field("website")} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset disabled={disabled || pending} className="space-y-5">
        <div>
          <p className={label}>
            Pick a day
            <span className={`font-normal ${quiet}`}> ({minutes} minutes)</span>
          </p>
          {disabled ? (
            <p className={`mt-2 text-sm ${quiet}`}>Visitors pick a time here once the site is published.</p>
          ) : times.status === "loading" ? (
            <p className={`mt-2 text-sm ${quiet}`}>Finding open times…</p>
          ) : times.status === "failed" ? (
            <p className={`mt-2 text-sm ${quiet}`}>The open times could not be loaded. Use the phone or email on this page.</p>
          ) : times.days.length === 0 ? (
            <p className={`mt-2 text-sm ${quiet}`}>No open times at the moment. Use the phone or email on this page.</p>
          ) : (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Days">
              {times.days.map((d) => {
                const pressed = d.date === day;
                return (
                  <button
                    key={d.date}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => {
                      setDay(d.date);
                      setStart(null);
                    }}
                    className={`shrink-0 rounded-[var(--site-radius-button)] border px-3 py-1.5 text-sm ${pressed ? "" : chip}`}
                    style={pressed ? { backgroundColor: "var(--site-primary)", borderColor: "var(--site-primary)", color: "var(--site-primary-fg)" } : undefined}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {chosenDay && (
          <div>
            <p className={label}>Pick a time</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Times">
              {chosenDay.slots.map((slot) => {
                const pressed = slot.start === start;
                return (
                  <button
                    key={slot.start}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setStart(slot.start)}
                    className={`rounded-[var(--site-radius-button)] border px-3 py-1.5 text-sm ${pressed ? "" : chip}`}
                    style={pressed ? { backgroundColor: "var(--site-primary)", borderColor: "var(--site-primary)", color: "var(--site-primary-fg)" } : undefined}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
            <FieldError id={field("start-error")} error={errors.start} />
          </div>
        )}

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
              <span className={`font-normal ${quiet}`}> (optional)</span>
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
        <div>
          <label htmlFor={field("note")} className={label}>
            Anything we should know
            <span className={`font-normal ${quiet}`}> (optional)</span>
          </label>
          <textarea
            id={field("note")}
            name="note"
            rows={3}
            maxLength={1000}
            value={values.note}
            onChange={set("note")}
            className={`${INPUT} mt-1`}
          />
        </div>

        {state.status === "error" && state.message && (
          <p role="alert" className="text-sm text-red-700">
            {state.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={!chosen}
            className="inline-block rounded-[var(--site-radius-button)] px-6 py-3 text-sm font-medium shadow-sm disabled:opacity-60"
            style={{ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" }}
          >
            {pending ? "Booking…" : buttonLabel || "Book"}
          </button>
          <p className={`text-sm ${quiet}`}>
            {chosen ? `${title}, ${chosenDay?.label ?? ""} at ${chosen.label}` : disabled ? "" : "Pick a day and a time above."}
          </p>
        </div>
      </fieldset>
    </form>
  );
}
