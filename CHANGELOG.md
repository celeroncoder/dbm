# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and Semantic Versioning.

## Unreleased

## [0.1.1] - 2026-08-23

### Fixed

- Keep the shared core package inside the BB plugin root so managed Git source
  builds resolve Effect without repository-level dependency installation.
- Use the exact `v`-prefixed Git tag in BB install commands.
- Generate release checksums with portable artifact basenames.

## [0.1.0] - 2026-08-23

### Added

- Public CI, CodeQL, Dependabot, repository safety checks, and scheduled live
  verification for all four database adapters.
- `dbm doctor`, versioned JSON diagnostics, and bash, zsh, and fish
  completions.
- Release automation for GitHub-hosted package tarballs, SPDX SBOMs, and
  checksums.
- Security, contribution, support, architecture, Docker safety, adapter,
  troubleshooting, and BB plugin documentation.
- GitHub issue forms, pull request checklist, and BB collection manifest.
- A project logo, GitHub social preview, live terminal recording, and BB panel
  screenshot.
- MIT licensing for the CLI, reusable core, and BB plugin.

### Changed

- Managed aliases are normalized before reaching Docker.
- Docker container references are validated and passed after an option
  boundary.
- Managed deletion revalidates inspected ownership metadata.
- Failed creates and live verification clean up exact Docker container IDs and
  anonymous image volumes.
- Live verification runs adapters sequentially to fit supported CI hosts while
  retaining full discovery, query, inspection, log, lifecycle, and cleanup
  coverage.
- MySQL readiness now requires an authenticated query instead of a server-only
  ping.
- Discovery reports the canonical inspected container ID.

### Security

- Added regression tests for alias handling, Docker argument boundaries,
  malicious container references, and refusal to delete unlabelled containers.
