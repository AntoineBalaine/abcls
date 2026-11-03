# Vendored: MusicXML Test Suite

Source: https://github.com/cuthbertLab/musicxmlTestSuite
Commit: 20d4e784508f562868d00386c596e224c33991da (2026-08-18)
License: MIT (see LICENSE in this directory)

181 of the corpus's 182 files are vendored here. `90a-Compressed-MusicXML.mxl`
is excluded: it is a compressed zip container, not raw XML text, and this
codebase's importer takes XML text directly. Unzipping support does not exist
and is out of scope.

Three files contain `.invalid.` in their name (`41g-PartNoId.invalid.musicxml`,
`74b-FiguredBass.invalid.musicxml`, and one other found by grepping the
vendored set for `.invalid.`) and are deliberately malformed documents, per
the corpus's own convention, used to test schema-validation rejection. They
are vendored for completeness but excluded from any "must round-trip
successfully" assertion in musicXmlTestSuiteSurvey.spec.ts.
