// Short, sortable, collision-resistant ids (time prefix + randomness).
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function ulid(prefix = ''): string {
  const now = Date.now();
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = ALPHABET[t % 32]! + time; t = Math.floor(t / 32); }
  let rand = '';
  const bytes = new Uint8Array(12);
  (globalThis.crypto ?? require('crypto').webcrypto).getRandomValues(bytes);
  for (const b of bytes) rand += ALPHABET[b % 32]!;
  return `${prefix}${time}${rand}`;
}
