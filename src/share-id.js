const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

// 24 characters from a 62-symbol alphabet is about 143 bits of entropy.
export function newShareId(length = 24) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let id = ""
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length]
  return id
}
