import { z } from "zod";
import { LogoSpecSchema, type LogoSpec } from "@/lib/brand/logo-spec";

/**
 * The model's answer is untrusted input. Each candidate is parsed on its own
 * so one bad one costs one slot, not the set; the caller pads from the
 * standard set when fewer than it wants survive.
 */
const ResponseSchema = z.object({
  candidates: z.array(z.unknown()).max(12),
});

export const LOGO_CANDIDATES = 6;

export function validateLogoProposal(raw: unknown): LogoSpec[] {
  const parsed = ResponseSchema.safeParse(raw);
  if (!parsed.success) return [];
  const out: LogoSpec[] = [];
  const seen = new Set<string>();
  for (const candidate of parsed.data.candidates) {
    const spec = LogoSpecSchema.safeParse(candidate);
    if (!spec.success) continue;
    // Two candidates with the same layout and mark are the same idea twice.
    const key = `${spec.data.layout}:${spec.data.mark}:${spec.data.textCase}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec.data);
    if (out.length === LOGO_CANDIDATES) break;
  }
  return out;
}
