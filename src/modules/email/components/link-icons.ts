import {
  File,
  FileText,
  FolderOpen,
  Link2,
  Receipt,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react";

/**
 * Extension icon name → component.
 *
 * Extensions declare an icon as a STRING, exactly as `ModuleDefinition` does and
 * for the same reason: an extension may be resolved in a server component and
 * its description handed to a client one, and a React component is not
 * serializable across that boundary. Names are.
 *
 * An unknown name falls back to a generic link rather than throwing. A module
 * contributing an icon this file has not heard of is a cosmetic mismatch, and a
 * cosmetic mismatch must never be why a reading pane fails to render.
 */
const ICONS: Record<string, LucideIcon> = {
  receipt: Receipt,
  "file-text": FileText,
  file: File,
  folder: FolderOpen,
  user: User,
  truck: Truck,
};

export function linkIcon(name: string): LucideIcon {
  return ICONS[name] ?? Link2;
}
