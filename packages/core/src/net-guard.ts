/**
 * Which addresses a user-supplied URL is allowed to reach.
 *
 * The desktop app can reach things a browser tab cannot: the loopback
 * interface, the rest of the local network, and on a cloud host the metadata
 * service. Any feature that fetches an address the user typed — an extension
 * registry, a media server, a webhook — has to decide what is off limits, and
 * they should all decide the same way.
 *
 * Written out rather than taken from a package. The list is short, it is
 * security-relevant, and a dependency here would be one more thing that can
 * change under the app without anyone reading the diff.
 */

/** Parsed form of a dotted-quad, or null if it is not one. */
function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];

  for (const part of parts) {
    // Reject "01", "1e2", "" and anything else that is not plain digits: a
    // permissive parse is how "127.1" and "0x7f.1" slip past a check.
    if (!/^\d{1,3}$/.test(part)) return null;

    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    octets.push(value);
  }

  return octets;
}

export function isBlockedIPv4(address: string): boolean {
  const octets = ipv4Octets(address);
  // Not a valid literal: refuse rather than guess what it might mean.
  if (!octets) return true;

  const [a = 0, b = 0] = octets;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  // IANA reserves 192.0.0.0/24, not all of 192.0.0.0/16. Public CDNs
  // (including WordPress at 192.0.77.x) use the rest of that /16.
  if (a === 192 && b === 0 && octets[2] === 0) return true;
  if (a === 192 && b === 0 && octets[2] === 2) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved

  return false;
}

export function isBlockedIPv6(address: string): boolean {
  let value = (address.toLowerCase().split("%")[0] ?? "").trim();
  // Normalize dotted tails before expanding compressed groups.
  if (value.includes(".")) {
    const tail = value.slice(value.lastIndexOf(":") + 1);
    const octets = ipv4Octets(tail);
    if (!octets) return true;
    value =
      value.slice(0, -tail.length) +
      ((octets[0]! << 8) | octets[1]!).toString(16) +
      ":" +
      ((octets[2]! << 8) | octets[3]!).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  )
    return true;
  const parts = [
    ...left,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...right,
  ];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part)))
    return true;
  const words = parts.map((part) => Number.parseInt(part, 16));
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    (words[5] === 0xffff || words[5] === 0)
  ) {
    return isBlockedIPv4(
      `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`,
    );
  }
  // Only public global unicast. Reject transition/special/documentation ranges.
  return (
    (words[0]! & 0xe000) !== 0x2000 ||
    (words[0] === 0x2001 && (words[1]! < 0x0200 || words[1] === 0x0db8)) ||
    words[0] === 0x2002
  );
}

/**
 * Whether an IP literal is off limits.
 *
 * Anything unrecognised is blocked. A guard that fails open is not a guard,
 * and there is no address worth reaching that cannot be written plainly.
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.trim();
  if (value.length === 0) return true;

  if (value.includes(":")) return isBlockedIPv6(value);
  if (ipv4Octets(value)) return isBlockedIPv4(value);

  return true;
}
