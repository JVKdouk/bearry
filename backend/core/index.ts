import "./config";
import "./server/telemetry";

import startServer from "./server";
import { reportTelemetryError } from "./server/telemetry";

// A sync try/catch can't catch the async rejection, so report it on the promise.
startServer().catch(reportTelemetryError);

process.on("uncaughtException", reportTelemetryError);
