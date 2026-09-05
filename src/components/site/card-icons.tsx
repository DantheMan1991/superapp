import type { CSSProperties } from "react";
import {
  Award,
  Calendar,
  Check,
  Clock,
  CreditCard,
  Gift,
  Hammer,
  Heart,
  Home,
  Leaf,
  Mail,
  MapPin,
  Package,
  Phone,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Sun,
  Tag,
  ThumbsUp,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CardIconName } from "@/lib/sites/schema";

/**
 * The drawings behind `CARD_ICON_NAMES`. The content model holds a name so a
 * page's JSON stays plain; this is the one place a name becomes a shape.
 * Adding an icon is a name in the schema and a line here, and the test in
 * `tests/site-columns.test.ts` keeps the two lists equal.
 */
export const CARD_ICONS: Record<CardIconName, LucideIcon> = {
  award: Award,
  calendar: Calendar,
  check: Check,
  clock: Clock,
  "credit-card": CreditCard,
  gift: Gift,
  hammer: Hammer,
  heart: Heart,
  home: Home,
  leaf: Leaf,
  mail: Mail,
  "map-pin": MapPin,
  package: Package,
  phone: Phone,
  "shield-check": ShieldCheck,
  "shopping-bag": ShoppingBag,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  tag: Tag,
  "thumbs-up": ThumbsUp,
  truck: Truck,
  users: Users,
  wrench: Wrench,
};

/** A card's icon, or nothing for a blank or unknown name. Decorative: the heading carries the meaning. */
export function CardIcon({
  name,
  className,
  style,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = (CARD_ICONS as Record<string, LucideIcon | undefined>)[name];
  if (!Icon) return null;
  return <Icon className={className} style={style} aria-hidden="true" />;
}
