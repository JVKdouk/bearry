import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import GenericError from "./generic";
import { PermissionError } from "./permissionError";
import { UserNotFoundError } from "./userNotFound";
import { AuthenticationError } from "./authenticationError";
import { reportTelemetryError } from "../telemetry";

export default function errorHandler(
  error: FastifyError,
  req: FastifyRequest,
  res: FastifyReply,
) {
  // Authentication failures are expected traffic — reject with 401 and clear
  // the (possibly stale) cookie, but don't spam telemetry with them.
  if (error instanceof AuthenticationError) {
    return res
      .clearCookie("token")
      .status(error.status)
      .send({ message: error.message });
  }

  // Invalid/unknown-key request bodies (strict zod) are client errors, not 500s.
  if (error instanceof ZodError) {
    return res.status(400).send({
      message: "Invalid request",
      issues: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  // Log errors in development, send errors to telemetry everywhere else
  reportTelemetryError(error, req);

  if (error instanceof GenericError) {
    return res.status(error.status).send({ message: error.message });
  }

  if (error instanceof PermissionError) {
    return res.status(error.status).send({ message: error.message });
  }

  if (error instanceof UserNotFoundError) {
    return res.status(error.status).send({ message: error.message });
  }

  // Unexpected/unclassified error: never leak the raw message (may contain
  // Prisma/internal detail). The real error is logged via reportTelemetryError.
  res.status(500).send({ message: "Internal server error" });
}
