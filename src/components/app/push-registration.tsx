"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  readNativeBridge,
  tokenFromRegistration,
  urlFromNotificationAction,
} from "@/lib/native-bridge";
import { nativeAppInfo } from "@/lib/native-app-core";
import { registerPushDeviceAction } from "@/app/dashboard/push-actions";

/**
 * Renders nothing. Inside the mobile app, once per page lifetime, it asks
 * the phone for notification permission, registers for a device token, hands
 * the token to the server, and routes a tapped notification to its page. In
 * a browser, or in a shell without the push plugin, the bridge is absent and
 * nothing happens.
 *
 * Mounted after hydration in the dashboard layout so every signed-in page
 * does this; the token is kept in sessionStorage so navigating between pages
 * does not re-register the same phone.
 */

const SESSION_KEY = "yosher:push-token";
let started = false;

export function PushRegistration() {
  const router = useRouter();

  useEffect(() => {
    if (started) return;
    const bridge = readNativeBridge(window);
    if (!bridge?.push) return;
    started = true;
    const push = bridge.push;
    const appVersion = nativeAppInfo(navigator.userAgent)?.version ?? "";

    void (async () => {
      try {
        await push.addListener("registration", async (payload) => {
          const token = tokenFromRegistration(payload);
          if (!token) return;
          let known: string | null = null;
          try {
            known = sessionStorage.getItem(SESSION_KEY);
          } catch {
            known = null;
          }
          if (known === token) return;
          const result = await registerPushDeviceAction({
            token,
            platform: bridge.platform,
            appVersion,
          });
          if (result.ok) {
            try {
              sessionStorage.setItem(SESSION_KEY, token);
            } catch {
              // A browser that refuses storage just registers again next page.
            }
          }
        });
        await push.addListener("registrationError", (payload) => {
          console.error("push registration failed", payload);
        });
        await push.addListener("pushNotificationActionPerformed", (payload) => {
          router.push(urlFromNotificationAction(payload));
        });

        const current = await push.checkPermissions();
        const receive =
          current.receive === "prompt" || current.receive === "prompt-with-rationale"
            ? (await push.requestPermissions()).receive
            : current.receive;
        if (receive === "granted") await push.register();
      } catch (err) {
        console.error("push setup failed", err);
      }
    })();
  }, [router]);

  return null;
}
