import { z } from "zod";
import { Endpoint } from "@/core/server/endpoints/types";
import { previewInvite } from "@/src/lib/sharing/invites";
import GenericError from "@/core/server/errors/generic";

const Params = z.object({ token: z.string().min(10) });

/**
 * What a share link shows before you accept it.
 *
 * Public: the person clicking may not have an account yet, and the whole point
 * of the flow is that the link works before they do. The token is the secret —
 * holding it is what authorises seeing the list's name.
 */
const preview: Endpoint = async (request) => {
  const { token } = Params.parse(request.params);
  const info = await previewInvite(token);
  if (!info) throw new GenericError("This link isn't valid", 404);
  return info;
};

preview.httpMethod = "GET";
preview.path = "/invites/:token";
preview.isPublic = true;

export default preview;
