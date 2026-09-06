import "server-only";
import { cookies, headers } from "next/headers";
import { isNativeAppRequest, NATIVE_APP_COOKIE } from "@/lib/native-app-core";

/**
 * Is this request coming from inside the Yosher mobile app? Server
 * components and actions ask this to leave out what the app stores forbid
 * inside an app — see src/lib/native-app-core.ts for how the answer is
 * carried. Cheap: two header reads, no I/O.
 */
export async function isNativeApp(): Promise<boolean> {
  const [h, c] = await Promise.all([headers(), cookies()]);
  return isNativeAppRequest({
    userAgent: h.get("user-agent"),
    cookie: c.get(NATIVE_APP_COOKIE)?.value ?? null,
  });
}
