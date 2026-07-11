/** Shared IPv4/IPv6 address-overlap detection for the `add_*_address` guards. */
import { executeMikrotikCommand } from "../core/connector";
import { cidrContains } from "../core/firewall-audit";

type Ctx = Parameters<typeof executeMikrotikCommand>[1];

/** Two CIDRs overlap when either network contains the other. */
export function cidrsOverlap(a: string, b: string): boolean {
  return cidrContains(a, b) || cidrContains(b, a);
}

/**
 * Existing address entries under `basePath` (`/ip address` or `/ipv6 address`)
 * whose subnet overlaps `address`, one line per conflict (empty when none) — lets
 * the caller refuse a duplicate/overlapping assignment.
 */
export async function findAddressConflicts(
  basePath: string,
  address: string,
  ctx: Ctx,
): Promise<string[]> {
  const existing = await executeMikrotikCommand(`${basePath} print terse`, ctx);
  const conflicts: string[] = [];
  for (const line of existing.split("\n")) {
    const addr = line.match(/address=([^\s]+)/)?.[1];
    if (!addr) continue;
    if (cidrsOverlap(address, addr)) {
      const iface = line.match(/interface=([^\s]+)/)?.[1] ?? "?";
      conflicts.push(`${addr} on ${iface}`);
    }
  }
  return conflicts;
}
