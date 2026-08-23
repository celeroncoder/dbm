import { Context, Effect, Layer } from "effect"
import { InputError } from "../core/errors"

export class Terminal extends Context.Service<Terminal, {
  readonly readLine: (message: string) => Effect.Effect<string, InputError>
  readonly writeLine: (message: string) => Effect.Effect<void>
}>()("dbm/Terminal") {}

export type TerminalService = Context.Service.Shape<typeof Terminal>

export const TerminalLive = Layer.succeed(Terminal)({
  readLine: Effect.fn("Terminal.readLine")(function* (message: string) {
    const response = yield* Effect.try({
      try: () => globalThis.prompt(message),
      catch: (cause) =>
        InputError.make({
          message: cause instanceof Error ? cause.message : String(cause)
        })
    })
    return response ?? ""
  }),
  writeLine: Effect.fn("Terminal.writeLine")(function* (message: string) {
    yield* Effect.sync(() => console.log(message))
  })
})
