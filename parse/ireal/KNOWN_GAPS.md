# Known gaps and unverified assumptions: reading iReal Pro charts

This file tracks the gaps and unconfirmed assumptions that are still true
of the code, per the project's policy of documenting these plainly rather
than silently working around them or overclaiming coverage.

It covers the link fields, the scrambling, the chord shorthand, and the
grid scanner and parser. It deliberately does not record defects that have
since been fixed: those are in the git history, and a gap file that doubles
as a changelog stops being readable as a list of what is still wrong. The
sections that documented the ABCx conversion's own scope went with that
conversion when it stopped being part of the display path.

## Unconfirmed protocol fields

Field 5 (transpose) and the distinction between field 3 (style) and
field 7 (groove) were not confirmed against multiple real sample links;
only one real sample was found during implementation, and it did not
carry fields 7-9 at all. See fields.ts's module comment.

## Adjacent-empty-field collision with the playlist separator

Discovered during implementation, not anticipated in the plan: building
a song's field string naively (joining 10 fields with "=") can produce a
literal "===" wherever two adjacent fields are both empty, which is
indistinguishable from the "===" playlist separator and corrupts parsing.
fields.ts guards against this with a single-space placeholder wherever
two adjacent fields would otherwise both be empty (or an empty field
would sit at either edge of the song string). This is a real, tested fix
for AbcLs's own round trip; whether real iReal Pro links ever hit this
same case, and if so how the real format avoids it, is not known.

## Field content that coincidentally looks percent-encoded

parsePlaylistLink attempts decodeURIComponent on every link and falls
back to the raw string only if that throws. A field whose plain-text
content coincidentally contains a valid percent-encoding sequence (e.g.
literally "%00") is indistinguishable from genuinely percent-encoded
content and gets wrongly decoded. Found via the fast-check property test
in fields.spec.ts, which now excludes this case from its generator rather
than treating it as a passing property; real title/style/etc. content is
not expected to ever contain this pattern in practice.

## "5" chord text is ambiguous between Power and Dominant-with-extension-5

`CHORD_TEXT_PATTERN` in chordShorthand.ts treats a bare "5" after the root
as the Power chord quality symbol. A Dominant chord (no quality letter)
with `extension: 5` and no other symbol serializes to that exact same
text ("A5"), so parsing it back always resolves to Power, never to the
original Dominant-with-extension-5 shape. This is not a code defect to
fix; both readings produce identical text, and Power is the far more
common real-world meaning of a bare "5" on a chord chart. Excluded from
chordShorthand.spec.ts's property-based round-trip fidelity claim for
this specific combination, the same way Dominant's own qualityExplicit
flag is already excluded there for a similar reason.

## The section-label sentinel protects its delimiters but not its payload

markSectionLabels rewrites "*A" to a sentinel-wrapped cell ("§A§") early
in cleanGridText, before the passes that delete bare annotation letters
("f" fermata, "l" layout, "s" small, "Y" spacer, and the U/S/Q/N-digit
part markers). Those passes match a bare letter anywhere in the string,
including between the sentinel delimiters — so a label whose letter is
one of them ("*f", "*l", "*s", "*Y", "*U", "*S", "*Q") decays to "§§",
fails gridNotation.ts's SECTION_LABEL_CELL test, and is dropped
silently. Labels using any other letter, including every one seen in
practice ("*A", "*B", "*C", "*D", "*V", "*i"), are unaffected.

Latent rather than live: zero occurrences across a real 657-song
library. Noted rather than worked around because the honest fix is to
invert the pipeline — tokenize the grid into cells first, then run the
annotation-removal passes per cell, skipping label cells — rather than
teach each deletion pass yet another exception, which is the same
"recover structure from text after destroying it" mistake that caused
the doubled-barline bug (see the barline fix above).

## Grid scanner: the four charts in a real 657-chart library that still produce UNKNOWN tokens

Phase 1 of `plans/2.ireal-grid-lexer-parser.md` asks for zero
`GridTT.UNKNOWN` tokens across the sample library, or a written list of
the exact inputs that produce them with a reason for each. Running
`parse/ireal/tools/verifyAgainstLibrary.ts` over a real backup of 657
chart entries (361 distinct titles, each mostly present twice because the
backup holds two playlist links) gives 0 coverage failures and 40
`UNKNOWN` token occurrences, all of them from these four charts. They are
listed rather than absorbed into the grammar, because absorbing input
whose meaning is not established would be tuning the grammar until the
count reads zero.

Chart "Ingênuo", 3 occurrences of `W` and the 3 `/` characters that
follow them, in the cells `W/C`, `W/Bb` and `W/Eb`. Each sits
immediately after an ordinary chord cell (`D-,W/C,`, `C-,W/Bb,`,
`F-,W/Eb,`), which reads as a slash chord whose root is carried over
from the preceding cell, but `W` is not among the constructs section 4 of
the plan records and no reference consulted during Phase 1 confirms that
reading. The `/` is reported too rather than separately, because the
chord rule attaches a slash bass only when a root letter precedes the
slash, so a slash with no root of its own is left to the unknown rule.

Chart "You Taught My Heart To Sing", the 4 characters `*`, `-`, `^`, `*`
in the cell `F#*-^*`. The `-^` between the asterisks is iReal Pro's
minor-major seventh symbol, so the cell plausibly means an F# minor-major
chord with the quality wrapped in asterisks, but what the asterisks
themselves denote is not established; the section label rule requires a
word character after `*` and so declines this one.

Charts "Alfie's Theme" (7 occurrences) and "Chippie" (13 occurrences).
Both of these have a chord data field only 33 and 37 characters long
including the 10-character marker, against a few hundred for an ordinary
chart, and the grid text that comes out of `unscramble` is not valid grid
notation in any reading: `9b7F 4Bb-77hG F7-bBZL7^` and
`7bEZL4F7Xy-AZL7-G 7^FA*{ Y `. Both read as approximately reversed
fragments of a real chart, with `LZ` sequences left in place that
`unscramble` would have rewritten to ` |` had they been oriented the
other way. The data is therefore truncated or otherwise damaged upstream
of the scanner, either in the backup itself or in how `scramble.ts`
handles a payload shorter than one 50-character chunk, which was not
determined during Phase 1 and is not a scanner concern. Scanning them
loses nothing: every character still comes back as a token.

Separately, and not a scanner defect: 8 distinct chord lexemes the
scanner correctly isolates are rejected by `chordShorthand.ts`'s
`irealTextToParsedChord`, 22 occurrences in all. Six of them are genuine
dialect gaps worth closing in Phase 2 (`G7b9sus`, `Bb7b9sus`, `A7b9sus`,
an alteration between the extension and `sus`; `C7+`, `D7+`, an
augmented symbol after the extension; `Dbo^7`, a diminished triad with a
major seventh). The remaining two, `Bb-77h` and `F7-b`, come from the two
damaged charts above.

## Grid scanner: three review findings deliberately left as they are

A code review of Phase 1 raised six findings. Three were fixed (an
unterminated `<...>` or `(...)` used to absorb every remaining bar of the
chart into one token, and `verifyAgainstLibrary.ts` neither survived an
unparsable link nor surfaced error reporter entries). The other three are
recorded here rather than acted on, with what was measured against the
real 657-chart library in each case.

A cell holding a bare `sus`, `alt` or `add` with no root fragments into
decoration tokens, so `sus` scans as `SMALL`, `UNKNOWN`, `SMALL` rather
than as one cell. Section 4 of the plan says "a bare `sus` means sus4",
which reads as being about a chord that writes no `2` or `4` after its
`sus` (`Csus`), and that form is handled; a rootless cell has zero
occurrences across the library. Scanning one as a single token would also
need a token type for a chord cell with no root, which `GridTT` does not
have, so the shape of the fix belongs to Phase 2's cell model rather than
to the scanner.

A nested or literal `<` inside an annotation would end the annotation
early, because the annotation rule takes the first `>` rather than a
balanced one. The library holds 168 annotations, exactly as many `<` as
`>` characters, and no annotation containing a second `<`, so there is no
evidence iReal Pro ever writes one; adding balance counting would be
guessing at a format detail rather than implementing a known one.

The grid token position handed to the error reporter is an absolute offset
into the grid text, where `Token.position` is line relative everywhere
else in the codebase, and the token's `line` stays 0. Grid text contains
no line break at all, in 0 of the 657 charts, so for this input the two
numbers are the same and line 0 is the correct line. This becomes worth
revisiting only if grid text ever gains line breaks.

## Grid parser: chord preservation could not be measured as the plan asks

Section 7 of `plans/2.ireal-grid-lexer-parser.md` makes the primary guard
for Phase 2 a multiset comparison: for each chart, the tree must name
each chord at least as often as the current implementation does. That
comparison turned out not to be available, and the reason lies in the
implementation it compares against. `gridAnnotations.ts` resolves a
repeated section by duplicating its text and a coda by duplicating the
span before it, those duplications compound over the twenty passes
`fillRepeats` is allowed, and the result is that the current
implementation names a chart's chords anywhere from once to six times
over, where the tree stores every bar exactly once by design. Measured
over the real 657-chart library: the current implementation names 54,943
chords and the tree names 42,663 with its repeats expanded once each, and
184 charts name at least one chord more often on the old side for this
reason alone. "Caminhando" is the clearest case, 156 occurrences of `G-`
against 26.

`verifyAgainstLibrary.ts` therefore checks containment over distinct
chord symbols, which no amount of expansion affects, and prints the
occurrence counts beside it for human review. That is what the invariant
exists to catch: a chord shape the new path drops. Measured over the same
library, 0 of 657 charts lose a chord symbol, and 0 charts throw.

## Grid parser: the brace and bracket characters are the two repeat barlines, not a matched pair

An early reading of section 4 of the plan ("a chart may open one and never
close it") suggested an unclosed `{` was a rare malformation. Measuring
the parser against the library instead gave 57 charts with an unclosed
`{` and 24 with a `}` that opens nothing, which is too many for either to
be a malformation. Both shapes are ordinary: "Au Privave" is
`{T44F7 | ... |G-7 C7 ]`, opening with a brace and closing with a
bracket, and "All Of Me 1" has `[N1E7 | ... |G7 }`, a bracketed group
closed with a brace. The reading that fits is that iReal Pro writes the
four characters as section boundaries, with `{` and `}` additionally
carrying the two repeat barlines, so a repeated span may be bounded at
either end by the plain form. The parser reads it that way: a section
boundary of any kind closes a repeat that is still open, and a closing
brace with no opening one marks the section it ends as repeated. With
that, 3 unclosed braces remain across the library, two of them the same
chart ("Black Diamonds", which has a genuine `{` with no closer before
the end of the chart) and one the damaged "Chippie".

## Grid parser: `IrealChart.navigation` holds one coda position, where a chart may mark two

The tree type in section 7 of the plan gives `navigation` a single
`codaSectionIndex`, and that is what is implemented. A chart that marks
both where to jump from and where the coda begins writes two `Q`
characters (the shape `gridAnnotations.ts`'s `fillCodas` reads), and the
tree keeps only the first. No chord is lost by this, since the parser
reorders nothing and every bar stays in its section; what is lost is the
distinction between the two markers, which the emitter will need in Phase
3. Recording the second position is a one-field addition to `Navigation`,
left to the phase that has a use for it.

## Grid scanner: `W` resolved as the previous chord over a written bass

Phase 1 left `W` as an `UNKNOWN` token, 6 occurrences in one chart
("Ingênuo", which the library holds twice). Phase 2 resolves it as the
previous cell's chord over the bass that follows the slash, which makes
it a sibling of `p` differing only in carrying a bass. Four observations
in that chart support the reading, and no reference consulted confirms
the letter itself.

Every occurrence has the shape `W/<bass>` as the second cell of a bar
whose first cell is a minor chord: `D-,W/C,`, `C-,W/Bb,` and `F-,W/Eb,`.
Each bass is the seventh below the preceding chord's root, giving Dm/C,
Cm/Bb and Fm/Eb, which are that chord with a descending bass. The same
chart writes out in full every slash chord whose root differs from the
cell before it (`G-/D`, `C-/G`, `F/A`, `A-/E`), so `W` stands exactly
where a repeated root would otherwise have been written. The same chart
also writes `p` (`|F7, |psAb7,|`), the same construct without a bass.

The scanner rule is deliberately narrow: `W` followed by a slash and a
root letter. A bare `W` stays `UNKNOWN`, because the evidence is about the
slash-bass form and nothing establishes what the letter means on its own.
This takes the library's `UNKNOWN` count from 40 to 28; the remaining 28
are the `F#*-^*` cell in "You Taught My Heart To Sing" and the two charts
whose chord data is damaged upstream, all three described above.

## Chord shorthand: one positional component parser in place of three whole-string patterns

`irealTextToParsedChord` was one primary regular expression plus two
fallbacks, each added when a chord shape turned out not to fit the fixed
component order the previous pattern assumed. Measured against the real
657-chart library, it rejected 8 distinct lexemes out of the 25,181 chord
lexemes the scanner isolates, 22 occurrences in all. Six were real music
and showed the same mismatch a third time over: `G7b9sus`, `Bb7b9sus` and
`A7b9sus` write an alteration between the extension and a trailing
quality word; `C7+` and `D7+` write a quality symbol after the extension;
`Dbo^7` combines two quality symbols.

Since iReal Pro fixes no order among a chord's components, the parser now
consumes a root and an optional accidental and then reads components in
whatever order they appear, validating the combination at the end. All six
shapes parse. Re-measured over the same library afterwards, 2 chord
lexemes are still rejected, 2 occurrences: `Bb-77h` and `F7-b`, both from
"Alfie's Theme", whose chord data is damaged upstream of the scanner. They
are left rejected rather than absorbed, because a shape that names no
chord should not be given one to make a count read zero.

Two spellings of the component sequence keep their previous reading rather
than a more general one, each for a reason measured rather than assumed. A
digit 5 standing immediately after the root is the Power chord symbol and
not an extension, which is the existing convention recorded above under
"5 chord text is ambiguous"; later in the sequence the same digit is an
ordinary extension, as in `C^5`. And the diminished major seventh needed
`ChordQuality.DiminishedMajor7` added to the shared enumeration, with
entries in `QUALITY_INTERVALS` and `SEVENTH_CHORD_SPECS`, and `o^` added
to ABCx's own chord symbol grammar (`pChordSymbol`, `scanChordSymbol.ts`
and `parseChordSymbol.ts`) so that the text `parsedChordToAbcxText`
produces for it parses back, which is the same three-place addition `-^`
and `alt` each needed before it.

## A lone star inside a chord cell truncates the chord

Measured by a differential comparison against pyRealParser over the 359
charts the two implementations share. After the two dialects' spellings
are normalised, every remaining difference but one is either a marker
pyRealParser fails to strip and we do (`N.C.` glued onto a chord, and the
bare `S`, `U` and `W` markers) or a chart whose stored data is damaged
upstream of both ("Alfie's Theme" and "Chippie", 23 and 27 bytes), where
both implementations read nonsense.

The one genuine gap is "You Taught My Heart To Sing", which writes
`F#*-^*`: a minor-major seventh with a lone `*` before and after the
quality symbols. Because `*` otherwise introduces a section marker, the
scanner ends the chord lexeme at it and the chord reads as `F#`, dropping
`-^`. One chord in one chart of 657, so it is recorded rather than fixed;
the fix belongs in the scanner, which should skip a `*` that no section
letter follows rather than treat it as a boundary.

## The tree's section order is not always the text's bar order

Found by a code review of the grid writer, and by a text-first differential
fuzz it ran: parse a random grid, write it, parse again, compare.

A numbered ending attaches to the section that owns the repeat, which the
parser finds through `endingsOwner` and which may be an earlier section
than the one whose bars follow it in the text. `{p *Ap N1Bb7` is fourteen
characters that demonstrate it: section 0 holds one bar and an ending
holding `Bb7`, section 1 holds the label `A` and one bar, and in the text
section 1's bar stands between section 0's bar and section 0's ending.

Writing sections in tree order therefore cannot reproduce that text. It
only matters for a cell whose content depends on what precedes it, which is
an unresolved `p` or `W/<bass>` back reference, and such a cell requires the
chart to name no chord at all before it. No chart in the sample library
reaches the shape. The writer reports the condition and writes `n` rather
than a `p` that would bind to the wrong chord, so the loss is visible
rather than silent.

Expressing it faithfully would need the tree to record where a section's
ending stands relative to other sections, which is a change to the parser's
own model rather than to the writer.

## A chord with an alteration and no extension may have no spelling

The alteration's digit follows the root directly, so a flattened fifth on A
with no extension writes `Ab5`, which reads back as an A flat power chord:
the text round-trips while the chord does not. The parser cannot produce
such a chord, since reading `Ab5` gives the power chord, so this concerns a
tree assembled by hand or read out of ABCx.

`irealChordTextRoundTrips` in `chordShorthand.ts` is the check, and it
compares the chord rather than the text, because comparing the text is
exactly the mistake that let this through the first time. The writer runs it
over every chord it writes and reports any that fails.

## ABCx has no decoration syntax, so a segno is a quoted annotation

Measured rather than assumed, which is what the plan asked for. Both of
ABC's decoration spellings fail in ABCx: `!segno!` and `+segno+` each scan
into an error node followed by the letters read as separate chord symbols,
with no error reported, so `!segno! C` yields chords named `e`, `g` and
`C`. A quoted annotation parses cleanly and is what the export uses, so a
segno is written `"^segno"` and a coda `"^coda"`.

The cost is that an annotation whose whole text is one of those two words
is read as the marker rather than as text to print. An annotation that
merely contains the word is left alone, which is the common case: "to coda
now" stays an annotation.

iReal Pro's `U` part marker has no ABCx spelling and the export never
produces one. The writer can still emit it from a tree that holds one,
which is how a chart read from a link keeps its part markers.

## Two chord spellings lose content in the ABCx scanner, upstream of this module

Both found while testing the ABCx reader, and neither is detectable in it,
since each fragment scans as a complete chord on its own.

A capitalised quality splits the symbol. `BbMaj7` is scanned as two chord
symbols, `BbM` and `a`, because `M` is a quality the ABCx chord pattern
accepts and `aj7` then begins a new symbol with the lowercase root `a`. The
result is two chords where the source wrote one, and nothing is reported.
Writing the quality in lower case, `Bbmaj7`, scans as one symbol.

A suspension after an extension is truncated. `C7sus4` is scanned as `C7`
alone, and `C13sus4` as `C13`, because `pChordSymbol` puts the quality
before the digits and so cannot match a quality that follows them. The
`sus4` is dropped silently. This repo's own ABCx writer already works
around it from the other side, spelling a sus chord quality first
(`Csus47`), which is recorded in `chordShorthand.ts`.

Fixing either means changing `pChordSymbol` and `scanChordSymbol`, which
every ABCx consumer shares, so neither is changed here.
