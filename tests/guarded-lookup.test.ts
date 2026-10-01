import { describe, expect, it } from "vitest";
import type { LookupAddress } from "node:dns";
import { guardedLookup } from "../src/lib/net/guarded-lookup";

/**
 * The guarded resolver answers in the shape it was asked for (2026-10-01).
 * Node 20 and later connect with `autoSelectFamily`, which asks with
 * `all: true` and wants a list back; one address in answer made every guarded
 * connection fail with "Invalid IP address: undefined", the mail image proxy's
 * included. IP literals and localhost resolve without a network, so this
 * needs none.
 */

function ask(hostname: string, options: { all?: boolean; family?: number } | number | undefined) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>(
    (resolve) => guardedLookup(hostname, options, (err, address, family) => resolve({ err, address, family })),
  );
}

describe("guardedLookup", () => {
  it("answers a socket that asks for every address with a list", async () => {
    const { err, address } = await ask("93.184.215.14", { all: true });
    expect(err).toBeNull();
    expect(address).toEqual([{ address: "93.184.215.14", family: 4 }]);
  });

  it("answers a plain lookup with one address and its family", async () => {
    expect(await ask("93.184.215.14", {})).toEqual({ err: null, address: "93.184.215.14", family: 4 });
    expect(await ask("93.184.215.14", 4)).toEqual({ err: null, address: "93.184.215.14", family: 4 });
    expect(await ask("93.184.215.14", undefined)).toEqual({ err: null, address: "93.184.215.14", family: 4 });
  });

  it("refuses a private address, whichever shape was asked for", async () => {
    for (const options of [{ all: true }, {}]) {
      for (const host of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "localhost"]) {
        const { err } = await ask(host, options);
        expect(err?.code, host).toBe("EBLOCKED");
      }
    }
  });
});
