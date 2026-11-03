# Changelog

All notable changes to the AbcLsp extension will be documented in this file.

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
