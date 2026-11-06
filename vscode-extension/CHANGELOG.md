# Changelog

All notable changes to the AbcLsp extension will be documented in this file.

## [Unreleased]

### Added
- A modal menu for the select and transform commands, like the user modes of the Kakoune plugin. With VSCodeVim, `k` opens the select menu and `h` opens the transform menu in the Normal and Visual modes of an ABC file. Press a key to run a command: the menu stays open for the next key until `Esc`, and the setting `abc.menu.sticky` set to false closes it after one command. Some keys open a smaller menu, such as `g` for the voicings, and a number typed before a transform is its count. `Tab` switches between the two menus, and `h` goes from the select menu to the transform menu while `k` goes back. In the select menu, `i n`, `i m`, `i s`, `i t`, `i a`, `i d`, `i b`, `i D` and `i %` select the note, measure, system, tune, annotation, decoration, beam, directive or comment that holds the caret, and the same keys in the `a` menu select it with the whitespace around it (the closing bar line for a measure, the line break for a system or a directive, the blank lines after a tune). `<` moves to the previous note and `>` to the next note, `[` moves to the previous chord and `]` to the next chord, and a number typed before them is the number of notes or chords to move; the digits of the select menu are now that count, and the positions from the top moved into the `f` menu; on the BÉPO layout they are also bound as Alt+2 and Alt+3, and the brackets as Alt+4 and Alt+5, the chords that type them. With the setting `abc.keyboardLayout` set to `bepo`, the digit row of the menus reads the keys of that layout, so that `*` and the digits of a count are the ones that the keys type. Without VSCodeVim, bind the commands `abc.menu.select` and `abc.menu.transform` to keys of your own
- In the select menu, `i n`, `i m` and `i s` select the note, the measure and the system that hold the caret. The inside and around keys (`i c`, `a c` and the others) now work from a caret too, and `i c` selects all the notes of the chord and not only the first one.
- A view of the keys of the current menu, which opens below the editor without taking the focus, and draws a keyboard with the four layers of every key (QWERTY and BÉPO, staggered or ortholinear). A click on a key presses it. The settings `abc.menuView.autoOpen`, `abc.menuView.location`, `abc.keyboardLayout`, `abc.keyboardGeometry` and `abc.keyboardIsoKeys` control it
- The setting `abc.keymap` changes the keys of the menus
- `ABC: Show the menu view` and `ABC: Hide the menu view`
- The commands `abc.harmonizeClose`, `abc.harmonizeCluster` and `abc.harmonizeSpread` take the number of voices, 4, 5 or 6, as the argument `{ "voices": 5 }` of a keybinding. Any other value shows an error

## [0.3.2] - 2026-11-04

### Added
- `ABC: Join System with Next`: the inverse of `Split System at Cursor`. It appends each voice line of the next system to the line of the same voice, and the cursor goes to where they were joined
- `ABC: Interleave Voices`: rewrites a tune whose voices are written one after the other as systems that hold all the voices, with the same number of bars in every line of a system. It asks for the number of bars per system. Run the formatter afterwards to align the bars
- The preview highlights the notes of every cursor and selection, and not only those of the first one

### Fixed
- Clicking a note in the preview moved the cursor to the wrong place when voices were hidden with `%%abcls-voices`, and a selection in a hidden voice was not handled. The preview now maps the click and the cursor through the filter
- With `%%abcls-voices show 5` and a `%%score` line that named hidden voices, the preview kept showing its previous drawing, because the score could not be drawn. The hidden voices are now taken out of `%%score` and `%%staves`, and `P:` lines and `%%text` stay visible
- `%%abcls-voices show 6b` highlighted `6b` as two tokens, and voice ids such as `C` or `B` in `%%score` were read as notes
- After `Split System at Cursor`, the cursor went back to the top of the file or to its old position. It now goes to the start of the new system
- A transform on a large score could stop the language server with an out of memory error, and the editor reported "Pending response rejected since connection got disposed"

## [0.3.1] - 2026-11-03

### Added
- `ABC: Double Rhythm Length and Re-bar` and `ABC: Halve Rhythm Length and Re-bar`: like `Double Rhythm Length` and `Halve Rhythm Length`, but the bars follow. Doubling cuts each bar of the selection into bars of the meter's length (with ties where a note crosses a new bar line), and halving merges the bars again. Select whole bars before running them

## [0.3.0] - 2026-11-03

### Added
- The preview highlights the notes under the editor cursor or selection, and scrolls to them when they are out of view
- Clicking a note in the preview selects its text and gives the focus back to the editor

### Fixed
- The preview keeps its scroll position while you edit
- Quoted text that only starts like a chord (`"Fine"`, `"Coda"`) is no longer read as a chord symbol

## [0.0.4] - 2026-01-18

### Added
- Live preview for ABC and ABCx scores using integrated abcjs renderer
  - `ABC: Show Preview` - opens a side panel with rendered score
  - `ABC: Show Preview (Light)` - opens preview with white background
  - Real-time updates as you edit
  - Configurable options: responsive mode, jazz chords, tablature, transposition
- Export functionality
  - `ABC: Export as HTML` - saves rendered score as HTML
  - `ABC: Export as SVG` - saves rendered score as SVG
- `ABC: Print Preview` - opens score in browser for printing
- ABCx chord sheet notation support
  - `.abcx` file extension for chord-only lead sheets
  - Automatic conversion to ABC for rendering
  - Chord symbols rendered as annotations above the staff
- VSCode extension debugging configuration (F5 from repo root)

### Fixed
- ABCx files now use the correct ABCx-specific scanner and parser
- Reduced parsing errors by 93% (745 -> 48 errors across example scores)
- Added `.abcx` extension to language registration
- Externalized jsdom to fix xhr-sync-worker.js bundling error

### Changed
- SVG renderer moved from LSP server to CLI
- Switched DOM implementation from jsdom to svgdom

## [0.0.3] - 2025-11-12

Initial release in mono-repo.

### Added
- Syntax highlighting for ABC notation
- Diagnostics for parsing errors
- Code formatter
- `ABC: Divide Rhythms` and `ABC: Multiply Rhythms` commands
- `ABC: Octaviate up` and `ABC: Octaviate down` commands
- Single note MIDI input from MIDI keyboard
