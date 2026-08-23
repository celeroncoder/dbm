# Adapter authoring

An adapter translates a database image's native client into the shared
`DatabaseAdapter` interface in `bb-plugin-dbm/core/src/explorer.ts`.

## Contract

Implement these operations:

- `testConnection`
- `query`
- `listSchemas`
- `listTables`
- `describeTable`
- `browseTable`

Return typed `DatabaseOperationError` failures. Query results contain ordered
column names, rows of strings or nulls, a row count, a truncation flag, and an
optional note. Bound browse limits to 1 through 500.

Keep shell parsing out of adapters. Call `DockerClient.exec` with a command and
argument array. Pass passwords through the native client's environment
variable when possible. Never interpolate a user value into an identifier or
literal without the adapter's database-specific quoting function.

## Discovery inputs

Document the image names, service names, or labels that identify the database.
Document every environment variable used for username, password, and default
database discovery. Add the database kind to `DatabaseKind`, `databaseKinds`,
the registry switch, display names, and managed template only when the BB
plugin can create it.

## Small worked shape

```ts
const adapter: DatabaseAdapter = {
  kind: "example",
  testConnection: (database) => run(database, ["PING"]).pipe(Effect.asVoid),
  query: (database, request) => runQuery(database, request.text),
  listSchemas: () => Effect.succeed([{ name: "default" }]),
  listTables: (database) => listObjects(database),
  describeTable: (database, table) => describeObject(database, table.name),
  browseTable: (database, table, limit) => browseObject(database, table.name, limit)
}
```

Use the real project types and helpers rather than copying this sketch
literally.

## Verification

Add injected command-runner tests for detection, arguments, output parsing,
missing metadata, and native-client failures. Extend `scripts/verify-plugin.ts`
with a small seeded fixture. Live coverage must prove discovery, query,
listing, describe, browse, logs, lifecycle, and exact cleanup.

Update the support matrix, examples, troubleshooting guide, both skills, and
the BB plugin selector when support changes.
