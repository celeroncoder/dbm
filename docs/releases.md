# Releases

The CLI, reusable core, and BB plugin share one version. A change to any outlet
bumps the repository version and the plugin version together.

Before 1.0, incompatible public behavior can ship in a minor release. Patch
releases contain compatible fixes and documentation corrections. After 1.0,
the project follows normal Semantic Versioning rules.

The 0.1 release ships the Bun-based npm package and the Git-installable BB
plugin. Standalone binaries, Homebrew, and automatic self-update are deferred
until tagged releases are repeatable. GitHub Releases attach the exact npm
tarball, checksums, and SBOM; users update or roll back through their global
Bun or npm installation.

## Release checklist

1. Confirm root and plugin versions match.
2. Confirm the changelog describes the release and has a release date.
3. Run `bun install --frozen-lockfile`, root checks, and repository safety.
4. Run plugin `npm ci --install-links`, SDK type check, tests, and build.
5. Pack the CLI from a clean checkout and inspect every included file.
6. Install the packed artifact into an isolated Bun prefix and test the
   documented command and uninstall path.
7. Run the live four-adapter verification and retain exact cleanup proof.
8. Confirm CI, CodeQL, and Docker smoke checks pass on the release commit.
9. Create the immutable `vX.Y.Z` tag. Never move a published tag.
10. Publish the approved package or binary artifacts, checksums, SBOM, install
    commands, supported image tags, compatibility notes, and known issues.
11. Test rollback by uninstalling and reinstalling the previous supported
    version.
12. Submit the BB plugin to the community marketplace only after the first
    tagged release installs cleanly from Git.

The first release target is `v0.1.0`. The MIT license and npm distribution
method are approved, and the clean-machine install path must pass before the
tag is created.

The first npm publication requires a granular npm access token stored as the
GitHub Actions secret `NPM_TOKEN`. Keep `id-token: write` enabled so npm can
attach provenance. After the package exists, configure npm trusted publishing
for `.github/workflows/release.yml` and remove the long-lived token when the
registry confirms the OIDC path works.
