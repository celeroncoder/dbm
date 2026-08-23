# Releases

The CLI, reusable core, and BB plugin share one version. A change to any outlet
bumps the repository version and the plugin version together.

Before 1.0, incompatible public behavior can ship in a minor release. Patch
releases contain compatible fixes and documentation corrections. After 1.0,
the project follows normal Semantic Versioning rules.

The 0.1 release ships a Bun package tarball and the Git-installable BB plugin
from GitHub. The package is not published to a registry. Standalone binaries,
Homebrew, and automatic self-update are deferred until tagged releases are
repeatable. GitHub Releases attach the exact tarball, checksums, and SBOM;
users update or roll back through their global Bun installation.

## Release checklist

1. Confirm root and plugin versions match.
2. Confirm the changelog describes the release and has a release date.
3. Run `bun install --frozen-lockfile`, root checks, and repository safety.
4. Run plugin `npm ci`, SDK type check, tests, and build.
5. Pack the CLI from a clean checkout and inspect every included file.
6. Install the packed artifact into an isolated Bun prefix and test the
   documented command and uninstall path.
7. Run the live four-adapter verification and retain exact cleanup proof.
8. Confirm CI, CodeQL, and Docker smoke checks pass on the release commit.
9. Create the immutable `vX.Y.Z` tag. Never move a published tag.
10. Publish the approved GitHub artifacts, checksums, SBOM, install
    commands, supported image tags, compatibility notes, and known issues.
11. Test uninstall and reinstall. Once a prior version exists, test rollback
    to that version as well.
12. Keep the BB plugin GitHub-only unless a later release explicitly approves
    a community marketplace submission.

`v0.1.0` established the GitHub-hosted CLI artifact. `v0.1.1` is the first
tag with a clean managed BB Git source install. The MIT license and GitHub-only
distribution method are approved. The root package stays private to prevent
an accidental registry publication.
