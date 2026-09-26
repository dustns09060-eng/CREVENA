import net from "node:net";

// The IP-level allow/deny check behind the SSRF-safe fetcher
// (secure-fetch.ts). This file has ZERO network code — it only classifies
// an already-resolved IP address string. Keeping it pure and dependency-free
// makes it directly unit-testable without mocking DNS or HTTP at all.
//
// Blocks (per the Phase 3A security spec): loopback, all three private
// IPv4 blocks, link-local (which is also where cloud metadata endpoints
// like 169.254.169.254 live), CGNAT, multicast, reserved/unspecified, and
// their IPv6 equivalents, plus IPv4-mapped IPv6 (unwrapped and re-checked
// against the IPv4 rules — an attacker cannot bypass the IPv4 blocklist by
// writing the same address as `::ffff:127.0.0.1`).

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

// [network, prefixLength] pairs, checked as unsigned 32-bit integers.
const IPV4_BLOCKED_RANGES: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT (shared address space)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes AWS/GCP/Azure/Vercel-style 169.254.169.254 metadata endpoint
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1 (documentation)
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmark testing
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved (includes 255.255.255.255 broadcast)
];

function isBlockedIpv4(ip: string): boolean {
  const int = ipv4ToInt(ip);
  if (int === null) return true; // unparseable — fail closed
  for (const [network, prefix] of IPV4_BLOCKED_RANGES) {
    const netInt = ipv4ToInt(network);
    if (netInt === null) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((int & mask) === (netInt & mask)) return true;
  }
  return false;
}

// Expands an IPv6 address to 8 lowercase hextets (no "::" shorthand), or
// null if unparseable. Handles a trailing embedded IPv4 tail (e.g.
// "::ffff:127.0.0.1") by converting it to two hextets first.
function expandIpv6(ip: string): string[] | null {
  let addr = ip;
  const v4TailMatch = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4TailMatch) {
    const v4Int = ipv4ToInt(v4TailMatch[1]);
    if (v4Int === null) return null;
    const hi = ((v4Int >>> 16) & 0xffff).toString(16);
    const lo = (v4Int & 0xffff).toString(16);
    addr = addr.slice(0, addr.length - v4TailMatch[1].length) + `${hi}:${lo}`;
  }

  const [head, tail] = addr.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail !== undefined ? tail.split(":").filter(Boolean) : [];

  if (tail === undefined) {
    if (headParts.length !== 8) return null;
    return headParts.map((p) => p.padStart(4, "0").toLowerCase());
  }
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const full = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  if (full.length !== 8) return null;
  return full.map((p) => p.padStart(4, "0").toLowerCase());
}

function isBlockedIpv6(ip: string): boolean {
  const hextets = expandIpv6(ip);
  if (!hextets) return true; // unparseable — fail closed

  // IPv4-mapped (::ffff:0:0/96): first 5 hextets 0000, 6th ffff — unwrap
  // and re-check the embedded IPv4 address against the IPv4 blocklist.
  const isV4Mapped = hextets.slice(0, 4).every((h) => h === "0000") && hextets[4] === "0000" && hextets[5] === "ffff";
  if (isV4Mapped) {
    const hi = parseInt(hextets[6], 16);
    const lo = parseInt(hextets[7], 16);
    const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(embedded);
  }

  const full = hextets.join("");
  if (/^0+$/.test(full)) return true; // ::  (unspecified)
  if (/^0+1$/.test(full)) return true; // ::1 (loopback)
  if (hextets[0].startsWith("fc") || hextets[0].startsWith("fd")) return true; // fc00::/7 unique local
  if (parseInt(hextets[0], 16) >= 0xfe80 && parseInt(hextets[0], 16) <= 0xfebf) return true; // fe80::/10 link-local
  if (hextets[0].startsWith("ff")) return true; // ff00::/8 multicast

  return false;
}

export function isBlockedIp(address: string): boolean {
  if (net.isIPv4(address)) return isBlockedIpv4(address);
  if (net.isIPv6(address)) return isBlockedIpv6(address);
  return true; // not a recognizable IP literal — fail closed
}

// URL-level checks that don't require any network access (scheme,
// userinfo). Applied BEFORE DNS resolution.
export function rejectUrlUpfront(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "http/https만 허용됩니다.";
  }
  if (url.username || url.password) {
    return "URL에 인증 정보(username/password)를 포함할 수 없습니다.";
  }
  return null;
}
