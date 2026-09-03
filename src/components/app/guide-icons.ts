import {
  ArrowLeft,
  Banknote,
  Building2,
  Check,
  ChevronDown,
  CircleQuestionMark,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Link as LinkIcon,
  Lock,
  LockOpen,
  Menu,
  Paperclip,
  Pencil,
  PenLine,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { ICONS } from "./icon-registry";

/**
 * The icons a guide may draw on a control — `{button:New bill|primary|plus}`,
 * `{icon:circle-question-mark}` — by the name an author would guess.
 *
 * A separate map from `ICONS` because that one is the module registry, where a
 * missing key is a wrong sidebar; this one is decoration on a facsimile. The
 * registry's names are accepted too, so a guide can draw a tool's own icon
 * when it tells the reader which sidebar row to look for. No fallback: an
 * unknown name draws nothing at render time and fails `tests/guides.test.ts`,
 * which is how a typo is caught before a client reads it.
 */
export const CONTROL_ICONS: Record<string, LucideIcon> = {
  "arrow-left": ArrowLeft,
  banknote: Banknote,
  building: Building2,
  check: Check,
  "chevron-down": ChevronDown,
  "circle-question-mark": CircleQuestionMark,
  copy: Copy,
  download: Download,
  "external-link": ExternalLink,
  eye: Eye,
  filter: Filter,
  link: LinkIcon,
  lock: Lock,
  "lock-open": LockOpen,
  menu: Menu,
  paperclip: Paperclip,
  pencil: Pencil,
  "pen-line": PenLine,
  plus: Plus,
  printer: Printer,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  trash: Trash2,
  undo: Undo2,
  upload: Upload,
  x: X,
};

export function getControlIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null;
  return CONTROL_ICONS[name] ?? ICONS[name] ?? null;
}

/** Every name a marker may use, for the test that checks the real tree. */
export function controlIconNames(): Set<string> {
  return new Set([...Object.keys(CONTROL_ICONS), ...Object.keys(ICONS)]);
}
