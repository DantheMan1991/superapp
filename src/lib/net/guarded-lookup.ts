import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isPublicAddress } from "./ssrf";

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A resolver that refuses to hand back a private address. Every fetch the
 * server makes on someone else's say-so connects through it: the mail image
 * proxy (`fetch-image.ts`) and the recipe reader (`fetch-page.ts`).
 *
 * Returning an error here aborts the connection before a packet is sent, and
 * because the agent connects to the address this callback returned, there is no
 * window in which the name could resolve to something else.
 *
 * **It answers in the shape it was asked for.** Since Node 20 a socket tries
 * every address a name has (`autoSelectFamily`), so it asks with `all: true`
 * and expects every address back as a list. Answering that with one address
 * made every connection fail at once with "Invalid IP address: undefined", so
 * the mail image proxy has been refusing every remote image without a sound: a
 * refused image looks like one the sender took down. Found 2026-10-01 by the
 * recipe reader's first real fetch. Every address is checked either way, and
 * one private address refuses the name.
 */
export function guardedLookup(
  hostname: string,
  options: number | { family?: number; all?: boolean; hints?: number } | undefined,
  callback: LookupCallback,
): void {
  const asked = typeof options === "number" ? { family: options } : (options ?? {});
  dnsLookup(hostname, { ...asked, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (addresses.length === 0) {
      return callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), "", 0);
    }
    for (const entry of addresses) {
      if (!isPublicAddress(entry.address)) {
        return callback(
          Object.assign(new Error("blocked private address"), {
            code: "EBLOCKED",
          }),
          "",
          0,
        );
      }
    }
    if (asked.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}
