/*
MIT License

Copyright (c) 2025 Pal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The MIT License (MIT)

Copyright (c) 2022 Paul Miller (https://paulmillr.com)
Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// lib/manga-common.js
function text(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
    if (key[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[key.toLowerCase()];
    const number = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 1114111 ? String.fromCodePoint(number) : "";
  }).replace(/\s+/g, " ").trim();
}
function attrs(value) {
  const out = {};
  for (const m of String(value).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = text(m[2] ?? m[3] ?? m[4]);
  return out;
}
function url(raw, origin) {
  let value = String(raw ?? "").replace(/&amp;/g, "&").trim();
  if (value.startsWith("//")) value = "https:" + value;
  else if (value.startsWith("/")) value = origin + value;
  if (value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(\/[^#]*)?$/i.exec(value);
  if (!match) return null;
  let decoded;
  try {
    decoded = decodeURIComponent((match[2] ?? "/").split("?")[0]);
  } catch {
    return null;
  }
  if (/(?:^|\/)\.{1,2}(?:\/|$)|[\\\u0000-\u001f]/.test(decoded)) return null;
  return { value, host: match[1].toLowerCase(), path: match[2] ?? "/" };
}

// lib/anime-common.js
function identity(value, pattern = /^[a-z0-9_-]+$/i) {
  if (typeof value !== "string" || !value.length || value.length > 500 || !pattern.test(value)) throw Error("Invalid anime source identity.");
  return value;
}
function mediaUrl(value, origin) {
  const p = url(value, origin);
  if (!p || p.value.length > 2048 || !p.host.includes(".") || /^[\d.]+$/.test(p.host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(p.host)) throw Error("Invalid public HTTPS media URL.");
  return p.value;
}
function request(host, origin) {
  return async (path, { json = false, full = false, method = "GET", headers = {}, body } = {}) => {
    const p = url(path, origin);
    if (!p) throw Error("Invalid source request.");
    const response = await host.fetch({ url: p.value, method, headers: { Accept: json ? "application/json" : "text/html", Referer: origin + "/", ...headers }, ...body === void 0 ? {} : { body } });
    if (response.status !== 200) throw Error(`Source returned HTTP ${response.status}.`);
    if (typeof response.body !== "string" || response.body.length > 2 * 1024 * 1024) throw Error("Source metadata exceeds its size limit.");
    if (/cf-chl-|<title[^>]*>\s*(?:Just a moment|Attention Required)/i.test(response.body)) throw Error("Source requires browser verification.");
    if (full) return response;
    if (!json) return response.body;
    try {
      return JSON.parse(response.body);
    } catch {
      throw Error("Source returned invalid JSON.");
    }
  };
}
function titles(rows, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw Error("Invalid anime search limit.");
  const found = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!row.id || !text(row.title)) continue;
    found.set(row.id, { ...row, title: text(row.title).slice(0, 500), kind: "anime" });
  }
  return [...found.values()].slice(0, limit);
}
function episodes(rows, animeId) {
  const found = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!row.id || !Number.isFinite(row.number) || row.number < 0 || row.number > 1e4) throw Error("Invalid source episode metadata.");
    found.set(row.id, { ...row, animeId, title: text(row.title ?? `Episode ${row.number}`).slice(0, 500) });
  }
  if (found.size > 5e3) throw Error("Source returned too many episodes.");
  return [...found.values()].sort((a, b) => a.number - b.number);
}
function rendition(raw, origin, { quality = "auto", type, headers, subtitles } = {}) {
  const value = mediaUrl(raw, origin), container = type ?? (/\.m3u8(?:[?#]|$)/i.test(value) ? "hls" : /\.mp4(?:[?#]|$)/i.test(value) ? "mp4" : /\.mkv(?:[?#]|$)/i.test(value) ? "mkv" : null);
  if (!container || !["hls", "mp4", "mkv"].includes(container)) throw Error("Source returned an embed page instead of playable media.");
  return { url: value, type: container, quality: String(quality).slice(0, 60) || "auto", ...headers ? { headers } : {}, ...subtitles?.length ? { subtitles } : {} };
}
function result(server, videoSources, headers) {
  if (!videoSources.length || videoSources.length > 50) throw Error("Source did not return playable media.");
  return { server, videoSources, ...headers ? { headers } : {} };
}
function literal(value) {
  if (typeof value !== "string" || value.length > 65536 || !/^(["'])[\s\S]*\1$/.test(value)) throw Error("Invalid source string literal.");
  if (value[0] === '"') {
    try {
      return JSON.parse(value);
    } catch {
      throw Error("Invalid source string literal.");
    }
  }
  let out = "";
  for (let i = 1; i < value.length - 1; i++) {
    let c = value[i];
    if (c === "\\") {
      c = value[++i];
      const special = { n: "\n", r: "\r", t: "	", b: "\b", f: "\f", v: "\v" };
      if (c === "u" || c === "x") {
        const size = c === "u" ? 4 : 2, hex2 = value.slice(i + 1, i + 1 + size);
        if (!new RegExp("^[0-9a-f]{" + size + "}$", "i").test(hex2)) throw Error("Invalid escaped source string.");
        out += String.fromCharCode(parseInt(hex2, 16));
        i += size;
        continue;
      }
      out += special[c] ?? c;
    } else out += c;
  }
  return out;
}

// lib/svelte-data.js
function decodeSvelte(payload, predicate = () => true) {
  const table = payload?.nodes?.find((node2) => node2?.type === "data" && Array.isArray(node2.data) && predicate(node2.data[0]))?.data;
  if (!Array.isArray(table) || !table.length || table.length > 5e4) throw Error("Invalid Svelte source data.");
  let budget = 1e5;
  function node(value, seen, depth) {
    if (--budget < 0 || depth > 64) throw Error("Source data exceeds its decoding limit.");
    if (Array.isArray(value)) return value.map((v) => ref(v, seen, depth + 1));
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, v] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) continue;
        out[key] = ref(v, seen, depth + 1);
      }
      return out;
    }
    return value;
  }
  function ref(value, seen = /* @__PURE__ */ new Set(), depth = 0) {
    if (Number.isInteger(value) && value >= 0 && value < table.length) {
      if (seen.has(value)) return null;
      const next = new Set(seen);
      next.add(value);
      return node(table[value], next, depth + 1);
    }
    return node(value, seen, depth + 1);
  }
  return ref(0);
}

// lib/base64.js
function decodeBase64Bytes(value) {
  if (typeof value !== "string" || value.length > 65536) throw Error("Encoded source data exceeds its limit.");
  const input = value.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 === 1) throw Error("Invalid encoded source data.");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bytes = [];
  let bits = 0, n = 0;
  for (const c of input) {
    if (c === "=") break;
    n = n << 6 | alphabet.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(n >> bits & 255);
    }
  }
  return Uint8Array.from(bytes);
}
function decodeBase64(value) {
  const bytes = decodeBase64Bytes(value);
  try {
    return decodeURIComponent([...bytes].map((b) => "%" + b.toString(16).padStart(2, "0")).join(""));
  } catch {
    throw Error("Invalid UTF-8 source data.");
  }
}

// node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/utils.js
/*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function aoutput32(out, instance) {
  aoutput(out, instance);
  if (!isAligned32(out))
    throw new Error("invalid output, must be aligned");
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function overlapBytes(a, b) {
  if (!a.byteLength || !b.byteLength)
    return false;
  return a.buffer === b.buffer && // best we can do, may fail with an obscure Proxy
  a.byteOffset < b.byteOffset + b.byteLength && // a starts before b end
  b.byteOffset < a.byteOffset + a.byteLength;
}
function complexOverlapBytes(input, output) {
  if (overlapBytes(input, output) && input.byteOffset < output.byteOffset)
    throw new Error("complex overlap of input and output is not supported");
}
function equalBytes(a, b) {
  a = abytes(a);
  b = abytes(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== void 0 ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart; i < args.length; i++)
        if (isBytes(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== void 0)
      abytes(args[aadStart], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes(data, void 0, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes(data, void 0, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  abytes(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE2) {
  anumber(dataLength);
  anumber(aadLength);
  abool(isLE2);
  const num = new Uint8Array(16);
  const view = createView(num);
  view.setBigUint64(0, BigInt(aadLength), isLE2);
  view.setBigUint64(8, BigInt(dataLength), isLE2);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes(bytes));
}

// node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/_polyval.js
var BLOCK_SIZE = 16;
var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
var ZEROS32 = /* @__PURE__ */ u32(ZEROS16);
var POLY = 225;
var mul2 = (s0, s1, s2, s3) => {
  const hiBit = s3 & 1;
  return {
    s3: s2 << 31 | s3 >>> 1,
    s2: s1 << 31 | s2 >>> 1,
    s1: s0 << 31 | s1 >>> 1,
    // NIST SP 800-38D §6.3 applies `V >> 1` and XORs R on carry. In this
    // 4x32-bit split, R = 0xe1 || 0^120 lives in the top byte of s0.
    s0: s0 >>> 1 ^ POLY << 24 & -(hiBit & 1)
    // reduce % poly
  };
};
var swapLE = (n) => (n >>> 0 & 255) << 24 | (n >>> 8 & 255) << 16 | (n >>> 16 & 255) << 8 | n >>> 24 & 255 | 0;
var estimateWindow = (bytes) => {
  if (bytes > 64 * 1024)
    return 8;
  if (bytes > 1024)
    return 4;
  return 2;
};
var GHASH = class {
  // We select bits per window adaptively based on expectedLength
  constructor(key, expectedLength) {
    __publicField(this, "blockLen", BLOCK_SIZE);
    __publicField(this, "outputLen", BLOCK_SIZE);
    __publicField(this, "s0", 0);
    __publicField(this, "s1", 0);
    __publicField(this, "s2", 0);
    __publicField(this, "s3", 0);
    __publicField(this, "finished", false);
    __publicField(this, "destroyed", false);
    __publicField(this, "t");
    __publicField(this, "W");
    __publicField(this, "windowSize");
    abytes(key, 16, "key");
    key = copyBytes(key);
    const kView = createView(key);
    let k0 = kView.getUint32(0, false);
    let k1 = kView.getUint32(4, false);
    let k2 = kView.getUint32(8, false);
    let k3 = kView.getUint32(12, false);
    const doubles = [];
    for (let i = 0; i < 128; i++) {
      doubles.push({ s0: swapLE(k0), s1: swapLE(k1), s2: swapLE(k2), s3: swapLE(k3) });
      ({ s0: k0, s1: k1, s2: k2, s3: k3 } = mul2(k0, k1, k2, k3));
    }
    const W = estimateWindow(expectedLength || 1024);
    if (![1, 2, 4, 8].includes(W))
      throw new Error("ghash: invalid window size, expected 2, 4 or 8");
    this.W = W;
    const bits = 128;
    const windows = bits / W;
    const windowSize = this.windowSize = 2 ** W;
    const items = [];
    for (let w = 0; w < windows; w++) {
      for (let byte = 0; byte < windowSize; byte++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let j = 0; j < W; j++) {
          const bit = byte >>> W - j - 1 & 1;
          if (!bit)
            continue;
          const { s0: d0, s1: d1, s2: d2, s3: d3 } = doubles[W * w + j];
          s0 ^= d0, s1 ^= d1, s2 ^= d2, s3 ^= d3;
        }
        items.push({ s0, s1, s2, s3 });
      }
    }
    this.t = items;
  }
  _updateBlock(s0, s1, s2, s3) {
    s0 ^= this.s0, s1 ^= this.s1, s2 ^= this.s2, s3 ^= this.s3;
    const { W, t, windowSize } = this;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    const mask = (1 << W) - 1;
    let w = 0;
    for (const num of [s0, s1, s2, s3]) {
      for (let bytePos = 0; bytePos < 4; bytePos++) {
        const byte = num >>> 8 * bytePos & 255;
        for (let bitPos = 8 / W - 1; bitPos >= 0; bitPos--) {
          const bit = byte >>> W * bitPos & mask;
          const { s0: e0, s1: e1, s2: e2, s3: e3 } = t[w * windowSize + bit];
          o0 ^= e0, o1 ^= e1, o2 ^= e2, o3 ^= e3;
          w += 1;
        }
      }
    }
    this.s0 = o0;
    this.s1 = o1;
    this.s2 = o2;
    this.s3 = o3;
  }
  update(data) {
    aexists(this);
    abytes(data);
    data = copyBytes(data);
    const b32 = u32(data);
    const blocks = Math.floor(data.length / BLOCK_SIZE);
    const left = data.length % BLOCK_SIZE;
    for (let i = 0; i < blocks; i++) {
      this._updateBlock(swap8IfBE(b32[i * 4 + 0]), swap8IfBE(b32[i * 4 + 1]), swap8IfBE(b32[i * 4 + 2]), swap8IfBE(b32[i * 4 + 3]));
    }
    if (left) {
      ZEROS16.set(data.subarray(blocks * BLOCK_SIZE));
      this._updateBlock(swap8IfBE(ZEROS32[0]), swap8IfBE(ZEROS32[1]), swap8IfBE(ZEROS32[2]), swap8IfBE(ZEROS32[3]));
      clean(ZEROS32);
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    const { t } = this;
    for (const elm of t) {
      elm.s0 = 0, elm.s1 = 0, elm.s2 = 0, elm.s3 = 0;
    }
  }
  digestInto(out) {
    aexists(this);
    aoutput32(out, this);
    this.finished = true;
    const { s0, s1, s2, s3 } = this;
    const o32 = u32(out);
    o32[0] = s0;
    o32[1] = s1;
    o32[2] = s2;
    o32[3] = s3;
    if (!isLE)
      swap32IfBE(o32.subarray(0, BLOCK_SIZE / 4));
  }
  digest() {
    const res = new Uint8Array(BLOCK_SIZE);
    this.digestInto(res);
    this.destroy();
    return res;
  }
};
var ghash = /* @__PURE__ */ wrapMacConstructor(16, (key, expectedLength) => new GHASH(key, expectedLength), (msg) => [msg.length]);

// node_modules/.pnpm/@noble+ciphers@2.4.0/node_modules/@noble/ciphers/aes.js
var BLOCK_SIZE2 = 16;
var BLOCK_SIZE32 = 4;
var EMPTY_BLOCK = /* @__PURE__ */ new Uint8Array(BLOCK_SIZE2);
var POLY2 = 283;
function validateKeyLength(key) {
  if (![16, 24, 32].includes(key.length))
    throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
}
function mul22(n) {
  return n << 1 ^ POLY2 & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul22(a);
  }
  return res;
}
var sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul22(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean(t);
  return box;
})();
var invSbox = /* @__PURE__ */ sbox.map((_, j) => sbox.indexOf(j));
var rotr32_8 = (n) => n << 24 | n >>> 8;
var rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox2, fn) {
  if (sbox2.length !== 256)
    throw new Error("wrong sbox length");
  const T0 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
  const T1 = T0.map(rotl32_8);
  const T2 = T1.map(rotl32_8);
  const T3 = T2.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox22 = new Uint16Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T0[i] ^ T1[j];
      T23[idx] = T2[i] ^ T3[j];
      sbox22[idx] = sbox2[i] << 8 | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T0, T1, T2, T3, T01, T23 };
}
var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
var tableDecoding = /* @__PURE__ */ genTtable(invSbox, (s) => mul(s, 11) << 24 | mul(s, 13) << 16 | mul(s, 9) << 8 | mul(s, 14));
var xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul22(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes(key);
  const len = key.length;
  validateKeyLength(key);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isLE || !isAligned32(key))
    toClean.push(key = copyBytes(key));
  const k32 = swap32IfBE(u32(key));
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean(...toClean);
  return xk;
}
function expandKeyDecLE(key) {
  const encKey = expandKeyLE(key);
  const xk = encKey.slice();
  const Nk = encKey.length;
  const { sbox2 } = tableEncoding;
  const { T0, T1, T2, T3 } = tableDecoding;
  for (let i = 0; i < Nk; i += 4) {
    for (let j = 0; j < 4; j++)
      xk[i + j] = encKey[Nk - i - 4 + j];
  }
  clean(encKey);
  for (let i = 4; i < Nk - 4; i++) {
    const x = xk[i];
    const w = applySbox(sbox2, x, x, x, x);
    xk[i] = T0[w & 255] ^ T1[w >>> 8 & 255] ^ T2[w >>> 16 & 255] ^ T3[w >>> 24];
  }
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function decrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableDecoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s3, s2, s1);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s0, s3, s2);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s1, s0, s3);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s2, s1, s0);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s3, s2, s1);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s0, s3, s2);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s1, s0, s3);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s2, s1, s0);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctr32(xk, isLE2, nonce, src, dst) {
  abytes(nonce, BLOCK_SIZE2, "nonce");
  abytes(src);
  dst = getOutput(src.length, dst);
  const ctr = nonce;
  const c32 = u32(ctr);
  const view = createView(ctr);
  const src32 = u32(src);
  const dst32 = u32(dst);
  const ctrPos = isLE2 ? 0 : 12;
  const srcLen = src.length;
  let ctrNum = view.getUint32(ctrPos, isLE2);
  for (let i = 0; i + 4 <= src32.length; i += 4) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    dst32[i + 0] = src32[i + 0] ^ swap8IfBE(s0);
    dst32[i + 1] = src32[i + 1] ^ swap8IfBE(s1);
    dst32[i + 2] = src32[i + 2] ^ swap8IfBE(s2);
    dst32[i + 3] = src32[i + 3] ^ swap8IfBE(s3);
    ctrNum = ctrNum + 1 >>> 0;
    view.setUint32(ctrPos, ctrNum, isLE2);
  }
  const start = BLOCK_SIZE2 * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    swap32IfBE(b32);
    const buf = u8(b32);
    for (let i = start, pos = 0; i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean(b32);
  }
  return dst;
}
function validateBlockDecrypt(data, dst) {
  abytes(data);
  if (data.length % BLOCK_SIZE2 !== 0) {
    throw new Error("ciphertext must be multiple of " + BLOCK_SIZE2);
  }
  if (dst !== void 0) {
    getOutput(data.length, dst);
    complexOverlapBytes(data, dst);
  }
}
function validateBlockEncrypt(plaintext2, pkcs5, dst) {
  abytes(plaintext2);
  let outLen = plaintext2.length;
  const remaining = outLen % BLOCK_SIZE2;
  if (!pkcs5 && remaining !== 0)
    throw new Error("plaintext must be multiple of " + BLOCK_SIZE2);
  if (pkcs5) {
    let left = BLOCK_SIZE2 - remaining;
    if (!left)
      left = BLOCK_SIZE2;
    outLen = outLen + left;
  }
  if (dst !== void 0) {
    getOutput(outLen, dst);
    complexOverlapBytes(plaintext2, dst);
  }
  return outLen;
}
function prepareBlockEncrypt(plaintext2, outLen, dst) {
  if (dst === void 0)
    dst = new Uint8Array(outLen);
  if (!isLE || !isAligned32(plaintext2))
    plaintext2 = copyBytes(plaintext2);
  const o = u32(dst);
  return { b: plaintext2, o, out: dst };
}
function validatePKCS(data, pkcs5) {
  if (!pkcs5)
    return data;
  const len = data.length;
  if (len === 0)
    throw new Error("pkcs7: empty ciphertext not allowed");
  const lastByte = data[len - 1];
  let valid = 1;
  valid &= lastByte - 1 >>> 31 ^ 1;
  valid &= 16 - lastByte >>> 31 ^ 1;
  for (let i = 0; i < 16; i++) {
    const shouldCheck = i - lastByte >>> 31;
    const eq = (data[len - 1 - i] ^ lastByte) === 0 ? 1 : 0;
    valid &= eq | shouldCheck ^ 1;
  }
  if (!valid)
    throw new Error("aes: bad decrypt");
  return data.subarray(0, len - lastByte);
}
function padPCKS(left) {
  const tmp = new Uint8Array(16);
  const tmp32 = u32(tmp);
  tmp.set(left);
  const paddingByte = BLOCK_SIZE2 - left.length;
  for (let i = BLOCK_SIZE2 - paddingByte; i < BLOCK_SIZE2; i++)
    tmp[i] = paddingByte;
  return tmp32;
}
var cbc = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 16 }, function aescbc(key, iv, opts = {}) {
  const pkcs5 = !opts.disablePadding;
  return {
    encrypt(plaintext2, dst) {
      const outLen = validateBlockEncrypt(plaintext2, pkcs5, dst);
      const xk = expandKeyLE(key);
      const { b: input, o, out: _out } = prepareBlockEncrypt(plaintext2, outLen, dst);
      const b = u32(input);
      swap32IfBE(b);
      let _iv = iv;
      const toClean = [xk];
      if (!isLE || !isAligned32(_iv))
        toClean.push(_iv = copyBytes(_iv));
      const n32 = u32(_iv);
      swap32IfBE(n32);
      let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
      let i = 0;
      for (; i + 4 <= b.length; ) {
        s0 ^= b[i + 0], s1 ^= b[i + 1], s2 ^= b[i + 2], s3 ^= b[i + 3];
        ({ s0, s1, s2, s3 } = encrypt(xk, s0, s1, s2, s3));
        o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
      }
      if (pkcs5) {
        const tmp32 = padPCKS(plaintext2.subarray(i * 4));
        swap32IfBE(tmp32);
        s0 ^= tmp32[0], s1 ^= tmp32[1], s2 ^= tmp32[2], s3 ^= tmp32[3];
        ({ s0, s1, s2, s3 } = encrypt(xk, s0, s1, s2, s3));
        o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
        clean(tmp32);
      }
      swap32IfBE(o);
      clean(...toClean);
      if (input !== plaintext2)
        clean(input);
      return _out;
    },
    decrypt(ciphertext, dst) {
      validateBlockDecrypt(ciphertext, dst);
      const xk = expandKeyDecLE(key);
      if (dst === void 0)
        dst = new Uint8Array(ciphertext.length);
      let _iv = iv;
      const toClean = [xk];
      if (!isLE || !isAligned32(_iv))
        toClean.push(_iv = copyBytes(_iv));
      const n32 = u32(_iv);
      swap32IfBE(n32);
      if (!isLE || !isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes(ciphertext));
      const b = u32(ciphertext);
      const o = u32(dst);
      swap32IfBE(b);
      let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
      for (let i = 0; i + 4 <= b.length; ) {
        const ps0 = s0, ps1 = s1, ps2 = s2, ps3 = s3;
        s0 = b[i + 0], s1 = b[i + 1], s2 = b[i + 2], s3 = b[i + 3];
        const { s0: o0, s1: o1, s2: o2, s3: o3 } = decrypt(xk, s0, s1, s2, s3);
        o[i++] = o0 ^ ps0, o[i++] = o1 ^ ps1, o[i++] = o2 ^ ps2, o[i++] = o3 ^ ps3;
      }
      swap32IfBE(o);
      clean(...toClean);
      return validatePKCS(dst, pkcs5);
    }
  };
});
function computeTag(fn, isLE2, key, data, AAD) {
  const aadLength = AAD ? AAD.length : 0;
  const h = fn.create(key, data.length + aadLength);
  if (AAD)
    h.update(AAD);
  const num = u64Lengths(8 * data.length, 8 * aadLength, isLE2);
  h.update(data);
  h.update(num);
  const res = h.digest();
  clean(num);
  return res;
}
var gcm = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 12, tagLength: 16, withAAD: true, varSizeNonce: true }, function aesgcm(key, nonce, AAD) {
  if (nonce.length < 8)
    throw new Error("aes/gcm: invalid nonce length");
  const tagLength = 16;
  function _computeTag(authKey, tagMask, data) {
    const tag = computeTag(ghash, false, authKey, data, AAD);
    for (let i = 0; i < tagMask.length; i++)
      tag[i] ^= tagMask[i];
    return tag;
  }
  function deriveKeys() {
    const xk = expandKeyLE(key);
    const authKey = EMPTY_BLOCK.slice();
    const counter = EMPTY_BLOCK.slice();
    ctr32(xk, false, counter, counter, authKey);
    if (nonce.length === 12) {
      counter.set(nonce);
    } else {
      const nonceLen = EMPTY_BLOCK.slice();
      const view = createView(nonceLen);
      view.setBigUint64(8, BigInt(nonce.length * 8), false);
      const g = ghash.create(authKey).update(nonce).update(nonceLen);
      g.digestInto(counter);
      g.destroy();
    }
    const tagMask = ctr32(xk, false, counter, EMPTY_BLOCK);
    return { xk, authKey, counter, tagMask };
  }
  return {
    encrypt(plaintext2) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const out = new Uint8Array(plaintext2.length + tagLength);
      const toClean = [xk, authKey, counter, tagMask];
      if (!isAligned32(plaintext2))
        toClean.push(plaintext2 = copyBytes(plaintext2));
      ctr32(xk, false, counter, plaintext2, out.subarray(0, plaintext2.length));
      const tag = _computeTag(authKey, tagMask, out.subarray(0, out.length - tagLength));
      toClean.push(tag);
      out.set(tag, plaintext2.length);
      clean(...toClean);
      return out;
    },
    decrypt(ciphertext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const toClean = [xk, authKey, tagMask, counter];
      if (!isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes(ciphertext));
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = _computeTag(authKey, tagMask, data);
      toClean.push(tag);
      if (!equalBytes(tag, passedTag)) {
        clean(...toClean);
        throw new Error("aes-gcm: invalid tag");
      }
      const out = ctr32(xk, false, counter, data);
      clean(...toClean);
      return out;
    }
  };
});

// lib/player-crypto.js
function utf8(value) {
  return Uint8Array.from(encodeURIComponent(value).match(/%[0-9a-f]{2}|[^%]/gi) ?? [], (c) => c[0] === "%" ? parseInt(c.slice(1), 16) : c.charCodeAt(0));
}
function plaintext(bytes) {
  try {
    return decodeURIComponent([...bytes].map((b) => "%" + b.toString(16).padStart(2, "0")).join(""));
  } catch {
    throw Error("Player returned invalid UTF-8 data.");
  }
}
function hex(value) {
  if (typeof value !== "string" || value.length > 262144 || value.length % 2 || !/^[0-9a-f]*$/i.test(value)) throw Error("Invalid player ciphertext.");
  return Uint8Array.from(value.match(/../g) ?? [], (v) => parseInt(v, 16));
}
function decryptCbcHex(value, key, iv) {
  return plaintext(cbc(utf8(key), utf8(iv)).decrypt(hex(value)));
}
function decryptByse(playback) {
  const parts = playback?.key_parts;
  if (!Array.isArray(parts) || parts.length > 64 || parts.some((p) => typeof p !== "string")) throw Error("Player key data is missing.");
  const first = Number(playback.version), second = 31 - first;
  const chosen = Number.isInteger(first) && first >= 1 && first <= 20 && first <= parts.length && second > 0 && second <= parts.length ? [parts[first - 1], parts[second - 1]] : parts;
  const arrays = chosen.map(decodeBase64Bytes), key = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    key.set(a, at);
    at += a.length;
  }
  return plaintext(gcm(key, decodeBase64Bytes(playback.iv)).decrypt(decodeBase64Bytes(playback.payload)));
}

// lib/packed-data.js
function unpackData(html) {
  const quoted = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;
  const re = new RegExp(
    "\\}\\s*\\(\\s*" + quoted + "\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*" + quoted + `\\.split\\(["']\\|["']\\)`,
    "g"
  );
  const results = [];
  for (const m of html.matchAll(re)) {
    const radix = Number(m[2]), count = Number(m[3]);
    if (radix < 2 || radix > 62 || count > 1e4)
      throw Error("Packed source data exceeds its limit.");
    const payload = literal(m[1]), table = literal(m[4]).split("|"), alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let size = 0;
    const decoded = payload.replace(/\b[0-9a-zA-Z]+\b/g, (word) => {
      let n = 0;
      for (const c of word) {
        const digit = alphabet.indexOf(c);
        if (digit < 0 || digit >= radix) return word;
        n = n * radix + digit;
        if (n >= count) return word;
      }
      const value = table[n] || word;
      size += value.length;
      if (size > 1024 * 1024)
        throw Error("Unpacked source data exceeds its limit.");
      return value;
    });
    results.push(decoded);
    if (results.length > 10) throw Error("Too many packed source blocks.");
  }
  return results.join("\n");
}

// lib/rsc-data.js
function jsonArray(data, key) {
  const match = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(data);
  if (!match) throw Error("Reader page data is missing.");
  const start = match.index + match[0].length - 1;
  let depth = 0, quoted = false, escape = false;
  for (let i = start; i < data.length; i++) {
    const c = data[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) {
      try {
        return JSON.parse(data.slice(start, i + 1));
      } catch {
        break;
      }
    }
  }
  throw Error("Invalid reader page array.");
}

// lib/anime-embed.js
function frames(html) {
  return [...html.matchAll(/<iframe\b([^>]*)>/gi)].map((m) => attrs(m[1]).src).filter(Boolean);
}
async function extractPlayer(start, read, { origin, hosts, server, headers = {}, typeHint } = {}) {
  let current = start;
  const visited = /* @__PURE__ */ new Set();
  for (let depth = 0; depth < 4; depth++) {
    const target = url(current, origin);
    if (!target || !hosts.includes(target.host) || visited.has(target.value)) throw Error("Unapproved or repeated anime player URL.");
    visited.add(target.value);
    const raw = (await read(target.value)).replace(/<!--[\s\S]*?-->/g, ""), html = raw + "\n" + unpackData(raw), videos = [];
    if (target.host === "www.blogger.com") {
      const decoded = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      for (const m of decoded.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
        let value;
        try {
          value = literal(m[0]);
        } catch {
          continue;
        }
        if (!value.includes('"formats":')) continue;
        let formats;
        try {
          formats = jsonArray(value, "formats");
        } catch {
          continue;
        }
        for (const format of formats) {
          if (typeof format.url !== "string" || !/^video\/mp4(?:;|$)/i.test(format.mimeType ?? "")) continue;
          const p = url(format.url, origin);
          if (!p?.host.endsWith(".googlevideo.com") || !p.path.startsWith("/videoplayback?")) continue;
          videos.push(rendition(format.url, origin, { type: "mp4", quality: format.qualityLabel ?? format.quality ?? "auto", headers: { Referer: target.value } }));
        }
      }
    }
    const literals = [...html.matchAll(/(?:\b(?:file|src)|["'](?:file|src)["'])\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g), ...html.matchAll(/\b(?:var|let|const)\s+primary\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)];
    for (const match of literals) {
      const raw2 = literal(match[1]);
      let type;
      try {
        const inner = /[?&]src=([^&]+)/.exec(raw2);
        if (inner && /\.m3u8(?:[?#]|$)/i.test(decodeURIComponent(inner[1]))) type = "hls";
      } catch {
      }
      try {
        videos.push(rendition(raw2, origin, { headers: { Referer: target.value, ...headers }, type: type ?? typeHint }));
      } catch {
      }
    }
    for (const match of html.matchAll(/<source\b([^>]*)>/gi)) {
      const a = attrs(match[1]);
      if (a.src) try {
        videos.push(rendition(a.src, origin, { headers: { Referer: target.value, ...headers } }));
      } catch {
      }
    }
    if (videos.length) return result(server, [...new Map(videos.map((v) => [v.url, v])).values()], { Referer: target.value, ...headers });
    const next = frames(html).find((raw2) => hosts.includes(url(raw2, origin)?.host));
    if (!next) throw Error("Anime player did not expose supported media data.");
    current = next;
  }
  throw Error("Anime player exceeded its nesting limit.");
}

// extensions/animeav1/src/source.js
var ORIGIN = "https://animeav1.com";
function voe(html) {
  const raw = /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (!raw) throw Error("Voe player data is missing.");
  const data = JSON.parse(raw), encoded = Array.isArray(data) ? data[0] : data;
  if (typeof encoded !== "string") throw Error("Invalid Voe player data.");
  let rotated = encoded.replace(/[a-z]/gi, (c) => String.fromCharCode((c.charCodeAt(0) - (c <= "Z" ? 65 : 97) + 13) % 26 + (c <= "Z" ? 65 : 97)));
  for (const marker of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) rotated = rotated.split(marker).join("");
  const bytes = decodeBase64Bytes(rotated);
  let reversed = "";
  for (let i = bytes.length - 1; i >= 0; i--) reversed += String.fromCharCode(bytes[i] - 3);
  return JSON.parse(decodeBase64(reversed));
}
function activate({ host }) {
  const fetch = request(host, ORIGIN), read = (path, options = {}) => fetch(path, { ...options, headers: { "User-Agent": "Mozilla/5.0", ...options.headers } });
  return {
    async search(query, options = {}) {
      const q = String(query).trim().slice(0, 500);
      if (!q) return [];
      const data = decodeSvelte(await read("/catalogo/__data.json?page=1&search=" + encodeURIComponent(q), { json: true }), (row) => row && "results" in row);
      if (!Array.isArray(data.results)) throw Error("Invalid AnimeAV1 catalogue.");
      return titles(data.results.map((row) => ({ id: identity(row.slug), title: row.title, url: ORIGIN + "/media/" + row.slug })), options.limit);
    },
    async getEpisodes(value) {
      const book = identity(value), data = decodeSvelte(await read("/media/" + book + "/__data.json", { json: true }), (row) => row && "media" in row), media = data.media;
      if (media?.slug !== book || !Array.isArray(media.episodes)) throw Error("AnimeAV1 episode inventory is missing.");
      return episodes(media.episodes.filter((e) => Number.isFinite(e.number)).map((e) => ({ id: book + "|" + e.number, number: e.number, title: e.title, url: ORIGIN + "/media/" + book + "/" + e.number })), book);
    },
    async getStreams(value, options = {}) {
      const ids = String(value).split("|");
      if (ids.length !== 2 || !/^\d+(?:\.\d+)?$/.test(ids[1])) throw Error("Invalid AnimeAV1 episode identity.");
      const [book, number] = [identity(ids[0]), ids[1]], data = decodeSvelte(await read("/media/" + book + "/" + number + "/__data.json", { json: true }), (row) => row && "embeds" in row), tasks = [];
      for (const audio of ["SUB", "DUB"]) for (const embed of data.embeds?.[audio] ?? []) {
        const name = String(embed.server ?? "").toUpperCase();
        if (!["HLS", "UPNSHARE", "BYSE", "VOE", "MP4UPLOAD"].includes(name)) continue;
        const server = embed.server + " \xB7 " + (audio === "SUB" ? "Sub" : "Dub");
        if (options.excludeServers?.includes(server)) continue;
        if (tasks.length >= 20) throw Error("AnimeAV1 returned too many mirrors.");
        tasks.push((async () => {
          let videos, headers;
          if (name === "HLS") {
            headers = { Referer: "https://player.zilla-networks.com/" };
            videos = [rendition(String(embed.url).replace("/play/", "/m3u8/"), ORIGIN, { type: "hls", headers })];
          } else if (name === "MP4UPLOAD") return extractPlayer(embed.url, read, { origin: ORIGIN, hosts: ["www.mp4upload.com"], server, headers: { Referer: "https://www.mp4upload.com/" } });
          else if (name === "UPNSHARE") {
            const [base, token] = String(embed.url).split("#"), p = url(base, ORIGIN);
            if (!p || !token) throw Error("UPNShare player identity is missing.");
            headers = { Referer: "https://" + p.host + "/" };
            const encrypted = await read("https://" + p.host + "/api/v1/video?id=" + encodeURIComponent(token), { headers }), decoded = JSON.parse(decryptCbcHex(encrypted.trim(), "kiemtienmua911ca", "1234567890oiuytr"));
            videos = [rendition(decoded.cfNative, ORIGIN, { type: "hls", headers })];
          } else if (name === "BYSE") {
            const p = url(embed.url, ORIGIN), id = /^\/[a-z]\/([a-z0-9]+)/i.exec(p?.path ?? "")?.[1];
            if (!p || !id) throw Error("Byse player identity is missing.");
            const data2 = await read("https://" + p.host + "/api/videos/" + id, { json: true }), decoded = JSON.parse(decryptByse(data2.playback));
            if (!Array.isArray(decoded.sources)) throw Error("Byse sources are missing.");
            videos = decoded.sources.map((s) => rendition(s.url, ORIGIN, { type: /mpegurl/i.test(s.mime_type ?? "") ? "hls" : "mp4", quality: s.label ?? (s.height ? s.height + "p" : "auto") }));
          } else if (name === "VOE") {
            let html = await read(embed.url);
            const hop = /window\.location\.href\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(html);
            if (hop && !html.includes("application/json")) html = await read(literal(hop[1]));
            const data2 = voe(html), raw = data2.source ?? data2.direct_access_url;
            videos = [rendition(raw, ORIGIN, { type: data2.source ? "hls" : "mp4" })];
          }
          return result(server, videos, headers);
        })());
      }
      const settled = await Promise.allSettled(tasks), results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
      if (!results.length) throw Error(settled.find((r) => r.status === "rejected")?.reason?.message ?? "AnimeAV1 has no supported mirror for this episode.");
      return results;
    }
  };
}
export {
  activate
};
