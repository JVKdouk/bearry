import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";
import GenericError from "@/core/server/errors/generic";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";

const Body = z.object({
  // Optional overrides when the user swipes to change type/project (§8.6).
  type: z.enum(["task", "note", "event", "trash"]).optional(),
  projectId: z.string().nullable().optional(),
});

const Params = z.object({ id: z.string() });

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

  let createdType = type;
  let createdId: string | null = null;

  if (type === "task") {
    const todo = await database.todo.create({
      data: crypto.encrypt("Todo", {
        userId: request.user.id,
        projectId: projectId ?? null,
        title,
        notes: null,
        deadline: fields.date ? new Date(fields.date) : null,
        estimatedDuration: fields.durationMinutes ?? 30,
      }),
      select: { id: true },
    });
    createdId = todo.id;
  } else if (type === "event") {
    const start = fields.date ? new Date(fields.date) : new Date();
    const end = fields.endDate
      ? new Date(fields.endDate)
      : new Date(start.getTime() + (fields.durationMinutes ?? 60) * 60_000);
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
