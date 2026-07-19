import { Endpoint } from "@/core/server/endpoints/types";

/** Returns the authenticated user's safe profile (never the password hash). */
const me: Endpoint = async (request) => {
  const user = request.user;

  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    created_at: user.created_at,
  };
};

me.httpMethod = "GET";
me.path = "/me";

export default me;
