/**
 * Plugin auto-registration. Each plugin's manifest is validated on register()
 * (registry.ts), so a malformed plugin fails at boot. Adding an integration =
 * one import + one register line.
 */

import { register } from "../registry";
import { googleCalendarProvider } from "./googleCalendar";
import { icsCalendarProvider } from "./icsCalendar";
import { tickTickProvider } from "./ticktick";
import { comingSoonProviders } from "./comingSoon";

let done = false;

export function registerAllProviders(): void {
  if (done) return;
  register(googleCalendarProvider);
  register(icsCalendarProvider);
  register(tickTickProvider);
  comingSoonProviders.forEach(register);
  done = true;
}
