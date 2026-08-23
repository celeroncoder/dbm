import { spawn } from "node:child_process"
import { Context, Effect, Layer } from "effect"
import { CommandError } from "./errors"

export interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface CommandOptions {
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly displayCommand?: string
}

export class CommandRunner extends Context.Service<CommandRunner, {
  readonly run: (
    command: string,
    args: ReadonlyArray<string>,
    options?: CommandOptions
  ) => Effect.Effect<CommandResult, CommandError>
}>()("dbm/CommandRunner") {}

export type CommandRunnerService = Context.Service.Shape<typeof CommandRunner>

const commandText = (command: string, args: ReadonlyArray<string>): string =>
  [command, ...args].join(" ")

const runNodeCommand = Effect.fn("NodeCommandRunner.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options?: CommandOptions
) {
  const result = yield* Effect.tryPromise({
    try: async (): Promise<CommandResult> => {
      const child = spawn(command, [...args], {
        env: { ...process.env, ...options?.env },
        stdio: ["ignore", "pipe", "pipe"]
      })
      let stdout = ""
      let stderr = ""
      child.stdout?.setEncoding("utf8")
      child.stderr?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk
      })

      const timeoutMs = options?.timeoutMs ?? 30_000
      const exitCode = await new Promise<number>((resolve, reject) => {
        let settled = false
        const finish = (callback: () => void) => {
          if (settled) {
            return
          }
          settled = true
          callback()
        }
        const timer = setTimeout(() => {
          child.kill("SIGTERM")
          finish(() => reject(new Error(`Command timed out after ${timeoutMs}ms.`)))
        }, timeoutMs)
        child.once("error", (error: Error) => {
          clearTimeout(timer)
          finish(() => reject(error))
        })
        child.once("close", (code: number | null) => {
          clearTimeout(timer)
          finish(() => resolve(code ?? -1))
        })
      })

      return { stdout, stderr, exitCode }
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

export const CommandRunnerNodeLive = Layer.succeed(CommandRunner)({
  run: runNodeCommand
})
