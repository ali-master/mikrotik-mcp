/** IP address classification helpers — pure, dependency-free. */

/** True for a dotted-decimal IPv4 address (e.g. `192.168.1.1`). */
export function isIpAddress(s: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
}

/** True for an IPv4 address with optional CIDR prefix (e.g. `10.0.0.0/24`). */
export function isIpLike(s: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d+)?$/.test(s);
}

/**
 * True for RFC1918 private ranges and link-local addresses — the ones where
 * ARP/DHCP checks are meaningful (the target is expected to be on-link).
 */
export function isPrivateIp(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4) return false;
  if (p[0] === 10) return true; // 10.0.0.0/8
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
  if (p[0] === 192 && p[1] === 168) return true; // 192.168.0.0/16
  if (p[0] === 169 && p[1] === 254) return true; // 169.254.0.0/16
  return false;
}
