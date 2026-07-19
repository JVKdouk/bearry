import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import database from "@/core/database";

const Params = z.object({ id: z.string() });

/** Swipe-to-dismiss a capture. No guilt, no pile-up (§1.4 p2). */
const dismissCapture: Endpoint = async (request) => {
  const { id } = Params.parse(request.params);
  await database.captureItem.updateMany({
    where: { id, userId: request.user.id },
    data: { status: "dismissed" },
  });
  return { ok: true };
};

dismissCapture.httpMethod = "POST";
dismissCapture.path = "/:id/dismiss";

export default dismissCapture;
