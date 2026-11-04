import { describe, expect, it } from "vitest";

import { isBlockedAddress } from "./net-guard";

/**
 * These decide whether a URL the user typed can reach the machine the app is
 * running on. A gap here is not a cosmetic bug, so the cases are written out
 * individually rather than generated.
 */

describe("isBlockedAddress", () => {
  it("blocks hexadecimal and expanded IPv4-mapped private addresses", () => {
    for (const address of [
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:a00:1",
      "::ffff:c0a8:101",
      "::7f00:1",
      "0:0:0:0:0:0:0:1",
    ])
      expect(isBlockedAddress(address), address).toBe(true);
    expect(isBlockedAddress("::ffff:808:808")).toBe(false);
  });
  it("rejects malformed IPv6 and transition/documentation ranges", () => {
    for (const address of [
      "garbage::1",
      "1::2::3",
      "12345::1",
      "2001:db8::1",
      "2002:7f00:1::",
      "64:ff9b::7f00:1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
    ])
      expect(isBlockedAddress(address), address).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    for (const address of [
      "1.1.1.1",
      "8.8.8.8",
      "140.82.121.4",
      "2606:4700::1111",
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("keeps IETF and documentation /24 blocks separate from public CDN addresses", () => {
    for (const address of ["192.0.0.1", "192.0.0.255", "192.0.2.1", "192.0.2.255", "::ffff:c000:1", "::ffff:c000:201"])
      expect(isBlockedAddress(address), address).toBe(true);
    for (const address of ["192.0.1.1", "192.0.3.1", "192.0.77.2", "192.0.78.24", "::ffff:c000:4d02"])
      expect(isBlockedAddress(address), address).toBe(false);
  });

  it("blocks loopback", () => {
    for (const address of ["127.0.0.1", "127.1.2.3", "::1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks private ranges", () => {
    for (const address of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "fd00::1",
      "fc00::1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows the public parts of ranges that only look private", () => {
    // 172.15 and 172.32 sit outside 172.16/12, and 100.128 outside 100.64/10.
    for (const address of [
      "172.15.0.1",
      "172.32.0.1",
      "100.128.0.1",
      "100.63.0.1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks link-local, which is where cloud metadata lives", () => {
    for (const address of ["169.254.169.254", "169.254.0.1", "fe80::1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks carrier-grade NAT", () => {
    for (const address of ["100.64.0.1", "100.127.255.255"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("blocks unspecified, multicast and reserved", () => {
    for (const address of [
      "0.0.0.0",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "ff02::1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("sees through IPv4-mapped IPv6", () => {
    // ::ffff:127.0.0.1 reaches loopback exactly as 127.0.0.1 does.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("ignores a zone index", () => {
    expect(isBlockedAddress("fe80::1%eth0")).toBe(true);
  });

  it("refuses anything it cannot read as an address", () => {
    // Octal and short forms are resolved by some stacks as loopback.
    for (const address of [
      "",
      "  ",
      "localhost",
      "127.1",
      "0x7f.0.0.1",
      "017700000001",
      "1.2.3",
      "1.2.3.4.5",
      "999.1.1.1",
      "1.2.3.-1",
    ]) {
      expect(isBlockedAddress(address), JSON.stringify(address)).toBe(true);
    }
  });
});
