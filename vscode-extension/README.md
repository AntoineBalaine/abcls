# AbcLsp: Language server for ABC music notation

Language features for [ABC music notation](https://abcnotation.com/)

## Features
- Syntax highlighting.

![side by side view of syntax highlighting and score](assets/abcls_highlighting.png "Syntax Highlighting")
- Diagnostics warning when the server can't read the score.

![diagnostics view of abc score](assets/lsp_diagnostic_sm.jpg "Abc diagnostics" )

- Code formatter.

![abc score formatting](./assets/formatting.gif "Abc score formatting" )
- `Divide rhythms`, and `Multiply rhythms` commands: select some notes and the commands will divide/multiple their time value by two.
- Single note midi input from you midi keyboard (Chord-input from midi will come at some point)

- Live preview of ABC and ABCx scores (integrated renderer)
- Export to HTML and SVG
- Print preview

## Modal keymap

Two key menus select and transform musical elements, like the user modes of the Kakoune plugin. With VSCodeVim, press `h` for the select menu or `k` for the transform menu in an ABC file, then keys to run commands until `Esc`. A view beside the editor shows the keys of the menu and a keyboard with the four layers of every key. The setting `abc.keymap` changes the keys. See the documentation page Modal Keymap in VS Code for the keys and the settings.

## ABCx Support

ABCx is a simplified ABC format designed for chord sheets and lead sheets. Instead of writing full musical notation, you write chord symbols directly in the tune body. The extension automatically converts `.abcx` files to standard ABC for rendering.

### File Structure

ABCx files use the same header fields as standard ABC:

```abcx
X:1
T:Song Title
C:Composer
M:4/4
L:1/4
K:C
C Am | F G |
Em Am | Dm G |
```

### Chord Symbol Syntax

Chord symbols follow this pattern: `Root[accidental][quality][extension][alteration][/bass]`

| Component  | Options                            | Example        |
| ---------- | ---------------------------------- | -------------- |
| Root       | A-G (or lowercase a,c,d,e,f,g)     | C, A, g        |
| Accidental | # or b                             | F#, Bb         |
| Quality    | maj, min, m, M, dim, aug, sus, add | Am, Cmaj, Bdim |
| Extension  | 7, 9, 11, 13, 6                    | G7, Am9        |
| Alteration | #5, b5, #9, b9                     | Dm7b5          |
| Bass       | /[note]                            | C/E, Bb/D      |

Examples: `C`, `Am`, `G7`, `Cmaj7`, `Dm7b5`, `F#m7`, `Bb/D`, `A-7b5/D`

### Other Supported Elements

- Barlines: `|`, `||`, `|]`, `[|`, `:|`, `|:`, `::`, `[1`, `[2`
- Annotations: `"text above staff"`
- Multi-measure rests: `Z4` (4 bars rest)
- Inline fields: `[K:G]`, `[M:3/4]`
- Part markers: `P:A`, `P:Chorus`
- Comments: `% this is a comment`

### Example

```
X:1
T:Autumn Leaves
M:4/4
K:G
P:A
Am7 | D7 | Gmaj7 | Cmaj7 |
F#m7b5 | B7 | Em | Em |
P:B
Am7 | D7 | Gmaj7 | Cmaj7 |
F#m7b5 | B7 | Em | Em ||
```

## Development

To build and install the extension locally:

```bash
cd vscode-extension
npm run build && npm run package:vscode && code --install-extension <extension_vsix> --force
```

Then reload VSCode to pick up the changes.

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## Attribution

The renderer component is based on [abcjs-vscode](https://github.com/abcjs-music/abcjs-vscode) by Alen Siljak, licensed under GPL-3.0-or-later.

## License

This extension is licensed under GPL-3.0-or-later. See the LICENSE file for details.
