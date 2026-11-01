/** Public web-client request format; AES-128-CBC implemented without a runtime dependency. */
const KEY = "4f6bdaa39e2f8cb07f5e722d9edef314";
const IV = "01504af356e619cf2e42bba68c3f70f9";
const bytes = (hex) => hex.match(/../g).map((part) => parseInt(part, 16));
const twice = (n) => ((n << 1) ^ (n & 128 ? 0x11b : 0)) & 255;
function multiply(a, b) {
  let out = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) out ^= a;
    a = twice(a);
    b >>>= 1;
  }
  return out;
}
const SBOX = Array.from({ length: 256 }, (_, value) => {
  let inverse = 0;
  if (value) {
    inverse = 1;
    let base = value,
      exponent = 254;
    while (exponent) {
      if (exponent & 1) inverse = multiply(inverse, base);
      base = multiply(base, base);
      exponent >>>= 1;
    }
  }
  let out = inverse ^ 0x63;
  for (let shift = 1; shift <= 4; shift++)
    out ^= ((inverse << shift) | (inverse >>> (8 - shift))) & 255;
  return out;
});
const expanded = bytes(KEY);
let roundConstant = 1;
while (expanded.length < 176) {
  let word = expanded.slice(-4);
  if (expanded.length % 16 === 0) {
    word = [word[1], word[2], word[3], word[0]].map((value) => SBOX[value]);
    word[0] ^= roundConstant;
    roundConstant = twice(roundConstant);
  }
  for (const value of word)
    expanded.push(expanded[expanded.length - 16] ^ value);
}
function encryptBlock(input) {
  let state = input.map((value, index) => value ^ expanded[index]);
  for (let round = 1; round <= 10; round++) {
    const shifted = Array(16);
    for (let column = 0; column < 4; column++)
      for (let row = 0; row < 4; row++)
        shifted[column * 4 + row] = SBOX[state[((column + row) % 4) * 4 + row]];
    state = shifted;
    if (round < 10)
      for (let column = 0; column < 4; column++) {
        const offset = column * 4,
          [a, b, c, d] = state.slice(offset, offset + 4),
          sum = a ^ b ^ c ^ d;
        state[offset] = a ^ sum ^ twice(a ^ b);
        state[offset + 1] = b ^ sum ^ twice(b ^ c);
        state[offset + 2] = c ^ sum ^ twice(c ^ d);
        state[offset + 3] = d ^ sum ^ twice(d ^ a);
      }
    state = state.map((value, index) => value ^ expanded[round * 16 + index]);
  }
  return state;
}
export function kisskhRequestKey(episodeId, subtitles = false) {
  if (!/^\d{1,10}$/.test(String(episodeId)))
    throw Error("Invalid KissKH episode identity.");
  const fields = [
    "",
    String(episodeId),
    "",
    "mg3c3b04ba",
    "2.8.10",
    subtitles
      ? "VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp"
      : "62f176f3bb1b5b8e70e39932ad34a0c7",
    "4830201",
    ...Array(6).fill("kisskh"),
    "00",
    "",
  ];
  let checksum = 0;
  for (const character of fields.join("|"))
    checksum = (checksum << 5) - checksum + character.charCodeAt(0);
  fields.splice(1, 0, String(checksum));
  const plain = Array.from(fields.join("|"), (character) =>
    character.charCodeAt(0),
  );
  const padding = 16 - (plain.length % 16);
  plain.push(...Array(padding).fill(padding));
  let previous = bytes(IV);
  const output = [];
  for (let offset = 0; offset < plain.length; offset += 16) {
    previous = encryptBlock(
      plain
        .slice(offset, offset + 16)
        .map((value, index) => value ^ previous[index]),
    );
    output.push(...previous);
  }
  return output
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}
