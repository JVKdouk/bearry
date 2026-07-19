import type {
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";

export type ControllerSettings = {
  prefix?: string;
};

export type ControllerMethod = {
  httpMethod?: string | string[];
  path: string;
  onRequest?: onRequestHookHandler[];
  isPublic?: boolean;
};

export type Endpoint = {
  (this: ControllerMethod, req: FastifyRequest, res: FastifyReply): unknown;
} & ControllerMethod;

export type ControllerMap = Record<
  string,
  { endpoints: Endpoint[]; settings: ControllerSettings }
>;

export type GenericMethodParams = [path: string, handler: Endpoint];
