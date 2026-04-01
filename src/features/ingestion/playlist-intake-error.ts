export class PlaylistIntakeError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "PlaylistIntakeError";
  }
}
