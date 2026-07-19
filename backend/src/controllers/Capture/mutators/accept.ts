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
  const projectId = body.projectId === undefined ? (item.suggestedProjectId as string | null) : body.projectId;
  const title = String(fields.title ?? item.rawContent).slice(0, 200);

  const chosenDate = resolveOverride(body.date, fields.date as string | undefined);
  const chosenDuration = resolveOverride(
    body.durationMinutes,
    fields.durationMinutes as number | undefined,
  );

  let createdType = type;
  let createdId: string | null = null;

  // Three creates became one. Accepting a capture used to branch into a
  // different table per type, with a different field for the body and a
  // different name for the time — which is why "task" wrote `notes: null` and
  // dropped the raw text, while "note" kept it.
  if (type === "task" || type === "event" || type === "note") {
    const start = chosenDate ? new Date(chosenDate) : null;
    // An explicit start override invalidates the extracted end, which was
    // derived from the old one — fall back to the duration instead.
    const useExtractedEnd = body.date === undefined && fields.endDate;
    const end =
      type === "event"
        ? useExtractedEnd
          ? new Date(fields.endDate as string)
          : new Date((start ?? new Date()).getTime() + (chosenDuration ?? 60) * 60_000)
        : null;

    const created = await database.block.create({
      data: crypto.encrypt("Block", {
        userId: request.user.id,
        kind: type,
        projectId: type === "task" ? (projectId ?? null) : null,
        title,
        // The raw capture is kept on every kind now. It was only ever dropped
        // for tasks because `notes` and `bodyMarkdown` were different columns
        // and the task branch didn't think to fill one.
        body: title === String(item.rawContent) ? null : String(item.rawContent),
        deadline: type === "task" && start ? start : null,
        startTime: type === "event" ? (start ?? new Date()) : null,
        endTime: end,
        estimatedDuration: chosenDuration ?? (type === "event" ? 60 : 30),
        // User-captured commitments are protected by default (§9.3).
        isFixed: type === "event",
      }),
      select: { id: true },
    });
    createdId = created.id;
  } else {
    // trash: nothing to materialize, just close the item out.
    createdType = "trash";
  }

  // Link the new block back to its capture so provenance is visible (§8.7).
  // The link no longer has to name the kind: everything it can point at on
  // this side is a block.
  if (createdId) {
    await database.link.create({
      data: {
        userId: request.user.id,
        fromType: "block",
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
