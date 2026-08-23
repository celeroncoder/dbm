import { Schema } from "effect"

export class CommandError extends Schema.TaggedError<CommandError>()(
  "CommandError",
  {
    command: Schema.String,
    message: Schema.String,
    exitCode: Schema.Number,
    stderr: Schema.String
  }
) {}

export class DockerUnavailable extends Schema.TaggedError<DockerUnavailable>()(
  "DockerUnavailable",
  {
    message: Schema.String
  }
) {}

export class DockerOperationError extends Schema.TaggedError<DockerOperationError>()(
  "DockerOperationError",
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export class DatabaseOperationError extends Schema.TaggedError<DatabaseOperationError>()(
  "DatabaseOperationError",
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export class InputError extends Schema.TaggedError<InputError>()(
  "InputError",
  {
    message: Schema.String
  }
) {}

export type CoreError =
  | CommandError
  | DockerUnavailable
  | DockerOperationError
  | DatabaseOperationError
  | InputError
