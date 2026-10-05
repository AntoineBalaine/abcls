# Releasing

## Overview

Releases are automated via GitHub Actions. Pushing a version tag triggers the release workflow, which publishes:

- `abcls-parser`, `abcls` (CLI + LSP server bundle), and `abcls-kak` (Kakoune plugin) as npm-installable tarballs attached to the GitHub Release — not to the npm registry (see "Why not npm" below)
- `abcls` to the VS Code Marketplace
- The documentation site to GitHub Pages

### Why not npm

These packages are not published to the npm registry. As of September 2025, npm permanently disabled new TOTP (authenticator app) 2FA enrollments, requiring either a WebAuthn passkey or a physical security key for any account that wants to publish. We are deliberately not enrolling in that scheme, so there is no `NPM_TOKEN` and no npm publish step.

Instead, each package is packed with `npm pack` and attached as a `.tgz` asset to the GitHub Release created for the tag. End users install directly from that asset:

```bash
# pinned to a specific release
npm install -g https://github.com/antoinebalaine/abcls/releases/download/vX.Y.Z/abcls-X.Y.Z.tgz

# always the newest release
npm install -g https://github.com/antoinebalaine/abcls/releases/latest/download/abcls-latest.tgz
```

The same pattern applies to `abcls-kak-X.Y.Z.tgz` / `abcls-kak-latest.tgz` and `abcls-parser-X.Y.Z.tgz` / `abcls-parser-latest.tgz`.

Because there is no registry entry, `abcls-kak`'s `dependencies` no longer declares `abcls` as an npm dependency (that would make npm try, and fail, to resolve it from the registry). Anyone installing `abcls-kak` must separately install `abcls` the same way, first.

## Prerequisites

### GitHub Secrets

The following secrets must be configured in the repository settings:

- `VSCE_PAT`: Visual Studio Marketplace personal access token for the `abcls` extension.

No npm token is needed. The `publish-release` job authenticates to GitHub using the workflow's own `GITHUB_TOKEN`, granted `contents: write` permission to create the release and upload assets.

### Version Bumping

Before creating a tag, update the version in all `package.json` files and in the `publish-package.json` files. All packages use the same version number, and that number must match the tag you are about to push.

Because `abc-cli/publish-package.json` and `abc-kak/publish-package.json` are standalone files, copied verbatim into the publish directory by `publish.sh`, bumping the root `package.json` does not bump them. Since release assets are plain `.tgz` files attached to a GitHub Release rather than entries in a registry, a stale version here does not fail the workflow — it just produces a tarball whose internal `package.json` version, and therefore its `npm pack`-generated filename, does not match the git tag. After a release, open the release page and confirm the versioned filenames (`abcls-X.Y.Z.tgz`, `abcls-kak-X.Y.Z.tgz`, `abcls-parser-X.Y.Z.tgz`) match the tag before telling anyone to install it.

Files to update:

- Root `package.json`
- `parse/package.json`
- `editor/package.json`
- `cstree/package.json`
- `midi/package.json`
- `native/package.json`
- `abc-lsp-server/package.json`
- `abc-cli/package.json`
- `abc-kak/package.json`
- `preview-server/package.json`
- `vscode-extension/package.json`
- `abc-cli/publish-package.json`
- `abc-kak/publish-package.json`
- `abc-cli/abcls-cli.ts` (the `.version()` call in the commander setup)

## Creating a Release

1. Ensure all tests pass:

   ```bash
   npm run build:parse && npm run build:midi && npm run build:cstree && npm run build:editor && npm run build:lsp && npm run build:cli && npm run build:vscode && npm run build:preview && npm run build:kak
   npm test
   ```

2. Update version numbers (see list above).

3. Generate the changelog:

   ```bash
   bash docs-site/scripts/changelog.sh
   ```

   Review the generated section in `CHANGELOG.md`. Edit commit messages for clarity, remove noise, and reorder entries as needed.

4. Commit the version bump and changelog:

   ```bash
   git add -A
   git commit -m "chore: bump version to X.Y.Z"
   ```

5. Create and push the tag:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

6. The release workflow runs automatically. Monitor it at: `https://github.com/antoinebalaine/abcls/actions`

## Local Verification

Before pushing a tag, verify the packages locally. Dropping `--dry-run` produces the real `.tgz` files the release workflow would attach, so you can also sanity-check their contents with `tar tzf` before trusting a CI run:

```bash
# Build the abcls-parser package (no assembly step needed; package.json is already publish-ready)
npm run build:parse
cd parse && npm pack --dry-run

# Build the abcls package
bash abc-cli/publish.sh
cd abc-cli/dist && npm pack --dry-run

# Build the abcls-kak package
bash abc-kak/publish.sh
cd abc-kak/publish-dist && npm pack --dry-run
```

## Workflows

- `.github/workflows/run_tests.yml`: runs on every PR, builds and tests the monorepo.
- `.github/workflows/release.yml`: runs on `v*` tag push. Builds and packs `abcls-parser`, `abcls`, and `abcls-kak` into `.tgz` files and attaches them to a GitHub Release for the tag (see "Why not npm" above), publishes `abcls` to the VS Code Marketplace, and deploys docs to GitHub Pages.
