/**
 * Deterministic content hash for translation-memory keys.
 *
 * WHY NOT `sha256Hex` (im-publish.service.ts): that helper is async because it
 * goes through `crypto.subtle`. Keying is called from inside pure `Array.map`
 * walks, from render-adjacent code, and from a few hundred Vitest assertions —
 * making it async infects every one of those with no benefit, because these are
 * lookup keys in our own database, not an integrity proof against an adversary.
 * There is no threat model in which somebody crafts a colliding manual sentence.
 *
 * WHY NOT `enSourceHash` (im-translation-marker.ts): that one is 32-bit djb2 and
 * fills the same "cheap deterministic content hash" role, so the precedent is
 * right — but at 32 bits birthday collisions become likely somewhere around 10^5
 * stored segments, and a mature multi-language corpus will pass that. 128 bits
 * puts the collision probability at roughly 10^-27 for a million segments.
 *
 * Belt AND braces regardless: retrieval must compare the candidate row's stored
 * source text against the queried source before applying it, so a collision can
 * only ever degrade to a cache miss, never to a wrong translation.
 *
 * Hashes over UTF-8 BYTES rather than UTF-16 code units, so the same value is
 * reproducible from Postgres or a non-JS runtime if that is ever wanted.
 */

/** Murmur3 fmix32 finalizer — cheap avalanche so single-bit input changes spread. */
const fmix32 = (h: number): number => {
  let x = h | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
};

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

const encoder = new TextEncoder();

/**
 * 128-bit FNV-1a-family hash, returned as 32 lowercase hex characters.
 * NOT cryptographic — see the file docstring.
 *
 * Four lanes with distinct offset bases and multipliers; two run forward over the
 * bytes and two backward, which decorrelates them far better than four forward
 * lanes would (four forward passes differ only by a constant, so they share
 * structure on short inputs).
 */
export const tmHash128 = (s: string): string => {
  const bytes = encoder.encode(s);
  const n = bytes.length;

  let h0 = 0x811c9dc5;
  let h1 = 0x9e3779b9;
  let h2 = 0x7feb352d;
  let h3 = 0x165667b1;

  for (let i = 0; i < n; i++) {
    const f = bytes[i];
    const b = bytes[n - 1 - i];
    h0 = Math.imul(h0 ^ f, 0x01000193);
    h1 = Math.imul(h1 ^ f, 0x85ebca6b);
    h2 = Math.imul(h2 ^ b, 0xc2b2ae35);
    h3 = Math.imul(h3 ^ b, 0x27d4eb2f);
  }

  // Mix the length in too, so a run of trailing zero bytes cannot alias.
  h0 ^= n;
  h1 ^= n;
  h2 ^= n;
  h3 ^= n;

  return hex8(fmix32(h0)) + hex8(fmix32(h1)) + hex8(fmix32(h2)) + hex8(fmix32(h3));
};

/**
 * Field separator for composite hash inputs: U+001F, the ASCII unit separator.
 *
 * Built with `fromCharCode` rather than written literally or as a string escape
 * so the source file stays plain ASCII — a raw control byte in a .ts file is the
 * kind of thing an editor, a linter autofix, or a diff tool silently eats.
 *
 * Normalization maps every control character to a space, so U+001F cannot appear
 * inside normalized segment text in the first place. The separator alone is
 * nevertheless NOT enough — see `tmHashFields`.
 */
export const HASH_FIELD_SEP = String.fromCharCode(31);

/**
 * Hash an ordered field list injectively.
 *
 * Each field is LENGTH-PREFIXED, not merely separated. A separator on its own is
 * ambiguous the moment any field can contain it: `['a', 'b']` and `['a<SEP>b']`
 * would join to the same string and therefore collide. Normalized segment text
 * can never contain U+001F, so within this pipeline that could not happen — but
 * the function is also called with locale codes, version numbers and digests from
 * elsewhere, and a hash helper that is only safe given assumptions about its
 * callers is a latent bug. Length prefixes make it unconditionally injective.
 */
export const tmHashFields = (fields: Array<string | number>): string =>
  tmHash128(
    fields
      .map((f) => {
        const s = String(f);
        return s.length + ':' + s;
      })
      .join(HASH_FIELD_SEP),
  );
