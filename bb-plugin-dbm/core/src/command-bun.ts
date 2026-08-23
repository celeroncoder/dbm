import { Effect, Layer } from "effect"
import { CommandError } from "./errors"
import { CommandRunner } from "./command"
import type { CommandOptions, CommandResult } from "./command"

const commandText = (command: string, args: ReadonlyArray<string>): string =>
  [command, ...args].join(" ")

const runBunCommand = Effect.fn("BunCommandRunner.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options?: CommandOptions
) {
  const result = yield* Effect.tryPromise({
    try: async (): Promise<CommandResult> => {
      const subprocess = Bun.spawn([command, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          ...options?.env
        }
      })

      const commandResult = subprocess.exited.then(async (exitCode) => ({
        stdout: await new Response(subprocess.stdout).text(),
        stderr: await new Response(subprocess.stderr).text(),
        exitCode
      }))

      const timeoutMs = options?.timeoutMs ?? 30_000
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<CommandResult>((_resolve, reject) => {
        timer = setTimeout(() => {
          subprocess.kill()
          reject(new Error(`Command timed out after ${timeoutMs}ms.`))
        }, timeoutMs)
      })

      try {
        return await Promise.race([commandResult, timeout])
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer)
        }
      }
    },
    catch: (cause) =>
      new CommandError({
        command: options?.displayCommand ?? commandText(command, args),
        message: cause instanceof Error ? cause.message : String(cause),
        exitCode: -1,
        stderr: ""
      })
  })

  if (result.exitCode !== 0) {
    return yield* Effect.fail(
      new CommandError({
        command: options?.displayCommand ?? commandText(command, args),
        message: `Command exited with status ${result.exitCode}.`,
        exitCode: result.exitCode,
        stderr: result.stderr.trim()
      })
    )
  }

  return result
})

export const CommandRunnerLive = Layer.succeed(CommandRunner)({
  run: runBunCommand
})
