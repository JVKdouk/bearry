import GenericError from "./generic";

export class UserNotFoundError extends GenericError {
  constructor(message = "User not found") {
    super(message, 404);
  }
}
