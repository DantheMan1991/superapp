/**
 * Shared fixtures for the Documents (DMS) suite.
 *
 * The pure cases run everywhere; the `d(...)` ones need a database and skip
 * without one. The visibility logic covered here is the highest-stakes code in
 * the module — it decides who can read a file. The RLS proof of the same rules
 * lives in tests/isolation/documents-dms.test.ts.
 *
 * One file per area under tests/documents-dms/ — split out of a single
 * 3,172-line file so a change to shares does not mean reading versions.
 */
import "dotenv/config";
import { describe } from "vitest";

export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const RUN = !!process.env.DATABASE_URL;

export const d = RUN ? describe : describe.skip;

export const STAMP_OPS = `dms-ops-${process.pid}`;
