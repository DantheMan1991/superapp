import type { ReactNode } from "react";
import { LaunchOverlay } from "@/components/app/launch-overlay";
import { launchPending } from "@/lib/native-app";

/**
 * The sign-in and sign-up pages. Their one layout concern: inside the mobile
 * app, the first page of a launch plays the launch animation over itself
 * (src/lib/launch.ts). The app opens on /dashboard, which sends a signed-out
 * person here, so this is where the launch usually plays.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const showLaunch = await launchPending();
  return (
    <>
      {showLaunch && <LaunchOverlay />}
      {children}
    </>
  );
}
