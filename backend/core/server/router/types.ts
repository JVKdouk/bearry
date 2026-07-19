import type { _HTTPMethods } from "fastify/types/utils";
import type { Endpoint } from "../endpoints/types";

export type Route = {
  method: _HTTPMethods | _HTTPMethods[];
  path: string;
  handler: Endpoint;
};
