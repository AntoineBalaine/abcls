# Known gaps: MusicXML features with no home in AbcLs's type system

This file tracks MusicXML content that opensheetmusicdisplay itself supports,
but that types/abcjs-ast.ts has no representation for. importFromMusicSheet
throws UnsupportedMusicXmlFeatureError for these rather than silently
dropping or approximating them.

## Tablature staves

Staff.isTab is true for a tab staff. abcjs upstream supports tablature
rendering; AbcLs's Staff type has no isTab-equivalent field and no
TabNote-equivalent type. A MusicXML file containing a tab staff throws.

## Figured bass

No representation in types/abcjs-ast.ts and no known equivalent in ABC
notation itself. Throws unconditionally.

## Microtonal and exotic accidentals

AccidentalType (types/abcjs-ast.ts) covers Sharp, Flat, Natural, DblSharp,
DblFlat, QuarterSharp, QuarterFlat. OSMD's AccidentalEnum additionally
defines TRIPLESHARP, TRIPLEFLAT, SLASHFLAT, THREEQUARTERSSHARP,
THREEQUARTERSFLAT, SLASHQUARTERSHARP, SLASHSHARP, DOUBLESLASHFLAT, SORI,
and KORON, none of which have an AccidentalType equivalent. A note using
one of these throws.

## Modal key signatures (dorian, phrygian, lydian, mixolydian, locrian)

KeySignature.root is a single KeyRoot letter (A-G) with a single
KeyAccidental (# or b, not a double accidental), and reconstructing the
correct diatonic spelling of a modal tonic from OSMD's KeyInstruction.Key
(fifths, relative to the major/minor-equivalent key sharing that
signature) plus KeyInstruction.Mode requires walking that major key's
actual 7-note spelled scale to find the mode's tonic degree and its
correct letter/accidental, not just a semitone shift. That spelling table
was not built for this version, given the plan's scope target of lead
sheets and small ensemble scores, where major and minor are overwhelmingly
the common case. importFromMusicSheet supports major and minor (including
OSMD's separate ionian/aeolian mode values, treated as major/minor) and
throws for dorian, phrygian, lydian, mixolydian, and locrian.

## Grace notes after their main note

VoiceEntry.GraceAfterMainNote marks grace notes that appear after the note
they ornament (at the end of a measure), rather than before it. GraceNote
in types/abcjs-ast.ts and NoteElement.gracenotes only represent grace
notes preceding their main note, matching ABC's {..}note syntax. A
VoiceEntry with IsGrace and GraceAfterMainNote both true throws.

## Common/cut time symbol does not survive a re-export (phase 1 IR gap, not fixed here)

importFromMusicSheet correctly reads RhythmInstruction.SymbolEnum and sets
Meter.type to MeterType.CommonTime or MeterType.CutTime accordingly. But
phase 1's AttributesIR (ir.ts) and normalize.ts's meterToBeatsAndType have
no field to carry that symbol back out to MusicXML's `<time symbol="...">`
attribute, so a Tune produced by this importer that is then re-exported
through normalizeForMusicXML/serializeScorePartwise loses the distinction
and comes back as a plain numeric time signature. Fixing this requires
touching phase 1's already-committed files and is out of this plan's
scope; flagged here since the schema round-trip test in
importRoundtrip.spec.ts only checks XSD validity, not symbol preservation,
so it does not catch this on its own.

## Nested tuplets

Note.NoteTuplets (plural) can carry more than one Tuplet for genuinely
nested tuplet notation (a tuplet within a tuplet). NoteElement in
types/abcjs-ast.ts only carries a single startTriplet/endTriplet/
tripletMultiplier/tripletR set per note, matching what TuneInterpreter's
own forward direction produces (ABC's (p:q:r notation has no nesting).
importFromMusicSheet uses Note.NoteTuplet (singular, the innermost tuplet)
and ignores any outer tuplets in NoteTuplets; a note with more than one
entry in NoteTuplets throws, since silently dropping the outer tuplet
would misrepresent the note's actual grouping.
