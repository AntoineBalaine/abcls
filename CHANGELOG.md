# Changelog

## 0.1.15 (2026-10-05)

### ireal

- write a chart back out as iReal Pro grid text
- export an iReal Pro link from ABCx with the chart's structure intact
- keep the cell a chord was written on, rather than dropping the padding
- do not count a comma as a cell, so that `D9,   |` is four cells wide rather than five
- keep chords small from `s` until `l`, rather than only the chord after `s`
- delete the ABCx conversion path

## 0.1.14 (2026-10-04)

### chordShorthand

- add MinorMajor7 ('-^') combined-symbol quality
- recognize iReal's real sus-chord ordering (extension before 'sus')

### chore

- publish via tarball
- package release flow

### ireal

- prune the unused converter exports and prefix the tree types
- read a minor key's number notation against its parallel major
- spell a chromatic degree the scale lowers as a raised degree
- lay the parsed chart out into display lines
- keep a sus chord's extension when writing chord text
- parse grid tokens into a chart tree
- add a total-coverage scanner for iReal Pro grid notation
- attach a lone section label to the next bar with content
- derive barlines from bar structure, not from bar text
- keep section labels (as ABC '[P:X]' fields), show real repeats once
- stop rendering a single-bar hold ('x') as a repeat sign
- strip vertical-alignment spacer characters ('Y')
- fix stray unmatched braces and use :|: for consecutive repeats
- resolve section labels, repeat/coda structure, and more
- generalize isRepeatBar to multi-cell repeat-only bars
- don't crash on a repeat-bar cell mixed into a multi-cell bar
- translate iReal Pro's "-" minor-key suffix to ABC's "m"
- fix repeat bars, line wrapping, and full-bar rest notation
- embed the source link as a header comment by default
- fix review findings and expose the converter from the package root
- add ABCx to iReal Pro chord chart converter

### music-theory

- Nashville numbering reads a minor key off its relative major
- add Nashville and regular number-notation degree helpers

### music-theory/ireal

- add Altered chord quality ('alt') support

## 0.1.13 (2026-08-30)

### chore

- docs: transforms reference still listed drop2/drop24/drop3 under harmonizeVoicing after they moved to their own dropVoicing commands in 0.1.12; documented dropVoicing under a new Revoicing section instead
- removed the now-dead drop2/drop24/drop3 branches from harmonizeVoicing itself, narrowing VoicingType to close/cluster/spread to match

## 0.1.12 (2026-08-30)

### feat

- drop2/drop24/drop3 are now revoicing commands that rearrange an already-written chord's notes, ranking voices by sounding pitch; separate from the harmonize close/cluster commands, which build a new chord under a selected lead note

### fix

- selections in the second or a later tune of a multi-tune document were resolved against the first tune instead, so explode, timed explosion, insertVoiceLine, and addVoice either did nothing or mutated the wrong tune
- converting between the AST and the CSTree dropped a tune's linear/deferred flag and formatter config, so any transform on a linear tune re-serialized it as though it were deferred
- timed explosion undercounted chords glued to adjacent notes with no surrounding whitespace, assigning far fewer target voices than requested
- timed explosion treated a bare `%` comment line between systems as closing a bar for the last-active voice, and padded a new voice line with bars spanning the whole tune instead of just the system being exploded
- timed explosion inserted new voice lines at the end of a system instead of at the position the tune's declared voice order calls for, and could place a padded bar after the line's closing newline
- timed explosion's placeholder rest for a padded or newly seeded bar was always a blank whole-bar rest instead of matching the duration of the bar it stood in for
- the `%%abcls-voices` directive and `V:`/`[V:...]` markers mis-scanned a single-letter voice ID that collided with a note letter (e.g. `B`), so `%%abcls-voices show B` silently filtered nothing
- a chord selected through the language server's default resolution matched both the chord and its inner notes separately, causing double-processing in transforms that assumed one match per note
- clef directives using the `-` operator (e.g. `clef=treble-8`) failed to parse
- multiplyRhythm and divideRhythm now apply to y-spacers, matching the other rhythm transforms

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
