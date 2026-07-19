/**
 * The Router Class is a custom re-implementation of Fastify Router, with lazy
 * allocation of routes allowing controllers to be first defined and later regis-
 * tered into the fastify app. This design choice was made to achieve the same
 * route-definition style as Express.js, while keeping Fastify's performance.
 *
 * Fastify Router shorthand notation is re-implemented at the bottom of the class.
 * Plugin shorthand methods must be re-implemented as well. Once the router is ready
 * to be registered, call createInstance().
 */

import type { _HTTPMethods } from "fastify/types/utils";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
  RouteHandlerMethod,
} from "fastify";
import type { GenericMethodParams, Endpoint } from "../endpoints/types";
import type { Route } from "./types";
import handleAuth from "@/core/middlewares/auth";

export class Router {
  paths: Route[]; // HTTP Methods
  routers: Router[]; // Nested Routing
  prefix: string;

  constructor(prefix: string, paths: Route[] = [], routers: Router[] = []) {
    this.prefix = prefix;
    this.paths = paths;
    this.routers = routers;
  }

  protected addPath(
    method: _HTTPMethods | _HTTPMethods[],
    args: GenericMethodParams,
  ) {
    const path = args[0];
    const handler = args[1];

    this.paths.push({ method, path, handler });
  }

  private applyPrefix(url: string) {
    return `/${this.prefix}${url}`;
  }

  /**
   * Used by the Global Router Tracking System to keep track of routes
   * and later list those routes in development mode.
   * @returns List of routes (pages and HTTP methods) defined in this router.
   */
  public getRoutes() {
    const httpRoutes = this.paths.map((route) => ({
      method: route.method,
      path: this.applyPrefix(route.path),
    }));

    return httpRoutes.sort((a, b) => a.path.localeCompare(b.path));
  }

  public createInstance() {
    return (
      instance: FastifyInstance,
      opts: FastifyPluginOptions,
      done: (err?: Error | undefined) => void,
    ) => {
      // Register paths (HTTP Methods)
      for (let i = 0; i < this.paths.length; i++) {
        const route = this.paths[i];
        const onRequestList = [];

        // Handle authentication for non-public routes
        if (!route.handler.isPublic) {
          onRequestList.push(handleAuth);
        }

        // Append the rest of on request hooks to middleware list
        if (route.handler.onRequest) {
          onRequestList.push(...route.handler.onRequest);
        }

        const handler = async (req: FastifyRequest, res: FastifyReply) => {
          return await route.handler(req, res);
        };

        instance.route({
          url: route.path,
          method: route.method,
          handler: handler as unknown as RouteHandlerMethod,
          onRequest: onRequestList,
        });
      }

      done();
    };
  }

  public setEndpoints(endpoints: Endpoint[]) {
    for (const endpointKey in endpoints) {
      const endpoint = endpoints[endpointKey];
      this.addPath((endpoint.httpMethod as _HTTPMethods) || "GET", [
        endpoint.path,
        endpoint,
      ]);
    }
  }

  /* -------------------------------------------------------------------------- */
  /*                                HTTP Methods                                */
  /* -------------------------------------------------------------------------- */

  public get(...args: GenericMethodParams) {
    this.addPath("GET", args);
  }

  public post(...args: GenericMethodParams) {
    this.addPath("POST", args);
  }

  public put(...args: GenericMethodParams) {
    this.addPath("PUT", args);
  }

  public delete(...args: GenericMethodParams) {
    this.addPath("DELETE", args);
  }

  public options(...args: GenericMethodParams) {
    this.addPath("OPTIONS", args);
  }

  public head(...args: GenericMethodParams) {
    this.addPath("HEAD", args);
  }

  public patch(...args: GenericMethodParams) {
    this.addPath("PATCH", args);
  }

  public nested(router: Router) {
    this.routers.push(router);
  }

  public __getInternals() {
    return {
      paths: this.paths,
      routers: this.routers,
      prefix: this.prefix,
    };
  }
}
