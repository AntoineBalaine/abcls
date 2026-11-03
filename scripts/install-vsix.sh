#!/bin/bash
# Builds the monorepo, packages the VS Code extension as a .vsix, and force-installs it locally.
# Usage: ./scripts/install-vsix.sh (run from the root of the monorepo)

set -e

# Because the extension bundles the parser, the editor and the language server, every package must be built first.
npm run build

# vsce writes the .vsix into the root of the monorepo, named after the extension's name and version.
npm run package:vscode

VSIX="$(node -p "const p = require('./vscode-extension/package.json'); p.name + '-' + p.version + '.vsix'")"

# Because a missing jazz-midi means an incomplete package (MIDI input would not work), we stop before installing it.
if [ "$(unzip -l "$VSIX" | grep -c "node_modules/jazz-midi")" -eq 0 ]; then
  echo "Error: jazz-midi is missing from $VSIX. Run 'npm install' to re-sync node_modules, then retry." >&2
  exit 1
fi

# The --force flag replaces whichever version of the extension is already installed.
code --install-extension "$VSIX" --force

echo "Installed $VSIX. Reload the VS Code window (Developer: Reload Window) to load the new build."
