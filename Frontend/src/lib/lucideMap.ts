/**
 * The Lucide icons we actually use, imported one by one.
 *
 * `import * as Lucide from "lucide-react"` pulls all ~6,000 icons into the
 * bundle — it added a 677 KB chunk and pushed the lists settings route past
 * half a megabyte. Next's tree-shaking can't help a namespace import that's
 * indexed by a runtime string. Importing the curated set explicitly is the
 * whole fix: only these components ship.
 *
 * The set must stay in step with LUCIDE_CHOICES in listIcon.ts. A test
 * (list-icon.test.ts) asserts every choice resolves; add an entry here and a
 * name there together, or the picker offers an icon that renders as a dot.
 */

import {
  House,
  Briefcase,
  User,
  Users,
  ShoppingCart,
  Wallet,
  Plane,
  Car,
  BookOpen,
  Pencil,
  Lightbulb,
  Palette,
  Music,
  Gamepad2,
  Dumbbell,
  Leaf,
  Heart,
  Brain,
  Wrench,
  Phone,
  Package,
  Calendar,
  Clock,
  Target,
  Flame,
  Star,
  Flag,
  Inbox,
  type LucideIcon,
} from "lucide-react";

/** Keyed by the kebab-case names stored in the database (`lucide:<name>`). */
export const LUCIDE_MAP: Record<string, LucideIcon> = {
  house: House,
  briefcase: Briefcase,
  user: User,
  users: Users,
  "shopping-cart": ShoppingCart,
  wallet: Wallet,
  plane: Plane,
  car: Car,
  "book-open": BookOpen,
  pencil: Pencil,
  lightbulb: Lightbulb,
  palette: Palette,
  music: Music,
  "gamepad-2": Gamepad2,
  dumbbell: Dumbbell,
  leaf: Leaf,
  heart: Heart,
  brain: Brain,
  wrench: Wrench,
  phone: Phone,
  package: Package,
  calendar: Calendar,
  clock: Clock,
  target: Target,
  flame: Flame,
  star: Star,
  flag: Flag,
  inbox: Inbox,
};
