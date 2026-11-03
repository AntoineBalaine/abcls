# abcls

A language server, CLI, and editor extensions for [ABC music notation](https://abcnotation.com/wiki/abc:standard:v2.2).

![Syntax highlighting and preview](vscode-extension/assets/abcls_highlighting.png)

## Install

VS Code: install [abc-ls](https://marketplace.visualstudio.com/items?itemName=AntoineBalaine.abc-ls) from the marketplace.

CLI and LSP server (for Neovim, Helix, Emacs, Kakoune, etc.):

```bash
npm install -g abcls
```

Kakoune users can install the dedicated plugin, which includes `abcls` as a dependency:

```bash
npm install -g abcls-kak
abcls-kak-install
```

## What it does

- Syntax highlighting and semantic tokens
- Diagnostics (errors and warnings)
- Document formatting (barline alignment for multi-voice systems)
- Completions for decorations (`!`), directives (`%%`), and info lines
- Score preview (VS Code) with SVG export. The notes under the editor cursor are highlighted in the score, and a click on a note selects its text
- MIDI input and export
- [MusicXML](https://antoinebalaine.github.io/abcls/user-guide/musicxml/) export and import, to move a score between ABC and a notation program such as MuseScore
- [iReal Pro export](https://antoinebalaine.github.io/abcls/user-guide/ireal-export/) of the chord symbols of a score
- [ABCx chord sheet notation](https://antoinebalaine.github.io/abcls/user-guide/abcx-chord-sheets/) for writing chord charts without full music notation
- Selectors and transforms for programmatic score editing (transposition, rhythm manipulation, voice management, enharmonic spelling, etc.)
- Harmonization: a block chord per chord symbol, or a melody harmonized into new voices

## CLI usage

```bash
abcls format file.abc        # Format an ABC file
abcls check file.abc         # Check for errors and warnings
abcls render file.abc        # Render to SVG
abcls render file.abc --pages pages    # Write A4 pages as SVG, to make a PDF
abcls transform file.abc transpose 2   # Run an editor transform
abcls transform file.abc transpose --keys --chords -- -2   # Transpose the notes, the key signatures and the chord symbols
abcls transform file.abc transpose 2 --as-new-tune "Bb clarinet" -w   # Append the transposed copy as a new tune
abcls harmonize file.abc --chords-from 1 --into 3,4,5,6   # Write a block chord per chord symbol
abcls abc2midi file.abc      # Export to MIDI
abcls midi2abc file.midi     # Convert MIDI to ABC
abcls abc2xml file.abc -o file.musicxml   # Export a tune to MusicXML
abcls xml2abc file.musicxml  # Convert MusicXML to ABC
abcls abc2ireal file.abc -o file.html     # Export the chords as an iReal Pro link
abcls abcx2abc file.abcx     # Convert ABCx chord sheet to ABC
abcls lsp --stdio            # Start the language server
```

## LSP setup

Point your editor's LSP client at `abcls lsp --stdio`. For example, in Neovim with lspconfig:

```lua
require('lspconfig').abcls.setup {
  cmd = { 'abcls', 'lsp', '--stdio' },
  filetypes = { 'abc' },
}
```

## Documentation

Full documentation is available at [antoinebalaine.github.io/abcls](https://antoinebalaine.github.io/abcls/).

## Development

```bash
git clone https://github.com/AntoineBalaine/abcls.git
cd abcls
npm install
npm run build
npm run test
```

The monorepo uses npm workspaces:

```
abcls/
  parse/              # Parser library (scanner, parser, formatter, semantic analyzer, interpreter)
  editor/             # CSTree, selectors, and transforms
  cstree/             # Concrete syntax tree data model
  midi/               # MIDI export
  abc-lsp-server/     # Language server
  abc-cli/            # CLI tool
  abc-kak/            # Kakoune plugin
  vscode-extension/   # VS Code extension
  docs-site/          # Documentation website (Astro/Starlight)
  native/             # Optional MuseSampler integration (experimental)
```

Tests use Mocha with fast-check for property-based testing.

## License

GPL-3.0-or-later
