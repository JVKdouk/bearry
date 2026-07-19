import GenericError from "./generic";

export class PermissionError extends GenericError {
  constructor(message: string) {
    super(message, 403);
  }
}
