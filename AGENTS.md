# Agent guidance

Read [.agents/skills/dbm-cli/SKILL.md](.agents/skills/dbm-cli/SKILL.md) before running or changing the dbm CLI. It is the source of truth for the current commands, supported database adapters, global development link, live verification, and cleanup procedure.

For BB plugin work, also read [bb-plugin-dbm/skills/dbm-management/SKILL.md](bb-plugin-dbm/skills/dbm-management/SKILL.md) and follow the bb-plugin-authoring skill. Keep the plugin manifest, RPC/CLI surface, UI, and packaged skill aligned.

The project uses Bun and Effect. After CLI or adapter changes, run `bun run check && bun run test`. If the user-facing CLI workflow or supported behavior changes, update the skill and `README.md` in the same change.

After plugin changes, run `cd bb-plugin-dbm && npm run check && npm run test && npm run build`, then run the root checks as well.
