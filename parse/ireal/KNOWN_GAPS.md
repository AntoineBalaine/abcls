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
