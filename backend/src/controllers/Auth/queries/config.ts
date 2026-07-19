import { Endpoint } from "@/core/server/endpoints/types";

/**
 * Public auth configuration, so the login screen can render the right thing
 * instead of offering a signup tab that will be refused.
 *
 * Deliberately minimal: it exposes only whether registration is open, which is
 * already observable by anyone who tries to sign up. Nothing here is a secret.
 */
const authConfig: Endpoint = async () => {
  return { signupsOpen: process.env.SIGNUPS_OPEN === "true" };
};

authConfig.httpMethod = "GET";
authConfig.path = "/config";
authConfig.isPublic = true;

export default authConfig;
