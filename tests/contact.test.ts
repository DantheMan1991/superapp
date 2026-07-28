import "dotenv/config";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { withSystem, schema } from "../src/db";
import { contactSchema } from "../src/app/(marketing)/contact/schema";
import {
  CONTACT_HOURLY_IP_CAP,
  submitContactEnquiry,
} from "../src/lib/contact";

/**
 * The public contact form: validation at the boundary, and the abuse caps that
 * stand between an unauthenticated form and the provider bill.
 *
 * Sending is never exercised. `EMAIL_FROM_DOMAIN` is cleared below so the send
 * path cannot be reached even if a developer's .env is fully configured — a
 * test suite that mails real people once is one time too many. What that leaves
 * under test is exactly the part worth testing: whether the caps trip, and
 * whether they trip *before* anything is sent.
 */

process.env.INTERVIEW_IP_SALT ??= "test-salt";
process.env.EMAIL_FROM_DOMAIN = "";

const SALT = process.env.INTERVIEW_IP_SALT;
const hash = (ip: string) => createHash("sha256").update(`${SALT}${ip}`).digest("hex");

// Documentation-range addresses (RFC 5737) so these can never collide with a
// real visitor's hashed IP.
const IP_A = `203.0.113.${process.pid % 200}`;
const IP_B = `198.51.100.${process.pid % 200}`;

const enquiry = {
  name: "Test Person",
  email: "test@example.com",
  business: null,
  message: "A message long enough to pass validation.",
};

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

async function cleanup() {
  await withSystem(async (tx) => {
    await tx
      .delete(schema.publicAccessAttempts)
      .where(
        inArray(schema.publicAccessAttempts.ipHash, [hash(IP_A), hash(IP_B)]),
      );
  });
}

describe("contact form validation", () => {
  it("rejects a message too short to act on", () => {
    const res = contactSchema.safeParse({
      name: "A",
      email: "a@example.com",
      business: "",
      message: "hi",
    });
    expect(res.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const res = contactSchema.safeParse({
      name: "A",
      email: "not-an-email",
      business: "",
      message: "A message long enough to pass validation.",
    });
    expect(res.success).toBe(false);
  });

  it("truncates rather than rejects an overlong message", () => {
    const res = contactSchema.safeParse({
      name: "A",
      email: "a@example.com",
      business: "",
      message: "x".repeat(10_000),
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.message.length).toBe(4000);
  });

  it("normalises an empty business name to null", () => {
    const res = contactSchema.safeParse({
      name: "A",
      email: "a@example.com",
      business: "   ",
      message: "A message long enough to pass validation.",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.business).toBeNull();
  });
});

d("contact form abuse caps", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  it("lets a first-time sender through to the send step, then caps the IP", async () => {
    // Under the cap: reaches the send step and stops there because sending is
    // deliberately unconfigured in this suite.
    for (let i = 0; i < CONTACT_HOURLY_IP_CAP; i++) {
      const res = await submitContactEnquiry(enquiry, IP_A);
      expect(res).toEqual({ ok: false, reason: "not_configured" });
    }

    const overCap = await submitContactEnquiry(enquiry, IP_A);
    expect(overCap).toEqual({ ok: false, reason: "capped" });
  });

  it("caps one sender without affecting anyone else", async () => {
    // IP_A is already over its cap from the test above.
    expect(await submitContactEnquiry(enquiry, IP_A)).toEqual({
      ok: false,
      reason: "capped",
    });
    expect(await submitContactEnquiry(enquiry, IP_B)).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  it("records every attempt, including the ones it turns away", async () => {
    const rows = await withSystem((tx) =>
      tx
        .select()
        .from(schema.publicAccessAttempts)
        .where(inArray(schema.publicAccessAttempts.ipHash, [hash(IP_A)])),
    );
    expect(rows.length).toBeGreaterThan(CONTACT_HOURLY_IP_CAP);
    expect(rows.every((r) => r.kind === "contact_form")).toBe(true);
    // The raw address must never reach the table.
    expect(rows.every((r) => !r.ipHash.includes(IP_A))).toBe(true);
  });
});
