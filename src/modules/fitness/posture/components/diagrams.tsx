/**
 * THE POSTURE CHECK'S TWO DRAWINGS (docs/help/fitness/posture.md): the room,
 * from above, and where the twenty stickers go, from the front, the back and
 * the right side. Drawings, never photographs: a guide to placing stickers on
 * bare skin must not need a picture of anybody's.
 */

const BLUE = "#3b82f6";
const GREEN = "#22c55e";

export function RoomDiagram() {
  return (
    <svg viewBox="0 0 360 330" role="img" aria-labelledby="room-title" className="h-auto w-full max-w-md text-muted-foreground">
      <title id="room-title">
        The room from above: a plain wall, a taped foot outline about 0.6 m in front of it, a plumb line hanging
        beside the outline, and the phone on a tripod 3 to 3.5 m away, with a lamp beside it.
      </title>
      <rect x="20" y="16" width="320" height="10" rx="2" className="fill-muted stroke-border" strokeWidth="1" />
      <text x="180" y="44" textAnchor="middle" className="fill-current text-[11px]">
        Plain matte wall, not blue or green
      </text>
      <line x1="180" y1="286" x2="70" y2="26" stroke="currentColor" strokeWidth="0.75" strokeDasharray="3 4" />
      <line x1="180" y1="286" x2="290" y2="26" stroke="currentColor" strokeWidth="0.75" strokeDasharray="3 4" />
      <rect x="156" y="64" width="48" height="34" rx="4" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
      <ellipse cx="180" cy="76" rx="24" ry="9" fill="none" className="stroke-foreground" strokeWidth="1.2" />
      <circle cx="180" cy="76" r="6.5" fill="none" className="stroke-foreground" strokeWidth="1.2" />
      <text x="180" y="116" textAnchor="middle" className="fill-current text-[11px]">
        Foot outline in tape
      </text>
      <circle cx="238" cy="78" r="5" className="fill-module-accent" />
      <text x="248" y="82" className="fill-current text-[11px]">
        Plumb line
      </text>
      <line x1="120" y1="98" x2="120" y2="278" stroke="currentColor" strokeWidth="1" markerStart="url(#room-arrow)" markerEnd="url(#room-arrow)" />
      <text x="112" y="192" textAnchor="end" className="fill-current text-[11px]">
        3–3.5 m
      </text>
      <rect x="168" y="280" width="24" height="10" rx="2" className="fill-module-accent" />
      <line x1="180" y1="290" x2="166" y2="308" stroke="currentColor" strokeWidth="1.2" />
      <line x1="180" y1="290" x2="194" y2="308" stroke="currentColor" strokeWidth="1.2" />
      <line x1="180" y1="290" x2="180" y2="312" stroke="currentColor" strokeWidth="1.2" />
      <text x="200" y="300" className="fill-current text-[11px]">
        Phone, rear camera, hip height
      </text>
      <circle cx="240" cy="318" r="7" className="fill-warning/60" />
      <text x="252" y="322" className="fill-current text-[11px]">
        Lamp beside it
      </text>
      <defs>
        <marker id="room-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </marker>
      </defs>
    </svg>
  );
}

type Dot = { x: number; y: number; colour: "blue" | "green" | "mid" };

function Figure({ side = false }: { side?: boolean }) {
  return side ? (
    <g fill="none" className="stroke-foreground/70" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="60" cy="28" r="15" />
      <path d="M52 42 L50 56 M50 56 C44 90 44 120 50 150 M60 60 C70 90 72 120 68 150 M50 150 L68 150" />
      <path d="M56 62 L58 110 L60 150" />
      <path d="M52 150 L56 215 L54 280 L72 284 M64 150 L64 215 L60 280" />
    </g>
  ) : (
    <g fill="none" className="stroke-foreground/70" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="60" cy="28" r="15" />
      <path d="M54 43 L54 52 M66 43 L66 52 M30 60 L90 60 M34 62 L42 150 M86 62 L78 150 M42 150 L78 150" />
      <path d="M30 60 L24 112 L22 160 M90 60 L96 112 L98 160" />
      <path d="M44 150 L46 215 L47 280 M58 152 L56 215 L54 280 M76 150 L74 215 L73 280 M62 152 L64 215 L66 280" />
    </g>
  );
}

function Dots({ dots }: { dots: Dot[] }) {
  return (
    <g>
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r="4.5"
          fill={d.colour === "blue" ? BLUE : d.colour === "green" ? GREEN : "#ffffff"}
          stroke={d.colour === "mid" ? "#6b7280" : "#ffffff"}
          strokeWidth="1.2"
        />
      ))}
    </g>
  );
}

// The person's right is the drawing's left from the front, and its right from behind.
const FRONT: Dot[] = [
  { x: 60, y: 66, colour: "mid" },
  { x: 31, y: 58, colour: "green" },
  { x: 89, y: 58, colour: "blue" },
  { x: 45, y: 138, colour: "green" },
  { x: 75, y: 138, colour: "blue" },
  { x: 51, y: 214, colour: "green" },
  { x: 69, y: 214, colour: "blue" },
  { x: 50, y: 276, colour: "green" },
  { x: 70, y: 276, colour: "blue" },
];
const BACK: Dot[] = [
  { x: 60, y: 52, colour: "mid" },
  { x: 31, y: 58, colour: "blue" },
  { x: 89, y: 58, colour: "green" },
  { x: 54, y: 136, colour: "blue" },
  { x: 66, y: 136, colour: "green" },
];
const RIGHT_SIDE: Dot[] = [
  { x: 57, y: 30, colour: "green" },
  { x: 49, y: 54, colour: "mid" },
  { x: 58, y: 62, colour: "green" },
  { x: 68, y: 136, colour: "green" },
  { x: 49, y: 134, colour: "green" },
  { x: 58, y: 152, colour: "green" },
  { x: 60, y: 214, colour: "green" },
  { x: 58, y: 276, colour: "green" },
];

export function StickerDiagram() {
  return (
    <svg viewBox="0 0 380 320" role="img" aria-labelledby="stickers-title" className="h-auto w-full max-w-lg">
      <title id="stickers-title">
        Where the stickers go, from the front, the back and the right side. Blue on the left side of the body, green
        on the right, white on the midline.
      </title>
      <g>
        <Figure />
        <Dots dots={FRONT} />
        <text x="60" y="306" textAnchor="middle" className="fill-muted-foreground text-[11px]">
          Front
        </text>
      </g>
      <g transform="translate(130 0)">
        <Figure />
        <Dots dots={BACK} />
        <text x="60" y="306" textAnchor="middle" className="fill-muted-foreground text-[11px]">
          Back
        </text>
      </g>
      <g transform="translate(260 0)">
        <Figure side />
        <Dots dots={RIGHT_SIDE} />
        <text x="60" y="306" textAnchor="middle" className="fill-muted-foreground text-[11px]">
          Right side
        </text>
      </g>
    </svg>
  );
}
