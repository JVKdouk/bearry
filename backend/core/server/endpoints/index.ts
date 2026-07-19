/**
 * Map all endpoints in the Controllers user directory to a single runtime
 * object. This is useful to avoid exporting/importing multiple endpoints
 * during runtime, mimicking Rails' autoload feature.
 */

import path from "node:path";

import { glob } from "glob";
import { ControllerMap, ControllerSettings } from "../endpoints/types";
import { findDirectory } from "@/core/utils/findDirectory";

const IS_BUILT = import.meta.filename.endsWith(".mjs");
const EXT = IS_BUILT ? ".mjs" : "";

export default async function mapEndpoints() {
  // Find user directory
  const controllersPath = findDirectory('src/controllers');
  const controllersPaths = await glob(path.join(controllersPath, "/*"));

  // Map available controllers
  const controllers: ControllerMap = {};

  for (const controllerPath of controllersPaths) {
    // All endpoints are mapped back to their parent controller
    const basename = path.basename(controllerPath);
    const resolvedControllerPath = path.join(controllerPath, `index${EXT}`);

    let settings = (await import(resolvedControllerPath)) as ControllerSettings;

    // @ts-expect-error default might no be available on import
    if (settings.default) settings = settings.default;

    controllers[basename] = { endpoints: [], settings };

    // Map available endpoints
    const endpointsPaths = await glob(
      path.join(controllerPath, "/{queries,mutators}/*"),
    );

    // Import and assimilate available endpoints
    for (const endpointPath of endpointsPaths) {
      const endpoint = await import(endpointPath);

      if (!endpoint.default) {
        throw new Error(`Invalid endpoint at ${endpointPath}`);
      }

      controllers[basename].endpoints.push(endpoint.default);
    }
  }

  return controllers;
}
