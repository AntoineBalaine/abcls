/**
 * The argument of the voicing commands (abc.harmonizeClose, abc.harmonizeCluster and abc.harmonizeSpread).
 *
 * Because a user keybinding or the modal menu may ask for a number of voices other than the default,
 * the commands read this optional argument instead of using a fixed count.
 */

export interface VoicingArgs {
  voices?: number;
}

export const DEFAULT_VOICES = 4;
export const ALLOWED_VOICES = [4, 5, 6];

/**
 * Reads the number of voices from a command argument.
 *
 * An absent argument, or an object whose voices field is absent or undefined, means the default. Because any other value
 * (a text, a number outside 4 to 6, or something that is not an object) is a mistake of the caller,
 * the function returns undefined for it, and the command reports the mistake.
 */
export function resolveVoices(args: unknown): number | undefined {
  if (args === undefined) return DEFAULT_VOICES;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const voices = (args as VoicingArgs).voices;
  // Because the menu calls the command with { voices: count } and the count may be missing, an undefined voices field means the default.
  if (voices === undefined) return DEFAULT_VOICES;
  if (typeof voices === "number" && ALLOWED_VOICES.includes(voices)) return voices;
  return undefined;
}
