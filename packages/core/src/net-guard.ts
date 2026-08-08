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
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved

  return false;
}

export function isBlockedIPv6(address: string): boolean {
  // Drop any zone index: "fe80::1%eth0" is still link-local.
  const value = (address.toLowerCase().split("%")[0] ?? "").trim();

  if (value === "::" || value === "::1") return true;

  // IPv4-mapped and IPv4-compatible forms reach exactly the same places.
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (embedded?.[1] && value.startsWith("::")) return isBlockedIPv4(embedded[1]);

  const head = value.split(":")[0] ?? "";
  if (!/^[0-9a-f]{0,4}$/.test(head)) return true;

  const first = Number.parseInt(head || "0", 16);

  if ((first & 0xfe00) === 0xfc00) return true; // unique local
  if ((first & 0xffc0) === 0xfe80) return true; // link local
  if ((first & 0xff00) === 0xff00) return true; // multicast

  return false;
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
