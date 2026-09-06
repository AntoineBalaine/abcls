/**
 * iReal Pro `irealb://` link field layout.
 *
 * Confirmed against a real sample link (see fields.spec.ts): fields 0-6
 * (title, composer, an empty field, style, key, transpose, chord data)
 * are settled. Fields 7-9 (groove, bpm, repeats) are documented from
 * secondary sources only and were absent from the one real sample found
 * during implementation, so their exact presence/defaulting behavior on
 * real links is not independently confirmed here; treat them as
 * best-effort until checked against a sample link that actually carries
 * them.
 */

const CHORD_DATA_MARKER = "1r34LbKcu7";
const SONG_SEPARATOR = "===";
const FIELD_SEPARATOR = "=";
const SCHEME_PREFIX = "irealb://";

export interface IrealSongFields {
  title: string;
  composer: string;
  style: string;
  key: string;
  transpose: string;
  rawChordData: string; // scrambled, including the marker prefix
  groove?: string;
  bpm?: string;
  repeats?: string;
}

export interface IrealPlaylist {
  songs: IrealSongFields[];
  playlistName?: string;
}

// A single space used to break up two adjacent empty fields; see
// buildSongFieldString's comment for why this is necessary. None of this
// module's own fields ever legitimately need to contain exactly one space
// as real content, so this is a safe, unambiguous placeholder for them.
const EMPTY_FIELD_GUARD = " ";

export function buildSongFieldString(fields: IrealSongFields): string {
  // Field 2 is always empty by design. Any two ADJACENT empty fields
  // anywhere in this list produce a literal "===" (field + "=" + "" + "="
  // + "" + "=" + field), indistinguishable from the playlist separator and
  // corrupting parsePlaylistLink on the way back in. This was found by
  // round-tripping a real export during implementation, not anticipated
  // in the plan; whether real iReal Pro links ever hit this same case (and
  // if so how the real format avoids it) was not confirmed against enough
  // real sample data to know for certain.
  const parts = [fields.title, fields.composer, "", fields.style, fields.key, fields.transpose, fields.rawChordData, fields.groove ?? "", fields.bpm ?? "", fields.repeats ?? ""];
  for (let i = 1; i < parts.length; i++) {
    if (parts[i] === "" && parts[i - 1] === "") {
      parts[i] = EMPTY_FIELD_GUARD;
    }
  }
  // An empty field at either edge leaves a bare "=" adjacent to whatever
  // comes next to this whole song string (another song joined by the
  // "===" separator, or a trailing playlist name), which combines into a
  // run of 4+ "=" characters and breaks parsePlaylistLink's split the same
  // way an internal adjacent pair does; guard both edges too.
  if (parts[0] === "") parts[0] = EMPTY_FIELD_GUARD;
  if (parts[parts.length - 1] === "") parts[parts.length - 1] = EMPTY_FIELD_GUARD;
  return parts.join(FIELD_SEPARATOR);
}

export function parseSongFieldString(songString: string): IrealSongFields {
  const parts = songString.split(FIELD_SEPARATOR);
  if (parts.length < 7) {
    throw new Error(`Malformed iReal song string: expected at least 7 fields, got ${parts.length}`);
  }
  // Undo buildSongFieldString's empty-field guard: a lone space in one of
  // these positions means "this field was empty," not a real single-space
  // value, per that function's comment.
  const unguard = (v: string | undefined): string | undefined => (v === EMPTY_FIELD_GUARD ? "" : v);

  return {
    title: unguard(parts[0]) ?? "",
    composer: parts[1],
    style: unguard(parts[3]) ?? "",
    key: parts[4],
    transpose: parts[5],
    rawChordData: parts[6],
    groove: unguard(parts[7]) || undefined,
    bpm: unguard(parts[8]) || undefined,
    repeats: unguard(parts[9]) || undefined,
  };
}

export function buildPlaylistLink(playlist: IrealPlaylist): string {
  const songStrings = playlist.songs.map(buildSongFieldString);
  const body = playlist.playlistName !== undefined ? [...songStrings, playlist.playlistName].join(SONG_SEPARATOR) : songStrings.join(SONG_SEPARATOR);
  return SCHEME_PREFIX + body;
}

export function parsePlaylistLink(link: string): IrealPlaylist {
  const withoutScheme = link.startsWith(SCHEME_PREFIX) ? link.slice(SCHEME_PREFIX.length) : link;
  // A real percent-encoded link always decodes successfully; plain text
  // that merely happens to contain a literal "%" (not valid percent-
  // encoding syntax) does not, so a raw decodeURIComponent attempt with a
  // fallback is more robust than guessing from the presence of "%" alone,
  // which throws on that plain-text case instead of leaving it untouched.
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutScheme);
  } catch {
    decoded = withoutScheme;
  }
  const parts = decoded.split(SONG_SEPARATOR);
  // A genuine song string always contains the chord-data marker; a
  // trailing playlist name never does. Unconditionally popping the last
  // part whenever there is more than one (an approach seen in some
  // reference material) is wrong: a real multi-song playlist with no name
  // at all would then have its last song misread as a playlist name.
  const lastPart = parts[parts.length - 1];
  const playlistName = parts.length > 1 && lastPart !== undefined && !lastPart.includes(CHORD_DATA_MARKER) ? parts.pop() : undefined;
  return {
    songs: parts.filter((p) => p.length > 0).map(parseSongFieldString),
    playlistName: playlistName || undefined,
  };
}

export function stripChordDataMarker(rawChordData: string): string {
  const idx = rawChordData.indexOf(CHORD_DATA_MARKER);
  if (idx === -1) {
    throw new Error(`Chord data field does not contain the expected marker "${CHORD_DATA_MARKER}"`);
  }
  return rawChordData.slice(idx + CHORD_DATA_MARKER.length);
}

export function withChordDataMarker(scrambledChordText: string): string {
  return CHORD_DATA_MARKER + scrambledChordText;
}
