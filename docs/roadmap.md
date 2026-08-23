# Roadmap

The near-term goal is a small, dependable local database explorer rather than a broad administration platform.

## Next

- Stabilize the first GitHub-hosted CLI and BB plugin release process.
- Improve adapter diagnostics for custom compatible images.
- Add focused terminal UX improvements based on real usage.

## Later, when evidence supports it

- Consider another adapter after its discovery signals, native client, and browse model are clear.
- Consider Homebrew after tagged releases and rollback are repeatable.
- Add a benchmark only for a measured latency problem, with the command and environment published beside every result.

GitHub Discussions remains disabled while Issues can handle the project volume. Funding is not configured. Windows is unsupported for the first release; WSL2 is experimental. The CLI now provides bash, zsh, and fish completions plus `dbm doctor --json`, so a broader non-interactive command API should be added only when a concrete scripting workflow needs it.

Repository docs remain in version control. GitHub Pages and the Wiki stay off
until the README and `docs/` directory become difficult to navigate or
browser-only editing becomes a real contributor need.
