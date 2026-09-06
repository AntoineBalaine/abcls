/**
 * iReal Pro link chord-data scrambling.
 *
 * The chord-data field of an irealb:// link is obfuscated before being
 * placed in the URL. This is a plain protocol detail (fixed chunk size,
 * fixed swap index ranges, a fixed marker string), not anyone's creative
 * expression, and is reimplemented here independently from that
 * description rather than from any reference implementation's source.
 */

const CHUNK_SIZE = 50;
const REPLACEMENTS: Array<[string, string]> = [
  ["Kcl", "| x"],
  ["LZ", " |"],
  ["XyQ", "   "],
];

function swapChunk(chunk: string): string {
  const out = chunk.split("");
  for (let i = 0; i < 5; i++) {
    const tmp = out[i];
    out[i] = out[CHUNK_SIZE - 1 - i];
    out[CHUNK_SIZE - 1 - i] = tmp;
  }
  for (let i = 10; i < 24; i++) {
    const tmp = out[i];
    out[i] = out[CHUNK_SIZE - 1 - i];
    out[CHUNK_SIZE - 1 - i] = tmp;
  }
  return out.join("");
}

export function unscramble(input: string): string {
  let s = input;
  let result = "";
  while (s.length > CHUNK_SIZE + 1) {
    result += swapChunk(s.substring(0, CHUNK_SIZE));
    s = s.substring(CHUNK_SIZE);
  }
  result += s;
  for (const [from, to] of REPLACEMENTS) {
    result = result.split(from).join(to);
  }
  return result;
}

export function scramble(input: string): string {
  let s = input;
  for (const [from, to] of REPLACEMENTS) {
    s = s.split(to).join(from);
  }
  let result = "";
  while (s.length > CHUNK_SIZE + 1) {
    result += swapChunk(s.substring(0, CHUNK_SIZE));
    s = s.substring(CHUNK_SIZE);
  }
  result += s;
  return result;
}
