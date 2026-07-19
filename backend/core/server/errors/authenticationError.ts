import GenericError from "./generic";

export class AuthenticationError extends GenericError {
  constructor(message: string) {
    super(message, 401);
  }
}
