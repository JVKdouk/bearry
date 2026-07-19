import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";

const Body = z.object({
  // Optional overrides when the user swipes to change type/project (§8.6).
  type: z.enum(["task", "note", "event", "trash"]).optional(),
  projectId: z.string().nullable().optional(),
  /**
   * Overrides for what the classifier extracted. The triage UI shows its
   * guesses as editable chips, so "confirm, don't configure" still holds — but
   * a wrong date it can't correct means either accepting something known to be
   * wrong or throwing the capture away and retyping it.
   *
   * `null` explicitly clears a suggestion; absent means "keep what was found".
   */
  date: z.string().datetime({ offset: true }).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
});

const Params = z.object({ id: z.string() });

/**
 * Resolve one user override against what the classifier extracted.
 *
 * Three-valued on purpose: `undefined` means the user didn't touch it (keep the
 * suggestion), `null` means they removed it, and a value replaces it. Folding
 * "removed" into "untouched" would make a wrongly-detected date inescapable
 * short of dismissing the capture and retyping it.
 */
export function resolveOverride<T>(override: T | null | undefined, extracted: T | undefined): T | null {
  if (override !== undefined) return override;
  return extracted ?? null;
}

/**
 * The whole maintenance ritual: confirm, don't configure (§8.6). Turns a capture
 * into the real entity in one tap, links it back to the capture (`derived_from`,
 * §8.7 — externalized memory), and marks the capture accepted.
 */
const acceptCapture: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);
  const body = Body.parse(request.body ?? {});
  const crypto = await requestCrypto(request);

  const row = await database.captureItem.findFirst({
    where: { id, userId: request.user.id, status: "pending", deletedAt: null },
  });
  if (!row) throw new GenericError("Capture not found", 404);

  const item = crypto.decrypt("CaptureItem", row as Record<string, unknown>);
  const fields = item.extractedFields ? JSON.parse(String(item.extractedFields)) : {};
  const type = body.type ?? (item.proposedType as string);
  const projectId = body.projectId !== undefined ? body.projectId : (item.suggestedProjectId as string | null);
  const title = String(fields.title ?? item.rawContent).slice(0, 200);

  const chosenDate = resolveOverride(body.date, fields.date as string | undefined);
  const chosenDuration = resolveOverride(
    body.durationMinutes,
    fields.durationMinutes as number | undefined,
  );

  let createdType = type;
  let createdId: string | null = null;

  if (type === "task") {
    const todo = await database.todo.create({
      data: crypto.encrypt("Todo", {
        userId: request.user.id,
        projectId: projectId ?? null,
        title,
        notes: null,
        deadline: chosenDate ? new Date(chosenDate) : null,
        estimatedDuration: chosenDuration ?? 30,
      }),
      select: { id: true },
    });
    createdId = todo.id;
  } else if (type === "event") {
    const start = chosenDate ? new Date(chosenDate) : new Date();
    // An explicit start override invalidates the extracted end, which was
    // derived from the old one — fall back to the duration instead.
    const useExtractedEnd = body.date === undefined && fields.endDate;
    const end = useExtractedEnd
      ? new Date(fields.endDate)
      : new Date(start.getTime() + (chosenDuration ?? 60) * 60_000);
    const event = await database.calendarEvent.create({
      data: crypto.encrypt("CalendarEvent", {
        userId: request.user.id,
        source: "bearai",
        title,
        start,
        end,
        isFixed: true, // user-captured commitments are protected by default (§9.3)
      }),
      select: { id: true },
    });
    createdId = event.id;
  } else if (type === "note") {
    const note = await database.note.create({
      data: crypto.encrypt("Note", {
        userId: request.user.id,
        title,
        bodyMarkdown: String(item.rawContent),
      }),
      select: { id: true },
    });
    createdId = note.id;
  } else {
    // trash: nothing to materialize, just close the item out.
    createdType = "trash";
  }

  // Link the new entity back to its capture so provenance is visible (§8.7).
  // The Link enum names the entity ("todo"), not the capture type ("task").
  const linkFromType = createdType === "task" ? "todo" : createdType;
  if (createdId) {
    await database.link.create({
      data: {
        userId: request.user.id,
        fromType: linkFromType as "todo" | "note" | "event",
        fromId: createdId,
        toType: "capture",
        toId: id,
        linkType: "derived_from",
      },
    });
  }

  await database.captureItem.update({
    where: { id },
    data: { status: "accepted", version: (row.version ?? 1) + 1 },
  });

  return { ok: true, createdType, createdId };
};

acceptCapture.httpMethod = "POST";
acceptCapture.path = "/:id/accept";

export default acceptCapture;
