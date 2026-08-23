import { Context, Duration, Effect, Layer, Schema } from "effect"
import { CommandError, DockerOperationError, DockerUnavailable } from "./errors"
import type { CommandOptions, CommandResult, CommandRunnerService } from "./command"
import { CommandRunner as CommandRunnerTag } from "./command"
import type { ContainerPort } from "./model"

export interface DockerContainerSummary {
  readonly id: string
  readonly image: string
  readonly name: string
  readonly status: string
  readonly ports: ReadonlyArray<ContainerPort>
  readonly labelsText: string
}

export interface DockerContainerDetails {
  readonly id: string
  readonly image: string
  readonly name: string
  readonly environment: Readonly<Record<string, string>>
  readonly labels: Readonly<Record<string, string>>
}

export class DockerClient extends Context.Service<DockerClient, {
  readonly check: Effect.Effect<void, DockerUnavailable>
  readonly startOrbStack: Effect.Effect<void, DockerOperationError>
  readonly waitUntilReady: (timeoutMs?: number) => Effect.Effect<void, DockerUnavailable>
  readonly listContainers: Effect.Effect<ReadonlyArray<DockerContainerSummary>, DockerOperationError>
  readonly listAllContainers: Effect.Effect<ReadonlyArray<DockerContainerSummary>, DockerOperationError>
  readonly listManagedContainers: Effect.Effect<ReadonlyArray<DockerContainerSummary>, DockerOperationError>
  readonly imageExists: (image: string) => Effect.Effect<boolean, DockerOperationError>
  readonly inspectContainer: (containerId: string) => Effect.Effect<DockerContainerDetails, DockerOperationError>
  readonly run: (
    args: ReadonlyArray<string>,
    options?: CommandOptions
  ) => Effect.Effect<CommandResult, DockerOperationError>
  readonly start: (containerId: string) => Effect.Effect<void, DockerOperationError>
  readonly restart: (containerId: string) => Effect.Effect<void, DockerOperationError>
  readonly pause: (containerId: string) => Effect.Effect<void, DockerOperationError>
  readonly unpause: (containerId: string) => Effect.Effect<void, DockerOperationError>
  readonly stop: (containerId: string) => Effect.Effect<void, DockerOperationError>
  readonly remove: (containerId: string) => Effect.Effect<void, DockerOperationError>
  readonly logs: (containerId: string, tail?: number) => Effect.Effect<CommandResult, DockerOperationError>
  readonly exec: (
    containerId: string,
    command: string,
    args: ReadonlyArray<string>,
    env?: Readonly<Record<string, string>>
  ) => Effect.Effect<CommandResult, DockerOperationError>
}>()("dbm/DockerClient") {}

export type DockerClientService = Context.Service.Shape<typeof DockerClient>

const RawContainerSchema = Schema.Struct({
  ID: Schema.String,
  Image: Schema.String,
  Names: Schema.String,
  Status: Schema.String,
  Ports: Schema.String,
  Labels: Schema.optional(Schema.String)
})

const parseJsonUnknown = (text: string): Effect.Effect<unknown, DockerOperationError> =>
  Effect.try({
    try: (): unknown => JSON.parse(text),
    catch: (cause) =>
      DockerOperationError.make({
        operation: "parse Docker response",
        message: cause instanceof Error ? cause.message : String(cause)
      })
  })

const decodeJson = <S extends Schema.Top>(
  schema: S,
  text: string,
  operation: string
): Effect.Effect<S["Type"], DockerOperationError, S["DecodingServices"]> =>
  parseJsonUnknown(text).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError((error) =>
          DockerOperationError.make({
            operation,
            message: String(error)
          })
        )
      )
    )
  )

const parsePorts = (ports: string): ReadonlyArray<ContainerPort> => {
  if (ports.trim() === "") {
    return []
  }

  return ports.split(",").flatMap((entry) => {
    const part = entry.trim()
    const match = /(?:(?:0\.0\.0\.0|127\.0\.0\.1|:::|\[::\]):)?(\d+)->(\d+)(?:\/(\w+))?/.exec(part)
    if (match === null) {
      const privateOnly = /(\d+)(?:\/(\w+))?$/.exec(part)
      const privatePort = privateOnly?.[1]
      if (privatePort === undefined) {
        return []
      }
      return privateOnly === null
        ? []
        : [
            {
              privatePort,
              protocol: privateOnly[2]
            }
          ]
    }
    const publicPort = match[1]
    const privatePort = match[2]
    if (publicPort === undefined || privatePort === undefined) {
      return []
    }
    return [
      {
        publicPort,
        privatePort,
        protocol: match[3]
      }
    ]
  })
}

const parseLabelsText = (labelsText: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    labelsText
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label.includes("="))
      .map((label) => {
        const separator = label.indexOf("=")
        return [label.slice(0, separator), label.slice(separator + 1)]
      })
  )

const toCommandFailure = (operation: string, error: CommandError): DockerOperationError =>
  DockerOperationError.make({
    operation,
    message: error.stderr === "" ? error.message : `${error.message} ${error.stderr}`
  })

const isDockerSocketPermissionFailure = (error: CommandError): boolean => {
  const message = `${error.message} ${error.stderr}`.toLowerCase()
  return message.includes("permission denied") &&
    (message.includes("docker.sock") || message.includes("docker api") || message.includes("docker daemon"))
}

const sudoDockerDisplayCommand = (args: ReadonlyArray<string>, options?: CommandOptions): string =>
  options?.displayCommand === undefined
    ? ["sudo", "-n", "docker", ...args].join(" ")
    : `sudo -n ${options.displayCommand}`

const runDocker = (
  runner: CommandRunnerService,
  operation: string,
  args: ReadonlyArray<string>,
  options?: CommandOptions
): Effect.Effect<CommandResult, DockerOperationError> =>
  runner.run("docker", args, options).pipe(
    Effect.catchTag("CommandError", (error) =>
      isDockerSocketPermissionFailure(error)
        ? runner.run("sudo", ["-n", "docker", ...args], {
            ...options,
            displayCommand: sudoDockerDisplayCommand(args, options)
          })
        : Effect.fail(error)
    ),
    Effect.mapError((error) => toCommandFailure(operation, error))
  )

const isMissingDockerImage = (error: DockerOperationError): boolean => {
  const message = error.message.toLowerCase()
  return message.includes("no such image") ||
    message.includes("no such object") ||
    message.includes("unable to find image")
}

const parseEnvironment = (text: string): Effect.Effect<Readonly<Record<string, string>>, DockerOperationError> =>
  decodeJson(Schema.Array(Schema.String), text, "parse container environment").pipe(
    Effect.map((entries) =>
      Object.fromEntries(
        entries.map((entry) => {
          const separator = entry.indexOf("=")
          return separator < 0
            ? [entry, ""]
            : [entry.slice(0, separator), entry.slice(separator + 1)]
        })
      )
    )
  )

const parseLabels = (
  text: string
): Effect.Effect<Readonly<Record<string, string>>, DockerOperationError> =>
  decodeJson(Schema.NullOr(Schema.Record(Schema.String, Schema.String)), text, "parse container labels").pipe(
    Effect.map((labels) => (labels === null ? {} : labels))
  )

const makeDockerClient = Effect.gen(function* () {
  const runner = yield* CommandRunnerTag

  const checkFn = Effect.fn("DockerClient.check")(function* () {
    yield* runDocker(runner, "check Docker daemon", ["info"], { timeoutMs: 4_000 })
  })
  const check = checkFn().pipe(
    Effect.mapError((error) =>
      DockerUnavailable.make({
        message: `Docker is unavailable: ${error.message}`
      })
    )
  )

  const startOrbStackFn = Effect.fn("DockerClient.startOrbStack")(function* () {
    yield* runner.run("orb", ["start"], { timeoutMs: 30_000 }).pipe(
      Effect.mapError((error) => toCommandFailure("start OrbStack", error))
    )
  })
  const startOrbStack = startOrbStackFn()

  const waitUntilReady = Effect.fn("DockerClient.waitUntilReady")(function* (timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const ready = yield* check.pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false))
      )
      if (ready) {
        return
      }
      yield* Effect.sleep(Duration.millis(500))
    }
    return yield* Effect.fail(
      DockerUnavailable.make({
        message: `Docker did not become ready within ${timeoutMs}ms.`
      })
    )
  })

  const parseContainerList = Effect.fn("DockerClient.parseContainerList")(function* (
    result: CommandResult,
    operation: string
  ) {
    const lines = result.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "")
    const containers: Array<DockerContainerSummary> = []
    for (const line of lines) {
      const raw = yield* decodeJson(RawContainerSchema, line, operation)
      containers.push({
        id: raw.ID,
        image: raw.Image,
        name: raw.Names,
        status: raw.Status,
        ports: parsePorts(raw.Ports),
        labelsText: raw.Labels ?? ""
      })
    }
    return containers
  })

  const listContainers = Effect.fn("DockerClient.listContainers")(function* () {
    const result = yield* runDocker(runner, "list running containers", [
      "ps",
      "--format",
      "{{json .}}"
    ])
    return yield* parseContainerList(result, "parse running container")
  })

  const listAllContainers = Effect.fn("DockerClient.listAllContainers")(function* () {
    const result = yield* runDocker(runner, "list all containers", [
      "ps",
      "--all",
      "--format",
      "{{json .}}"
    ])
    return yield* parseContainerList(result, "parse container")
  })

  const listManagedContainers = Effect.fn("DockerClient.listManagedContainers")(function* () {
    const result = yield* runDocker(runner, "list dbm-managed containers", [
      "ps",
      "--all",
      "--filter",
      "label=com.dbm.managed=true",
      "--format",
      "{{json .}}"
    ])
    return yield* parseContainerList(result, "parse managed container")
  })

  const imageExists = Effect.fn("DockerClient.imageExists")(function* (image: string) {
    return yield* runDocker(runner, `inspect Docker image ${image}`, ["image", "inspect", image]).pipe(
      Effect.map(() => true),
      Effect.catch((error) => isMissingDockerImage(error) ? Effect.succeed(false) : Effect.fail(error))
    )
  })

  const inspectContainer = Effect.fn("DockerClient.inspectContainer")(function* (containerId: string) {
    const readTemplate = (template: string, operation: string) =>
      runDocker(runner, operation, ["inspect", "--format", template, containerId]).pipe(
        Effect.map((result) => result.stdout.trim())
      )

    const id = yield* readTemplate("{{.Id}}", "read container id")
    const name = yield* readTemplate("{{.Name}}", "read container name")
    const image = yield* readTemplate("{{.Config.Image}}", "read container image")
    const environment = yield* readTemplate("{{json .Config.Env}}", "read container environment").pipe(
      Effect.flatMap((text) => parseEnvironment(text))
    )
    const labels = yield* readTemplate("{{json .Config.Labels}}", "read container labels").pipe(
      Effect.flatMap((text) => parseLabels(text))
    )

    return {
      id,
      name: name.replace(/^\//, ""),
      image,
      environment,
      labels
    }
  })

  const exec = Effect.fn("DockerClient.exec")(function* (
    containerId: string,
    command: string,
    args: ReadonlyArray<string>,
    env?: Readonly<Record<string, string>>
  ) {
    const envArgs = env === undefined ? [] : Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`])
    return yield* runDocker(
      runner,
      `execute ${command} in ${containerId}`,
      ["exec", ...envArgs, containerId, command, ...args],
      {
        displayCommand: `docker exec ${containerId} ${command}`,
        timeoutMs: 60_000,
        env: undefined
      }
    )
  })

  const run = Effect.fn("DockerClient.run")(function* (
    args: ReadonlyArray<string>,
    options?: CommandOptions
  ) {
    return yield* runDocker(runner, "run Docker command", args, options)
  })

  const lifecycle = (operation: string, command: string) => Effect.fn(`DockerClient.${command}`)(function* (containerId: string) {
    yield* runDocker(runner, operation, [command, containerId])
  })

  const start = lifecycle("start container", "start")
  const restart = lifecycle("restart container", "restart")
  const pause = lifecycle("pause container", "pause")
  const unpause = lifecycle("unpause container", "unpause")
  const stop = lifecycle("stop container", "stop")
  const remove = Effect.fn("DockerClient.remove")(function* (containerId: string) {
    yield* runDocker(runner, "remove container", ["rm", "--force", containerId])
  })
  const logs = Effect.fn("DockerClient.logs")(function* (containerId: string, tail = 200) {
    const boundedTail = Math.max(1, Math.min(2_000, Math.floor(tail)))
    return yield* runDocker(runner, "read container logs", ["logs", "--tail", String(boundedTail), containerId])
  })

  return {
    check,
    startOrbStack,
    waitUntilReady,
    listContainers: listContainers(),
    listAllContainers: listAllContainers(),
    listManagedContainers: listManagedContainers(),
    imageExists,
    inspectContainer,
    run,
    start,
    restart,
    pause,
    unpause,
    stop,
    remove,
    logs,
    exec
  }
})

export const DockerClientLive = Layer.effect(DockerClient, makeDockerClient)

export { parseLabelsText }
