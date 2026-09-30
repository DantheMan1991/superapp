"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readDeviceSettings } from "../client/device-settings";

/**
 * THE LAST SETUP READOUT, AGAIN (docs/help/fitness/posture.md): kept on this
 * phone by the setup check, so it can be copied and sent later. Numbers only.
 */

function subscribe(): () => void {
  return () => undefined;
}

function snapshot(): string {
  const s = readDeviceSettings();
  return s.lastReadout && s.lastReadoutAt ? `${s.lastReadoutAt}\n${s.lastReadout}` : "";
}

export function LastReadout() {
  const stored = useSyncExternalStore(subscribe, snapshot, () => "");
  const [copied, setCopied] = useState(false);
  if (!stored) return null;
  const [at, ...rest] = stored.split("\n");
  const when = new Date(at);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">
        Last setup check on this phone:{" "}
        {when.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(rest.join("\n"));
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Copy aria-hidden /> {copied ? "Copied" : "Copy its readout"}
      </Button>
    </div>
  );
}
