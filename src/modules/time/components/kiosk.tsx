"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Delete, LogIn, LogOut, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { punchWithPinAction } from "../actions";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "../core/pin";

/**
 * THE SHARED DEVICE. A tablet by the barn door, a phone on a shelf in the pack
 * house: one browser, several people, cold hands, no keyboard.
 *
 * Three things make it different from every other screen in this module, and
 * all three are deliberate:
 *
 * 1. **Tap a name, then a PIN — not a PIN alone.** A PIN that identified on its
 *    own would have to be unique across the business and would cost a scrypt
 *    verification per worker per keypress. One tap buys both away, and
 *    `core/pin.ts` carries the longer argument.
 * 2. **ONE button for both directions.** Nobody standing here has to know
 *    whether they are arriving or leaving; the database already does. Two
 *    buttons would only add a way to press the wrong one.
 * 3. **The client id is minted BEFORE the request and kept across retries.** A
 *    barn has no signal worth the name, and this is the half of offline that
 *    cannot be retrofitted — the same call retail's till made.
 *
 * What it is NOT, yet: offline. If the request fails it says so and keeps the
 * PIN typed, rather than pretending the punch landed. That is the honest
 * failure for a clock, and the rest of offline — a service worker and a durable
 * queue — is Layer 0 platform work with its own ADR to write.
 */

export interface KioskWorker {
  id: string;
  name: string;
  /** In since when, as a formatted local time, or null if they are out. */
  clockedInSince: string | null;
}

/**
 * What this device calls itself, kept in the BROWSER and read through
 * `useSyncExternalStore` — the marketing editor's preview-device pattern, and
 * for its reason: the server renders nothing, the client reads what this
 * browser last chose, and neither needs a state update inside an effect. A
 * browser that refuses storage still shows what was typed this session.
 *
 * It belongs to the device and not to the tenant. Two tablets in one business
 * have two different answers, and no server row could hold both.
 */
const DEVICE_KEY = "yosher.time.deviceLabel";
const DEVICE_EVENT = "yosher:time-device-label";
let typedThisSession = "";

function readDeviceLabel(): string {
  try {
    return window.localStorage.getItem(DEVICE_KEY) ?? typedThisSession;
  } catch {
    return typedThisSession;
  }
}

function subscribeDeviceLabel(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(DEVICE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DEVICE_EVENT, onChange);
  };
}

function rememberDeviceLabel(value: string): void {
  typedThisSession = value;
  try {
    window.localStorage.setItem(DEVICE_KEY, value);
  } catch {
    // A label is a nicety, not a requirement.
  }
  window.dispatchEvent(new Event(DEVICE_EVENT));
}

/** Shown for a few seconds after a punch, then it clears itself. */
interface Said {
  tone: "in" | "out" | "bad";
  title: string;
  detail: string;
}

export function Kiosk({ workers }: { workers: KioskWorker[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<KioskWorker | null>(null);
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const [naming, setNaming] = useState(false);
  const device = useSyncExternalStore(
    subscribeDeviceLabel,
    readDeviceLabel,
    () => "",
  );

  /*
   * THE SAME ID SURVIVES A RETRY. Minted when the punch is first attempted and
   * only cleared once the server has answered — so a second press after a
   * timeout finds the punch the first press already started, rather than being
   * told somebody is already clocked in.
   */
  const clientRef = useRef<string | null>(null);

  // Back to the list on its own, so the next person does not find somebody
  // else's name half-entered.
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => {
      setSaid(null);
      setPicked(null);
      setPin("");
    }, 6000);
    return () => clearTimeout(timer);
  }, [said]);

  async function submit() {
    if (!picked || pin.length < PIN_MIN_LENGTH || pending) return;
    setPending(true);
    clientRef.current ??= crypto.randomUUID();
    try {
      const result = await punchWithPinAction({
        workerId: picked.id,
        pin,
        clientRef: clientRef.current,
        deviceLabel: device,
      });
      if ("error" in result) {
        setSaid({ tone: "bad", title: "Something went wrong", detail: result.error });
        setPin("");
        return;
      }
      const data = result.data!;
      if (data.kind === "wrong" || data.kind === "locked") {
        // The id is NOT cleared: nothing was written, and the next attempt is a
        // different punch anyway once the PIN changes.
        setSaid({ tone: "bad", title: data.message, detail: "Try again." });
        setPin("");
        return;
      }
      if (data.kind === "refused") {
        // A locked pay period. Not a wrong PIN, and "try again" would be a lie.
        setSaid({ tone: "bad", title: "Not recorded", detail: data.message });
        setPin("");
        return;
      }
      clientRef.current = null;
      setSaid({
        tone: data.kind === "clocked_in" ? "in" : "out",
        title: data.workerName ?? "Done",
        detail: data.message,
      });
      router.refresh();
    } catch {
      // A dropped request, which in a barn is the ordinary failure. Say so, and
      // keep the id so pressing again resumes rather than duplicates.
      setSaid({
        tone: "bad",
        title: "No connection",
        detail: "Nothing was sent. Press the button again when you have a signal.",
      });
    } finally {
      setPending(false);
    }
  }

  if (said) {
    const tone =
      said.tone === "bad"
        ? "border-warning/40 bg-warning/10"
        : "border-success/40 bg-success/10";
    return (
      <div
        className={`flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-lg border p-8 text-center ${tone}`}
      >
        {said.tone !== "bad" &&
          (said.tone === "in" ? (
            <LogIn className="size-10 text-success-foreground" />
          ) : (
            <LogOut className="size-10 text-success-foreground" />
          ))}
        <p className="text-3xl font-medium tracking-heading">{said.title}</p>
        <p className="text-lg text-muted-foreground">{said.detail}</p>
        <Button
          variant="outline"
          size="lg"
          className="mt-4"
          onClick={() => {
            setSaid(null);
            setPicked(null);
            setPin("");
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  if (picked) {
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <div className="text-center">
          <p className="text-2xl font-medium tracking-heading">{picked.name}</p>
          <p className="text-sm text-muted-foreground">
            {picked.clockedInSince
              ? `Clocked in since ${picked.clockedInSince}. Your PIN clocks you out.`
              : "Type your PIN to clock in."}
          </p>
        </div>

        {/* Dots, not digits. Somebody is always standing behind you at a
            shared device. */}
        <div
          className="flex justify-center gap-2"
          aria-label={`${pin.length} digits entered`}
        >
          {Array.from({ length: Math.max(PIN_MIN_LENGTH, pin.length) }).map(
            (_, i) => (
              <span
                key={i}
                className={`size-3 rounded-full ${
                  i < pin.length ? "bg-foreground" : "bg-divider"
                }`}
              />
            ),
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <KeypadKey key={d} onPress={() => setPin((p) => (p.length < PIN_MAX_LENGTH ? p + d : p))}>
              {d}
            </KeypadKey>
          ))}
          <KeypadKey onPress={() => setPin("")} muted>
            <span className="text-base">Clear</span>
          </KeypadKey>
          <KeypadKey onPress={() => setPin((p) => (p.length < PIN_MAX_LENGTH ? p + "0" : p))}>
            0
          </KeypadKey>
          <KeypadKey onPress={() => setPin((p) => p.slice(0, -1))} muted>
            <Delete className="size-5" />
          </KeypadKey>
        </div>

        <Button
          size="lg"
          className="h-14 text-lg"
          disabled={pin.length < PIN_MIN_LENGTH || pending}
          onClick={submit}
        >
          {pending
            ? "Just a moment…"
            : picked.clockedInSince
              ? "Clock out"
              : "Clock in"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setPicked(null);
            setPin("");
            clientRef.current = null;
          }}
        >
          Not me
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {workers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
          Nobody has a PIN yet. An owner gives people one on the People page,
          and then their name appears here.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {workers.map((worker) => (
            <li key={worker.id}>
              {/* A tap target for a gloved hand: the whole tile, 72px tall. */}
              <button
                type="button"
                onClick={() => setPicked(worker)}
                className="flex h-[72px] w-full items-center justify-between gap-3 rounded-lg border border-border px-4 text-left shadow-elevation-1 transition-colors hover:bg-subtle"
              >
                <span className="min-w-0 truncate text-lg font-medium">
                  {worker.name}
                </span>
                {worker.clockedInSince ? (
                  <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success-foreground">
                    in since {worker.clockedInSince}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-subtle-foreground">
                    out
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-center gap-2 pt-2">
        {naming ? (
          <div className="flex w-full max-w-sm items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="device">What is this device called?</Label>
              <Input
                id="device"
                value={device}
                maxLength={60}
                placeholder="Barn door"
                onChange={(e) => rememberDeviceLabel(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={() => setNaming(false)}>
              Done
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNaming(true)}
            className="text-subtle-foreground"
          >
            <Settings2 className="mr-1 size-3.5" />
            {device || "Name this device"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** One key. Tall enough to hit without looking. */
function KeypadKey({
  children,
  onPress,
  muted,
}: {
  children: React.ReactNode;
  onPress: () => void;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`h-16 rounded-lg border border-border text-2xl font-medium transition-colors active:bg-subtle ${
        muted ? "text-muted-foreground" : ""
      } flex items-center justify-center`}
    >
      {children}
    </button>
  );
}
