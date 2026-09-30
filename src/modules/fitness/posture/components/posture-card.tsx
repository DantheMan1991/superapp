import Link from "next/link";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * POSTURE CHECK, on the Workouts front page (docs/help/fitness/overview.md):
 * the way in to measuring how you stand with the phone's camera.
 */
export function PostureCard() {
  return (
    <section aria-label="Posture check" className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <ScanLine className="size-4 text-module-accent" aria-hidden /> Posture check
      </h2>
      <p className="text-sm text-muted-foreground">
        Measure how you stand with your phone&apos;s camera and small stickers on your bones. Nothing the camera sees
        leaves your phone.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/personal/m/fitness/posture">Open</Link>
      </Button>
    </section>
  );
}
