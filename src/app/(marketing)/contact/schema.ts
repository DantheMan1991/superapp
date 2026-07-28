import { z } from "zod";

/**
 * Shape and validation for the contact form, shared by the client form and the
 * server action.
 *
 * This lives outside `actions.ts` because a `"use server"` module may only
 * export async functions — exporting a constant or a schema from one silently
 * strips every export and the build fails with "the module has no exports at
 * all".
 */

export const CONTACT_MESSAGE_MAX = 4000;

export interface ContactState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Tell us who you are.")
    .max(120, "That name is too long."),
  email: z
    .string()
    .trim()
    .email("That email doesn't look right — check it and try again.")
    .max(254, "That email is too long."),
  business: z
    .string()
    .trim()
    .max(120, "That business name is too long.")
    .optional()
    .transform((v) => (v ? v : null)),
  message: z
    .string()
    // Truncate-then-validate, matching the interview's precedent: never
    // reject someone's enquiry purely for being long.
    .transform((s) => s.slice(0, CONTACT_MESSAGE_MAX).trim())
    .pipe(
      z
        .string()
        .min(10, "A sentence or two about what you need is enough to start."),
    ),
});
