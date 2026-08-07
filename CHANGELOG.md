# Changelog

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
