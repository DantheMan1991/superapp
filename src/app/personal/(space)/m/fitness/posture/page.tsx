import Link from "next/link";
import { ScanLine, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { STICKERS, type Sticker } from "@/modules/fitness/posture/core/sticker-map";
import { ChecksOnPhone } from "@/modules/fitness/posture/components/checks-on-phone";
import { RoomDiagram, StickerDiagram } from "@/modules/fitness/posture/components/diagrams";
import { LastReadout } from "@/modules/fitness/posture/components/last-readout";

export const dynamic = "force-dynamic";

/**
 * POSTURE CHECK (docs/help/fitness/posture.md; docs/modules/posture.md): the
 * way into the check itself and the checks this phone has kept, then what the
 * check needs (a room, a plumb line, stickers), where each sticker goes and
 * how to find the bone under it, and the way into checking the setup.
 */
export default async function PosturePage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");

  const midline = STICKERS.filter((s) => s.side === "mid");
  const pairs = STICKERS.filter((s) => s.side === "right");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Posture check"
        description="Measure how you stand, with your phone's camera and small stickers on your bones."
        icon={<ScanLine />}
      />

      <section className="flex gap-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-module-accent" aria-hidden />
        <div className="space-y-1 text-sm">
          <h2 className="font-medium">Nothing the camera sees leaves your phone</h2>
          <p className="text-muted-foreground">
            Every picture is read on the phone itself and forgotten straight away, unless you choose to keep a photo of
            each view, which stays on this phone. What the check keeps is numbers: angles and where each sticker was.
            Wear snug shorts or briefs pushed down below your front hip bones and the dimples above your buttocks: the
            check reads just as well, and nothing more of you is ever in front of the camera than it needs.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <h2 className="font-medium">Check your posture</h2>
        <p className="text-sm text-muted-foreground">
          About three minutes: the voice turns you to all four sides, twice, and the report opens when it is done. It
          describes how you stood that day, for fitness and body awareness, not as a medical assessment.
        </p>
        <Button asChild>
          <Link href="/personal/m/fitness/posture/check">Start a posture check</Link>
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="font-heading font-medium tracking-heading">Your checks on this phone</h2>
        <p className="text-sm text-muted-foreground">
          Kept in this browser on this phone only, for now. Your account does not have them yet, so another phone or
          browser will not show them.
        </p>
        <ChecksOnPhone owner={ctx.tenant.id} reportHref="/personal/m/fitness/posture/checks" />
      </section>

      <section className="space-y-2">
        <h2 className="font-heading font-medium tracking-heading">What you need</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>A tripod, or anything that holds the phone upright and still at hip height.</li>
          <li>
            Round matte stickers, 19 to 25 mm across: blue for your left side, green for your right. Office color-coding
            dots work. Not glossy: shine hides the color.
          </li>
          <li>
            A plumb line: a dark cord about 5 mm thick with a weight on the end, and two pieces of bright red or orange
            tape around it exactly 1 m apart.
          </li>
          <li>Painter&apos;s tape for a foot outline on the floor.</li>
          <li>Someone to put on the three stickers you cannot reach well: the base of your neck and the two low back dimples.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-medium tracking-heading">Set up the room</h2>
        <RoomDiagram />
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>A plain matte wall behind you: gray or white, not blue or green (those are the stickers&apos; colors).</li>
          <li>Tape a foot outline about 0.6 m out from the wall, and stand in it every time.</li>
          <li>Hang the plumb line beside the outline, at the same distance from the phone as you, from above the top of the picture to the floor.</li>
          <li>
            The phone 3 to 3.5 m from the outline, upright, at hip height, the rear camera toward you. Keep the height
            and distance the same every check.
          </li>
          <li>Soft, even light from beside the phone. No window or mirror in the picture, and nobody else in it.</li>
          <li>A warm room: shivering is movement.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-medium tracking-heading">Where the stickers go</h2>
        <StickerDiagram />
        <p className="text-sm text-muted-foreground">
          Put them on standing, on clean dry skin, in the same order each time. Twenty in all: two on the midline and
          nine pairs.
        </p>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
          {[...midline, ...pairs].map((s) => (
            <StickerRow key={s.id} sticker={s} />
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <h2 className="font-medium">Check your setup</h2>
        <p className="text-sm text-muted-foreground">
          Before the first check, and whenever the phone, the room or the stickers change: it proves the camera, the
          level, the plumb line and the stickers on this phone, and gives you a readout of numbers to send.
        </p>
        <Button asChild variant="outline">
          <Link href="/personal/m/fitness/posture/setup">Check your setup</Link>
        </Button>
        <LastReadout />
      </section>
    </div>
  );
}

function StickerRow({ sticker }: { sticker: Sticker }) {
  const pair = sticker.side !== "mid";
  const name = pair ? sticker.name.replace(/^Right /, "") : sticker.name;
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="mt-1 flex shrink-0 gap-1" aria-hidden>
        {pair ? (
          <>
            <span className="size-3 rounded-full bg-[#3b82f6]" />
            <span className="size-3 rounded-full bg-[#22c55e]" />
          </>
        ) : (
          <span className="size-3 rounded-full border border-muted-foreground bg-white" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="first-letter:uppercase">{pair ? `${name}, both sides` : name}</span>
          {sticker.helper && <Badge variant="outline">Needs a helper</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{sticker.find}</p>
      </div>
    </li>
  );
}
