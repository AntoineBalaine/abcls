# Known gaps and unverified assumptions: ABCx to iReal Pro converter

This file tracks scope reductions and unconfirmed assumptions made during
implementation, per the project's policy of documenting these plainly
rather than silently working around or overclaiming coverage.

## Reduced grid notation scope

gridNotation.ts covers chord cells, "|" bar separators, "n" for N.C., and
"x" for repeat-previous-bar. It does not implement section labels (*A,
*B, *V), segno/coda, first/second endings, or the "r" repeat-previous-
two-bars shorthand. An unrecognized grid cell is silently skipped rather
than throwing, so a real chart using these features will import with
those elements missing, not with an error naming what was skipped. This
was a deliberate scope reduction given the amount of real sample chart
text available during implementation to confirm the full grammar against
was limited to one short fixture; building the rest of the grammar
correctly needs more real sample data than was available.

## Unconfirmed protocol fields

Field 5 (transpose) and the distinction between field 3 (style) and
field 7 (groove) were not confirmed against multiple real sample links;
only one real sample was found during implementation, and it did not
carry fields 7-9 at all. See fields.ts's module comment.

## Unconfirmed chord shorthand

chordShorthand.ts covers the five iReal quality symbols confirmed against
iReal Pro's own published reference (^, -, o, h, +) plus sus2/sus4 and a
best-effort convention for Power and Add chords and for alteration
ordering, none of which were confirmed against real sample data. See
chordShorthand.ts's module comment.

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

## Pre-existing ABCx scanner case sensitivity (not fixed here, out of scope)

music-theory/scanChordSymbol.ts's quality-word matching is case-sensitive
and only recognizes lowercase "maj" (not "Maj" or "MAJ"). A ChordSymbol
whose lexeme uses the capitalized form is truncated by the scanner before
this module ever sees the full text (confirmed: "BbMaj7" produces a
ChordSymbol token or partial match that does not include "aj7"). This is
pre-existing behavior in code this task was told to treat as already
solved, not something introduced or fixed here. exportToIreal.ts defends
against the narrower case where scanChordSymbol itself returns a partial
match (checking `consumed === lexeme.length`) by throwing a clear error
rather than silently exporting a truncated chord, but this does not catch
every way the upstream tokenization could already have dropped text
before a ChordSymbol node was even constructed.

## Architecture deviation from the plan: no Formatter reuse for import

The plan tentatively suggested the import direction might reuse the
existing Formatter (visitChordSymbolExpr is a one-line passthrough of the
chord's raw lexeme) to stringify a synthetic ABCx AST. Given this task's
time constraints did not allow rigorously verifying the Formatter's
full-ABC-oriented assumptions (multi-voice alignment, line wrapping)
against a minimal ABCx-shaped input, importFromIreal.ts instead builds
ABCx source text directly via string templating, validated by re-parsing
the generated text through the real ScannerAbcx/parseAbcx pipeline in
roundtrip.spec.ts. This is a lower-risk choice given the constraints, not
a finding that Formatter reuse would not have worked.

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

## A "repeat previous bar" cell mixed into a multi-cell bar is dropped

gridTokensToAbcxBody's whole-bar repeat resolution (see
importFromIreal.ts's module comment) only recognizes a "repeat previous
bar" ("x") cell when it is a bar's sole content. A real chart found while
importing a user's full iReal Pro library backup has an "x" cell sharing
a bar with other chord cells — a shape the reduced grid grammar
(gridNotation.ts; see "Reduced grid notation scope" above) was not built
to resolve a source bar for. cellText() returns an empty string for this
case rather than throwing, matching this file's existing policy for
unsupported grid shapes, so the song still imports; the dropped cell
simply contributes no text at that position, rather than correctly
repeating whatever the actual preceding bar would resolve to.

## Real charts commonly use grid features outside the reduced grammar, causing silent data loss cascading into wrong repeat-bar output

Investigating a user report of garbled repeat-bar output ("|:  :|" with
no chord text) against a real chart from their library backup found the
actual cause is upstream of the repeat-bar logic: real iReal Pro charts
routinely glue section labels and time signatures directly onto the
first chord of a section (e.g. "{*AT44D9,   "), use comma-padding inside
a cell for hold/sustain ("D9,   "), and use first/second-ending brackets
("N1", "N2", "{", "}", "[", "]") — none of which gridNotation.ts's
reduced grammar recognizes. Per that module's existing "unrecognized
cell is silently skipped" policy, a bar built entirely from such cells
resolves to empty text, and a later "x" (repeat previous bar) cell then
faithfully reproduces that emptiness, making the symptom visible as an
empty "|:  :|" even though the repeat-resolution logic itself is working
correctly (confirmed via importFromIreal.spec.ts's passing repeat-chain
test, which uses a chart with no unsupported grid features and resolves
correctly). Closing this gap for real needs the grammar extensions
described above, not another change to the repeat-bar logic.

## Grid-annotation cleanup (section labels, repeats with endings, codas, hold-padding)

gridAnnotations.ts's cleanGridText resolves most of the real-world grid
constructs documented above as gaps (section labels, time signatures,
comments, alternative chords, fermata, the "small" annotation, hold/
sustain comma padding, segno/coda jumps, and simple or first/second-
ending repeat sections), reimplemented from understanding of the
protocol gained by cross-referencing drs251/pyRealParser and
sciurius/perl-Data-iRealPro (not copied from either). Verified against a
real 657-song library backup: charts with a visible symptom of this gap
(an empty "|:  :|" repeat, the clearest sign content was silently
dropped) dropped from the majority of complex charts to 38 of 657 (~6%).
The "r" repeat-previous-two-bars shorthand mentioned in gridNotation.ts's
own doc comment is still not implemented, and is the most likely cause
of most of what remains — not independently confirmed per-chart.

## An unmatched repeat-section brace is treated as a plain bar, not a repeat

A real chart ("Perhaps", from a user's library backup) has a "{" with no
matching "}" anywhere in its chord data — not a hypothetical edge case.
cleanGridText's fillRepeats leaves an unresolvable "{" as a literal
character, which then glues onto whatever chord follows and breaks its
parsing, the same class of bug the unmatched-bracket and mixed-cell-bar
issues above were. Treated as a plain bar separator (same fallback
already used for "[" "]") rather than attempting to guess what repeat
structure was intended, since there's no way to know how far an
unclosed repeat section was meant to extend.

## Sus-chord shorthand: iReal writes the extension before "sus", not after

CHORD_TEXT_PATTERN assumed a quality symbol (including "sus2"/"sus4")
always precedes any extension digits, matching every other quality
symbol ("^7", "-7", "o7", ...). Real iReal Pro charts write a sus
chord's extension *before* "sus" instead ("G7sus", "A9sus" — a dominant
extension combined with sus4), and write a bare sus triad as plain
"sus" with no trailing "2"/"4" at all (confirmed against multiple real
charts in a user's library backup, not a hypothetical). Neither form
matched the existing pattern, so every sus chord in affected charts was
silently dropped — this turned out to be the single largest source of
the "empty repeat bar" symptom tracked across several earlier fixes in
this file: a dropped sus chord mid-chart shifted the measure count out
of sync with what any D.S./coda ('Q') or first/second-ending ('N1'/'N2')
structure elsewhere in the same chart expected, producing output that
looked like an unrelated repeat/coda bug until this was found and fixed.
Added SUS_CHORD_TEXT_PATTERN as a fallback tried when the primary
pattern doesn't match, covering both forms. Verified against the real
657-song backup: charts still showing the empty-repeat symptom dropped
from 32 to 10 (98.5% of the library now converts with no symptom at all).

## Altered-dominant chord quality ('alt') was entirely unrecognized

Neither CHORD_TEXT_PATTERN (iReal-text parsing) nor ABCx's own
pChordSymbol (parsers/scan_abcx_tunebody.ts) recognized "alt" at all —
confirmed against multiple real charts in a user's library backup,
including one ("Dominant 7alt Workout") that is *entirely* altered-
dominant chords, which therefore failed to convert at all before this
fix. Added ChordQuality.Altered to the shared enum, a parseAltChordText
fallback (same before-the-word extension ordering as sus chords: iReal
writes "C7alt", not "Calt7"), and "alt" to ABCx's own quality-word list
(which separately needed "alt" added to pChordSymbol — a different,
previously-undiscovered gap, found only by actually round-tripping the
ABCx text that chordShorthand.ts now correctly produces through the
real converter). The implied altered tensions themselves (b9/#9/#11/b13)
are not expanded into structured ChordAlteration entries — "alt" is kept
as a single opaque quality, consistent with iReal's own text never
spelling out which specific tensions it means.

Verified against the real 657-song backup: charts still showing the
empty-repeat symptom dropped from 10 to 7 (99% of the library now
converts with no symptom at all).

## Minor-major-7 chord quality ('-^') was unrecognized, completing the 657-song backup fix

"-^" (a minor triad with a major 7th, e.g. "C-^7") is a combined two-
character symbol iReal Pro uses — confirmed against a real chart in a
user's library backup ("A Shade Of Jade"). Neither CHORD_TEXT_PATTERN
nor ABCx's pChordSymbol listed it, and critically, the standalone "-"
(minor) and "^" (major) alternatives were tried first, consuming half of
the combined symbol and leaving the other half to corrupt parsing — the
same class of bug as every fix above in this file.

Added ChordQuality.MinorMajor7, with "-^" listed before the standalone
"-"/"^" alternatives everywhere it's matched (both for iReal-text parsing
and ABCx's own scanner), so the combined symbol wins the match.

This was the last of five real, independently-confirmed causes behind
the single bug report that started this chain (garbled/empty repeat
bars): an unmatched repeat brace, an unmatched bracket/mixed-cell bar,
the sus-chord extension ordering, the altered-dominant quality, and
finally this. Verified against the real 657-song backup: 0 of 657
charts now show the empty-repeat symptom — every chart in the library
converts cleanly.

## "x" (single-bar hold) was wrongly rendered as a music-notation repeat sign

gridTokensToAbcxBody previously wrapped every "x" ("this bar holds the
same chord as the previous bar") in ABC's `|:`/`:|` repeat-barline
syntax, on the theory that a single repeated bar is "semantically
equivalent" to a tiny repeated section. A user comparing our output
against iReal Pro's own display on a real chart ("A Felicidade") pointed
out this is wrong: iReal Pro only shows a repeat sign around its one
genuinely repeated section (the "{...}" bracket construct, 8 bars in
that chart), and shows every ordinary held chord as a plain repeated bar
with normal barlines — the same way a real lead sheet would. Wrapping
every "x" in repeat barlines instead littered the chart with dozens of
spurious repeat signs on chords that were never meant to be marked as a
repeated section at all.

Fixed: an "x" cell now resolves to the same plain chord text as the bar
it holds, written as an ordinary bar — no special barline syntax.
Verified against the real 657-song backup: 0 of 657 converted charts
contain "|:" anywhere.

Note this leaves the "{...}" genuine repeated-section construct
rendered as flat duplicated text (gridAnnotations.ts's fillRepeats),
not as an actual visual repeat sign — correct in substance (the right
chords in the right order) but not as visually compact as iReal Pro's
own repeat-sign display for that case. Teaching gridTokensToAbcxBody to
emit a real `|:`/`:|` pair around a genuinely repeated section (rather
than duplicating it) would need GridToken to distinguish a repeat-start/
repeat-end bar from a plain one, which the current bar model doesn't —
not implemented here.

## Section labels are now kept (shown as ABC's own "[P:X]" part-marker field)

Section labels ("*A", "*B", ...) were previously discarded entirely by
removeSectionLabels, on the theory that they carry no information the
reduced grid grammar needs. A user pointed out this drops real
structural information iReal Pro itself displays. markSectionLabels now
rewrites "*A" to a sentinel-wrapped cell ("§A§", padded with spaces so
it isolates correctly even when glued to the following chord/time-
signature) that textToGridTokens recognizes as its own sectionLabel
token, which gridTokensToAbcxBody renders as ABC's standard inline
part-marker field, "[P:A]" — not a bare "[A]", which looks similar but
was confirmed to collide with ABC's own bracket/inline-field syntax and
corrupt the chord immediately following it once converted to real ABC.
"[P:A]" round-trips cleanly through the real converter with no errors
and renders natively (in abcjs and other ABC renderers) as a proper
boxed section letter above the staff, the same thing iReal Pro itself
shows. The label is attached only to the bar that actually introduces
the section, not propagated onto later bars that hold the same chord
via "x".

## The genuinely repeated section is now shown once, with a real repeat sign

gridAnnotations.ts's fillRepeats flattens a "{...}" repeated section
into literal duplicated bar text (there being no repeat-barline model
threaded through this function's plain string-per-bar representation —
see the "x" fix above for the related, now-fixed, over-application of
that same syntax). A user comparing a real chart ("A Felicidade")
against iReal Pro's own display pointed out the repeated section should
show once, marked with an actual repeat sign, not written out twice.

compactImmediateRepeats (in gridTokensToAbcxBody) detects the longest
immediately-adjacent run of identical bars (checked longest-first, with
a 4-bar minimum to avoid misfiring on a merely-coincidental short
repeated phrase, like a ii-V appearing twice unrelatedly) and collapses
it into one `|: ... :|`-wrapped occurrence. This is a text-pattern
heuristic operating on the already-flattened bar array, not a structural
fix to how fillRepeats itself works — it reliably recovers the visual
repeat sign for the common case (the same text duplicated immediately
after itself) without the larger refactor a fully structural fix (giving
GridToken real repeat-start/repeat-end bar variants) would need.

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
