/**
 * Work-personality templates.
 *
 * The rhythm settings are individually honest questions, but there are nine of
 * them, and answering nine questions about your own attention before the app
 * will plan anything is exactly the kind of setup task this audience abandons
 * halfway through. A template is one decision that lands all nine somewhere
 * defensible; the individual controls stay right there for anyone who wants to
 * argue with a specific number.
 *
 * The three are genuinely different shapes rather than small/medium/large of
 * the same thing — they differ in the *direction* of the trade, not the amount:
 * many small starts, few long ones, or an even middle.
 *
 * Values here are strings because that's what a `setting` row stores, and going
 * through a number type on the way in and out is a conversion that can only
 * introduce disagreement with the server's parser.
 */

export type PersonaValues = Record<string, string>;

export interface PersonaTemplate {
  id: string;
  name: string;
  /** One line, in terms of how the person works — not what the settings are. */
  tagline: string;
  /** What the planner will actually do differently, so the choice is informed. */
  detail: string;
  values: PersonaValues;
}

/**
 * The neutral middle, and the values a user who never opens this page gets.
 * Mirrors DEFAULT_PERSONA on the server; the mismatch to watch for is this
 * drifting from `backend/src/lib/scheduler/persona.ts`.
 */
export const STEADY: PersonaValues = {
  sessionLength: "50",
  breakLength: "15",
  longBreakEvery: "3",
  longBreakLength: "30",
  dailyMaxMinutes: "240",
  maxSessionsPerDay: "5",
  startDifficulty: "moderate",
  stopDifficulty: "moderate",
  weekendMode: "light",
  flexibility: "balanced",
};

export const PERSONA_TEMPLATES: PersonaTemplate[] = [
  {
    id: "bursts",
    name: "Short bursts",
    tagline: "You start easily but drift after a while.",
    detail:
      "Lots of small blocks with short breaks. The planner will happily give you six separate things in a day, because starting isn't what costs you.",
    values: {
      sessionLength: "25",
      breakLength: "10",
      longBreakEvery: "4",
      longBreakLength: "20",
      dailyMaxMinutes: "180",
      maxSessionsPerDay: "7",
      startDifficulty: "easy",
      stopDifficulty: "easy",
      weekendMode: "light",
      flexibility: "balanced",
    },
  },
  {
    id: "steady",
    name: "Steady pace",
    tagline: "Neither starting nor stopping is the hard part.",
    detail:
      "An even middle: hour-ish blocks, real breaks, and a day that leaves room for everything scheduling can't see.",
    values: STEADY,
  },
  {
    id: "deep",
    name: "Deep dives",
    tagline: "Getting going takes a while, and then you're gone.",
    detail:
      "Few long blocks with generous landing strips after them, and weekends left alone — because a day that costs you three separate starts is a day you'll spend starting.",
    values: {
      sessionLength: "90",
      breakLength: "20",
      longBreakEvery: "2",
      longBreakLength: "45",
      dailyMaxMinutes: "300",
      maxSessionsPerDay: "3",
      startDifficulty: "hard",
      stopDifficulty: "hard",
      weekendMode: "none",
      flexibility: "rigid",
    },
  },
];

/**
 * Which template the current settings are, if any.
 *
 * Compared against the template's own keys rather than the whole settings
 * object: an unrelated `persona.*` key added later shouldn't silently make
 * every template stop matching. Unset keys fall back to STEADY, which is what
 * the solver does too — so a user who has touched nothing reads as "Steady
 * pace" rather than as "Custom", which would be true of the storage and false
 * of their experience.
 */
export function matchTemplate(values: PersonaValues): PersonaTemplate | null {
  return (
    PERSONA_TEMPLATES.find((t) =>
      Object.entries(t.values).every(([k, v]) => (values[k] ?? STEADY[k]) === v),
    ) ?? null
  );
}
