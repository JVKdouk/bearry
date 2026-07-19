import pluralize from "pluralize";

import { FastifyInstance } from "fastify";
import { ControllerMap } from "../endpoints/types";
import { Router } from ".";

/**
 * Create all routers based on a mapping of endpoints
 * @returns List of created routers
 */
export async function createRouters(controllers: ControllerMap) {
  const routers: Router[] = [];

  // Register all controllers as separate routers
  for (const controller in controllers) {
    const slug = controllers[controller].settings.prefix;
    const prefix = slug || pluralize(controller.toLowerCase());
    const router = new Router(prefix);

    router.setEndpoints(controllers[controller].endpoints);
    routers.push(router);
  }

  return routers;
}

/**
 * Register all provided routers routers in a Fastify Instance
 * @param instance Fastify Instance that will work as the web engine
 * @param routers List of routers to install into the Fastify Instance
 * @returns The modified Fastify Instance
 */
export async function registerRouters(
  routers: Router[],
  instance: FastifyInstance,
) {
  for (const router of routers) {
    instance.register(router.createInstance(), { prefix: router.prefix });
  }

  return instance;
}
