import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { requestCrypto } from "@/src/lib/crypto/requestCrypto";
import { composeDigest } from "@/src/lib/digest/compose";

const Body = z.object({ range: z.enum(["day", "week"]).default("day") });

/** Preview the digest text for the current user (AI if opted-in, else template). */
const preview: Endpoint = async (request) => {
  const { range } = Body.parse(request.body ?? {});
  const crypto = await requestCrypto(request, 100);
  const { text, usedAI } = await composeDigest(request.user.id, range, crypto, request.user.first_name);
  return { range, usedAI, text };
};

preview.httpMethod = "POST";
preview.path = "/preview";

export default preview;
