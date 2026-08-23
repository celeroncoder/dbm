import { describe, expect, it } from "vitest"
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing"
import plugin from "./server"

describe("dbm BB plugin", () => {
  it("registers the RPC and agent-facing CLI surfaces", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "dbm" })
    await plugin(bb)

    expect(harness.inspection.registrations.rpcMethods).toEqual([
      "dockerStatus",
      "dockerStart",
      "imageStatus",
      "list",
      "create",
      "action",
      "remove",
      "logs",
      "query",
      "schemas",
      "tables",
      "describe",
      "browse"
    ])
    expect(harness.inspection.registrations.cli?.name).toBe("dbm")

    const help = await harness.behavior.runCli(["help"])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain("bb dbm create")
    expect(help.stdout).toContain("bb dbm images")

    const invalidCreate = await harness.behavior.runCli(["create", "sqlite"])
    expect(invalidCreate.exitCode).toBe(2)

    await harness.lifecycle.dispose()
  })

  it("reports Docker readiness without throwing through RPC", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "dbm" })
    await plugin(bb)

    const status = await harness.behavior.callRpc("dockerStatus", null)
    expect(status).toMatchObject({ ready: expect.any(Boolean), message: expect.any(String) })

    await harness.lifecycle.dispose()
  })
})
