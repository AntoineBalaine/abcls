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
