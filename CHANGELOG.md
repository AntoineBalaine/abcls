# Changelog

## 0.1.11 (2026-08-07)

### fix

- scanner undercounted line numbers across section breaks spanning more than one blank line, corrupting LSP syntax highlighting for everything after
- a standalone y-spacer was never preceded by a space when formatted (y-spacers inside a beam are unaffected)

## 0.1.10 (2026-08-07)

### fix

- enharmonize on a selected chord was a no-op: the redundant per-note cursor flipped each note straight back to its original spelling
- octave transpose on a selected chord applied the shift twice (e.g. octave-down on [fa] produced [F,A,] instead of [FA])

## 0.1.9 (2026-08-07)

### fix

- MIDI chord input inserting an extra leading space before the chord bracket

## 0.1.8 (2026-08-07)

### chore

- VS Code extension publishing: switched from a Personal Access Token to Microsoft Entra ID workload identity federation, since the PAT had expired and Azure DevOps retires global PATs on 2026-12-01

## 0.1.7 (2026-08-07)

### fix

- MIDI chord input: notes released together were each writing out a separate, partial chord instead of one combined chord
- MIDI input configuration: chordTimeWindow, accidentals, and relativeMode settings are now declared and configurable, and chord mode is on by default

## 0.1.6 (2026-07-18)

### fix

- typo in name
- MIDI input device detection: JZZ engine now properly awaited before enumerating devices
- MIDI keyboard not listed in vsix: jazz-midi native module is now copied into the extension package and marked external in the esbuild bundle

## 0.1.0 (2026-03-11)

Initial release: abcls project setup.
