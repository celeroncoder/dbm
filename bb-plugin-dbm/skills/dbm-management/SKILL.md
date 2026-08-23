---
name: dbm-management
description: Use when creating, managing, inspecting, querying, or cleaning up local Docker database instances through the dbm BB plugin.
---

# dbm database management

Use this skill for the BB plugin outlet of the dbm project. The plugin manages
only containers it created and labelled with `com.dbm.managed=true`.

## Install and validate

Install a tagged public release through the repository collection:

```sh
bb plugin install git:https://github.com/celeroncoder/dbm.git@0.1.0 --plugin dbm --yes
bb plugin list
bb dbm images
```

For development from the repository root:

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

The plugin has a `bb dbm` command and a Databases navigation panel. It uses the
same Effect core as the terminal CLI; the BB server uses the core's Node
command runner while Bun continues to power the terminal outlet.

Docker socket permission failures are retried through non-interactive
`sudo -n docker` when the host permits it. If that does not work, grant the BB
server user Docker socket access or use the `bb dbm docker start` OrbStack
workflow; the plugin never waits for an interactive sudo password.

## Manage instances

```sh
bb dbm list
bb dbm images
bb dbm docker start
bb dbm create postgres [alias]
bb dbm create mysql [alias]
bb dbm create redis [alias]
bb dbm create mongo [alias]
bb dbm start <id-or-alias>
bb dbm restart <id-or-alias>
bb dbm pause <id-or-alias>
bb dbm unpause <id-or-alias>
bb dbm stop <id-or-alias>
bb dbm logs <id-or-alias> [tail]
bb dbm connect <id-or-alias>
bb dbm query <id-or-alias> <query-or-command>
bb dbm delete <id-or-alias>
```

Created instances use safe localhost-only random host ports and built-in
credentials. `connect` returns the generated URL and config, so users do not
need to construct connection strings manually. The default images are
Postgres 16 Alpine, MySQL 8.4, Redis 7 Alpine, and MongoDB 7.
The Databases panel and `bb dbm images` show each exact image tag/version plus
whether Docker has it installed locally; creating an instance lets Docker pull
a missing image.

The existing explorer operations are also available through the plugin RPC and
panel: query, list schemas/databases, list tables/keys/collections, describe,
and browse. Use the native database syntax expected by the selected adapter.

For a live all-adapter verification from this checkout, run `bun run
verify:docker` from the repository root. It creates only
`dbm-verify-plugin-*` aliases; exercises discovery, connection, query, schema,
list, describe, browse, logs, and lifecycle operations for every adapter; and
removes the exact recorded IDs in `finally`. Use `sudo -n` only when the Docker
socket requires it. `DBM_VERIFY_KINDS=mysql bun run verify:docker` selects a
subset for a constrained development host, but release verification must run
all four.

## Safety and cleanup

Never remove a broad name pattern or unrelated container. Resolve an instance
through the plugin's managed list first, and delete the exact id or alias.
Disposable verification resources should use an explicit `dbm-verify-` name,
create no named volumes, record exact IDs, and confirm they are absent
afterward. Exact deletion also removes anonymous volumes declared by the
database image. Cached images may remain; do not delete them as part of normal
cleanup.

When changing the management core, plugin RPC/CLI, images, labels, connection
formats, or UI workflow, update this skill, the root README, and
`.agents/skills/dbm-cli/SKILL.md`, then run the core and plugin checks.
