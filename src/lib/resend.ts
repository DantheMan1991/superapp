import "server-only";
import { Resend } from "resend";

let client: Resend | undefined;

/** Lazy so the app builds and boots without a Resend key configured. */
export function getResend(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not set. See SETUP.md.");
  }
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}
