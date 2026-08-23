# BB plugin

## Install from GitHub

The repository collection manifest points BB at `bb-plugin-dbm`:

```sh
bb plugin install git:https://github.com/celeroncoder/dbm.git@0.1.0 --plugin dbm --yes
bb plugin reload dbm
bb dbm images
```

For local plugin development:

```sh
cd bb-plugin-dbm
npm ci --install-links
bb plugin types --check
npm run check
npm run test
npm run build
bb plugin install . --yes
bb plugin reload dbm
```

The supported baseline is BB 0.39 with plugin SDK 0.4.8.

## CLI commands

```text
bb dbm list
bb dbm images
bb dbm docker start
bb dbm create <postgres|mysql|redis|mongo> [alias]
bb dbm start <id-or-alias>
bb dbm restart <id-or-alias>
bb dbm pause <id-or-alias>
bb dbm unpause <id-or-alias>
bb dbm stop <id-or-alias>
bb dbm delete <id-or-alias>
bb dbm logs <id-or-alias> [tail]
bb dbm connect <id-or-alias>
bb dbm query <id-or-alias> <query-or-command>
```

The CLI prints JSON for structured operations and plain text for logs. The
Databases panel exposes create, connection, image, logs, lifecycle, query,
schema, table, key, collection, describe, and browse flows over the same RPC
contract.

## Update and reload

An install from `main` tracks the repository branch. Check and apply compatible
updates with `bb plugin outdated` and `bb plugin update`, then inspect
`bb plugin list`. Path installs use `bb plugin dev` or a manual build and
`bb plugin reload dbm`.

## Packaging boundary

The plugin server runs under Node and imports the root package through its
local file dependency. Production artifacts are built by `bb plugin build`.
The app and server metadata record the plugin version and SDK version used for
the build.

See [Docker safety](docker-safety.md) for ownership, credentials, ports, and
cleanup behavior.
