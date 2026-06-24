/**
 * IPsec (IKEv1 + IKEv2) — `/ip ipsec`.
 *
 * Covers the full IPsec stack: profiles (phase 1), peers (endpoints), identities
 * (auth), proposals (phase 2), and policies, each with CRUD, plus monitoring
 * (active-peers, installed-sa, flush, statistics).
 */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import { WRITE_IDEMPOTENT, WRITE, READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { whereClause, looksLikeError, isEmpty, Cmd } from "../core/routeros";

export const ipsecTools: ToolModule = [
  // ── Profile (phase 1) — /ip ipsec profile ─────────────────────────────────
  defineTool({
    name: "create_ipsec_profile",
    title: "Create IPsec Profile",
    annotations: WRITE,
    description: "Creates an IPsec phase-1 profile (IKE proposal) on the MikroTik device.",
    inputSchema: {
      name: z.string().describe("Name for the new IPsec profile"),
      dh_group: z.string().default("modp2048").describe("Diffie-Hellman group, e.g. 'modp2048'"),
      enc_algorithm: z.string().optional().describe("Encryption algorithm, e.g. 'aes-256'"),
      hash_algorithm: z.string().default("sha256").describe("Hash algorithm, e.g. 'sha256'"),
      lifetime: z.string().optional().describe("Phase-1 lifetime, e.g. '1d'"),
      nat_traversal: z.boolean().optional().describe("Enable NAT-T"),
      dpd_interval: z.string().optional().describe("Dead peer detection interval, e.g. '2m'"),
      dpd_maximum_failures: z.number().int().optional().describe("DPD max failures before drop"),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPsec profile: name=${a.name}`);
      const cmd = new Cmd("/ip ipsec profile add")
        .set("name", a.name)
        .opt("dh-group", a.dh_group)
        .opt("enc-algorithm", a.enc_algorithm)
        .opt("hash-algorithm", a.hash_algorithm)
        .opt("lifetime", a.lifetime)
        .bool("nat-traversal", a.nat_traversal)
        .opt("dpd-interval", a.dpd_interval)
        .opt("dpd-maximum-failures", a.dpd_maximum_failures)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create IPsec profile: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip ipsec profile print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `IPsec profile created successfully:\n\n${details}`
        : "IPsec profile created successfully.";
    },
  }),

  defineTool({
    name: "list_ipsec_profiles",
    title: "List IPsec Profiles",
    annotations: READ,
    description: "Lists IPsec phase-1 profiles on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPsec profiles");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/ip ipsec profile print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result) ? "No IPsec profiles found." : `IPSEC PROFILES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipsec_profile",
    title: "Get IPsec Profile",
    annotations: READ,
    description: "Gets detailed information about a specific IPsec profile.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting IPsec profile details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip ipsec profile print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `IPsec profile '${a.name}' not found.`
        : `IPSEC PROFILE DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipsec_profile",
    title: "Update IPsec Profile",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing IPsec phase-1 profile's settings.",
    inputSchema: {
      name: z.string().describe("Current name of the IPsec profile to update"),
      new_name: z.string().optional(),
      dh_group: z.string().optional(),
      enc_algorithm: z.string().optional(),
      hash_algorithm: z.string().optional(),
      lifetime: z.string().optional(),
      nat_traversal: z.boolean().optional(),
      dpd_interval: z.string().optional(),
      dpd_maximum_failures: z.number().int().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating IPsec profile: name=${a.name}`);
      const base = `/ip ipsec profile set [find name="${a.name}"]`;
      const cmd = new Cmd(base)
        .opt("name", a.new_name)
        .opt("dh-group", a.dh_group)
        .opt("enc-algorithm", a.enc_algorithm)
        .opt("hash-algorithm", a.hash_algorithm)
        .opt("lifetime", a.lifetime)
        .bool("nat-traversal", a.nat_traversal)
        .opt("dpd-interval", a.dpd_interval)
        .opt("dpd-maximum-failures", a.dpd_maximum_failures)
        .build();

      if (cmd === base) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update IPsec profile: ${result}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/ip ipsec profile print detail where name="${target}"`,
        ctx,
      );
      return `IPsec profile updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_ipsec_profile",
    title: "Remove IPsec Profile",
    annotations: DESTRUCTIVE,
    description: "Removes an IPsec profile from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPsec profile: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ip ipsec profile print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `IPsec profile '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip ipsec profile remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove IPsec profile: ${result}`;
      return `IPsec profile '${a.name}' removed successfully.`;
    },
  }),

  // ── Peer (phase 1 endpoint) — /ip ipsec peer ──────────────────────────────
  defineTool({
    name: "create_ipsec_peer",
    title: "Create IPsec Peer",
    annotations: WRITE,
    description: "Creates an IPsec peer (remote endpoint) on the MikroTik device.",
    inputSchema: {
      name: z.string().describe("Name for the new IPsec peer"),
      address: z
        .string()
        .optional()
        .describe("Remote address, e.g. '203.0.113.1' or '0.0.0.0/0' for responder"),
      profile: z.string().optional().describe("Phase-1 profile name"),
      exchange_mode: z
        .enum(["main", "aggressive", "ike2"])
        .default("ike2")
        .describe("IKE exchange mode"),
      local_address: z.string().optional(),
      passive: z.boolean().optional().describe("Passive (responder only)"),
      send_initial_contact: z.boolean().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPsec peer: name=${a.name}`);
      const cmd = new Cmd("/ip ipsec peer add")
        .set("name", a.name)
        .opt("address", a.address)
        .opt("profile", a.profile)
        .opt("exchange-mode", a.exchange_mode)
        .opt("local-address", a.local_address)
        .bool("passive", a.passive)
        .bool("send-initial-contact", a.send_initial_contact)
        .opt("comment", a.comment)
        .flag("disabled", a.disabled)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create IPsec peer: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip ipsec peer print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `IPsec peer created successfully:\n\n${details}`
        : "IPsec peer created successfully.";
    },
  }),

  defineTool({
    name: "list_ipsec_peers",
    title: "List IPsec Peers",
    annotations: READ,
    description: "Lists IPsec peers on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPsec peers");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/ip ipsec peer print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result) ? "No IPsec peers found." : `IPSEC PEERS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipsec_peer",
    title: "Get IPsec Peer",
    annotations: READ,
    description: "Gets detailed information about a specific IPsec peer.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting IPsec peer details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip ipsec peer print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `IPsec peer '${a.name}' not found.`
        : `IPSEC PEER DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipsec_peer",
    title: "Update IPsec Peer",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing IPsec peer's settings.",
    inputSchema: {
      name: z.string().describe("Current name of the IPsec peer to update"),
      new_name: z.string().optional(),
      address: z.string().optional(),
      profile: z.string().optional(),
      exchange_mode: z.enum(["main", "aggressive", "ike2"]).optional(),
      local_address: z.string().optional(),
      passive: z.boolean().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating IPsec peer: name=${a.name}`);
      const base = `/ip ipsec peer set [find name="${a.name}"]`;
      const cmd = new Cmd(base)
        .opt("name", a.new_name)
        .opt("address", a.address)
        .opt("profile", a.profile)
        .opt("exchange-mode", a.exchange_mode)
        .opt("local-address", a.local_address)
        .bool("passive", a.passive)
        .opt("comment", a.comment)
        .bool("disabled", a.disabled)
        .build();

      if (cmd === base) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update IPsec peer: ${result}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/ip ipsec peer print detail where name="${target}"`,
        ctx,
      );
      return `IPsec peer updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_ipsec_peer",
    title: "Remove IPsec Peer",
    annotations: DESTRUCTIVE,
    description: "Removes an IPsec peer from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPsec peer: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ip ipsec peer print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `IPsec peer '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip ipsec peer remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove IPsec peer: ${result}`;
      return `IPsec peer '${a.name}' removed successfully.`;
    },
  }),

  // ── Identity (auth) — /ip ipsec identity ──────────────────────────────────
  defineTool({
    name: "create_ipsec_identity",
    title: "Create IPsec Identity",
    annotations: WRITE,
    description: "Creates an IPsec identity (authentication binding) for a peer.",
    inputSchema: {
      peer: z.string().describe("Peer name this identity authenticates"),
      auth_method: z
        .enum(["pre-shared-key", "rsa-signature", "digital-signature", "eap", "eap-radius"])
        .default("pre-shared-key")
        .describe("Authentication method"),
      secret: z.string().optional().describe("Pre-shared key secret"),
      my_id: z.string().optional(),
      remote_id: z.string().optional(),
      generate_policy: z.enum(["no", "port-override", "port-strict"]).optional(),
      mode_config: z.string().optional(),
      policy_template_group: z.string().optional(),
      certificate: z.string().optional(),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPsec identity: peer=${a.peer}`);
      const cmd = new Cmd("/ip ipsec identity add")
        .set("peer", a.peer)
        .opt("auth-method", a.auth_method)
        .opt("secret", a.secret)
        .opt("my-id", a.my_id)
        .opt("remote-id", a.remote_id)
        .opt("generate-policy", a.generate_policy)
        .opt("mode-config", a.mode_config)
        .opt("policy-template-group", a.policy_template_group)
        .opt("certificate", a.certificate)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create IPsec identity: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip ipsec identity print detail where peer="${a.peer}"`,
        ctx,
      );
      return details.trim()
        ? `IPsec identity created successfully:\n\n${details}`
        : "IPsec identity created successfully.";
    },
  }),

  defineTool({
    name: "list_ipsec_identities",
    title: "List IPsec Identities",
    annotations: READ,
    description: "Lists IPsec identities on the MikroTik device.",
    inputSchema: {
      peer_filter: z.string().optional().describe("Partial peer name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPsec identities");
      const filters: string[] = [];
      if (a.peer_filter) filters.push(`peer~"${a.peer_filter}"`);

      const result = await executeMikrotikCommand(
        `/ip ipsec identity print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result) ? "No IPsec identities found." : `IPSEC IDENTITIES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipsec_identity",
    title: "Remove IPsec Identity",
    annotations: DESTRUCTIVE,
    description: "Removes an IPsec identity by its internal ID (e.g. '*1').",
    inputSchema: {
      identity_id: z.string().describe("Internal .id from list output, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing IPsec identity: identity_id=${a.identity_id}`);
      const count = await executeMikrotikCommand(
        `/ip ipsec identity print count-only where .id=${a.identity_id}`,
        ctx,
      );
      if (count.trim() === "0") return `IPsec identity with ID '${a.identity_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip ipsec identity remove [find .id=${a.identity_id}]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove IPsec identity: ${result}`;
      return `IPsec identity '${a.identity_id}' removed successfully.`;
    },
  }),

  // ── Proposal (phase 2) — /ip ipsec proposal ───────────────────────────────
  defineTool({
    name: "create_ipsec_proposal",
    title: "Create IPsec Proposal",
    annotations: WRITE,
    description: "Creates an IPsec phase-2 proposal (IPsec SA parameters).",
    inputSchema: {
      name: z.string().describe("Name for the new IPsec proposal"),
      auth_algorithms: z
        .string()
        .default("sha256")
        .describe("Authentication algorithms, e.g. 'sha256'"),
      enc_algorithms: z
        .string()
        .default("aes-256-cbc")
        .describe("Encryption algorithms, e.g. 'aes-256-cbc'"),
      pfs_group: z.string().default("modp2048").describe("PFS group, e.g. 'modp2048'"),
      lifetime: z.string().optional().describe("Phase-2 lifetime, e.g. '30m'"),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPsec proposal: name=${a.name}`);
      const cmd = new Cmd("/ip ipsec proposal add")
        .set("name", a.name)
        .opt("auth-algorithms", a.auth_algorithms)
        .opt("enc-algorithms", a.enc_algorithms)
        .opt("pfs-group", a.pfs_group)
        .opt("lifetime", a.lifetime)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create IPsec proposal: ${result}`;

      const details = await executeMikrotikCommand(
        `/ip ipsec proposal print detail where name="${a.name}"`,
        ctx,
      );
      return details.trim()
        ? `IPsec proposal created successfully:\n\n${details}`
        : "IPsec proposal created successfully.";
    },
  }),

  defineTool({
    name: "list_ipsec_proposals",
    title: "List IPsec Proposals",
    annotations: READ,
    description: "Lists IPsec phase-2 proposals on the MikroTik device.",
    inputSchema: {
      name_filter: z.string().optional().describe("Partial name match"),
    },
    async handler(a, ctx) {
      ctx.info("Listing IPsec proposals");
      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);

      const result = await executeMikrotikCommand(
        `/ip ipsec proposal print${whereClause(filters)}`,
        ctx,
      );
      return isEmpty(result) ? "No IPsec proposals found." : `IPSEC PROPOSALS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipsec_proposal",
    title: "Get IPsec Proposal",
    annotations: READ,
    description: "Gets detailed information about a specific IPsec proposal.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting IPsec proposal details: name=${a.name}`);
      const result = await executeMikrotikCommand(
        `/ip ipsec proposal print detail where name="${a.name}"`,
        ctx,
      );
      return isEmpty(result)
        ? `IPsec proposal '${a.name}' not found.`
        : `IPSEC PROPOSAL DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_ipsec_proposal",
    title: "Update IPsec Proposal",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates an existing IPsec phase-2 proposal's settings.",
    inputSchema: {
      name: z.string().describe("Current name of the IPsec proposal to update"),
      new_name: z.string().optional(),
      auth_algorithms: z.string().optional(),
      enc_algorithms: z.string().optional(),
      pfs_group: z.string().optional(),
      lifetime: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Updating IPsec proposal: name=${a.name}`);
      const base = `/ip ipsec proposal set [find name="${a.name}"]`;
      const cmd = new Cmd(base)
        .opt("name", a.new_name)
        .opt("auth-algorithms", a.auth_algorithms)
        .opt("enc-algorithms", a.enc_algorithms)
        .opt("pfs-group", a.pfs_group)
        .opt("lifetime", a.lifetime)
        .build();

      if (cmd === base) return "No updates specified.";

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to update IPsec proposal: ${result}`;

      const target = a.new_name ?? a.name;
      const details = await executeMikrotikCommand(
        `/ip ipsec proposal print detail where name="${target}"`,
        ctx,
      );
      return `IPsec proposal updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "remove_ipsec_proposal",
    title: "Remove IPsec Proposal",
    annotations: DESTRUCTIVE,
    description: "Removes an IPsec proposal from the MikroTik device.",
    inputSchema: { name: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing IPsec proposal: name=${a.name}`);
      const count = await executeMikrotikCommand(
        `/ip ipsec proposal print count-only where name="${a.name}"`,
        ctx,
      );
      if (count.trim() === "0") return `IPsec proposal '${a.name}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip ipsec proposal remove [find name="${a.name}"]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove IPsec proposal: ${result}`;
      return `IPsec proposal '${a.name}' removed successfully.`;
    },
  }),

  // ── Policy — /ip ipsec policy ─────────────────────────────────────────────
  defineTool({
    name: "create_ipsec_policy",
    title: "Create IPsec Policy",
    annotations: WRITE,
    description: "Creates an IPsec policy defining which traffic is secured and how.",
    inputSchema: {
      peer: z.string().optional().describe("Peer name this policy applies to"),
      src_address: z.string().optional().describe("Source subnet, e.g. '10.0.0.0/24'"),
      dst_address: z.string().optional().describe("Destination subnet, e.g. '10.0.1.0/24'"),
      protocol: z.string().optional(),
      action: z.enum(["encrypt", "discard", "none"]).default("encrypt"),
      level: z.enum(["require", "unique", "use"]).optional(),
      proposal: z.string().optional().describe("Phase-2 proposal name"),
      tunnel: z.boolean().default(true).describe("Tunnel mode (vs transport)"),
      sa_src_address: z.string().optional(),
      sa_dst_address: z.string().optional(),
      template: z.boolean().optional().describe("Policy template (for dynamic policies)"),
      comment: z.string().optional(),
    },
    async handler(a, ctx) {
      ctx.info(`Creating IPsec policy: peer=${a.peer ?? "(none)"}`);
      const cmd = new Cmd("/ip ipsec policy add")
        .opt("peer", a.peer)
        .opt("src-address", a.src_address)
        .opt("dst-address", a.dst_address)
        .opt("protocol", a.protocol)
        .opt("action", a.action)
        .opt("level", a.level)
        .opt("proposal", a.proposal)
        .bool("tunnel", a.tunnel)
        .opt("sa-src-address", a.sa_src_address)
        .opt("sa-dst-address", a.sa_dst_address)
        .bool("template", a.template)
        .opt("comment", a.comment)
        .build();

      const result = await executeMikrotikCommand(cmd, ctx);
      if (looksLikeError(result)) return `Failed to create IPsec policy: ${result}`;

      const details = await executeMikrotikCommand("/ip ipsec policy print detail", ctx);
      return details.trim()
        ? `IPsec policy created successfully:\n\n${details}`
        : "IPsec policy created successfully.";
    },
  }),

  defineTool({
    name: "list_ipsec_policies",
    title: "List IPsec Policies",
    annotations: READ,
    description: "Lists IPsec policies on the MikroTik device.",
    async handler(_a, ctx) {
      ctx.info("Listing IPsec policies");
      const result = await executeMikrotikCommand("/ip ipsec policy print", ctx);
      return isEmpty(result) ? "No IPsec policies found." : `IPSEC POLICIES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "remove_ipsec_policy",
    title: "Remove IPsec Policy",
    annotations: DESTRUCTIVE,
    description: "Removes an IPsec policy by its internal ID (e.g. '*1').",
    inputSchema: {
      policy_id: z.string().describe("Internal .id from list output, e.g. '*1'"),
    },
    async handler(a, ctx) {
      ctx.info(`Removing IPsec policy: policy_id=${a.policy_id}`);
      const count = await executeMikrotikCommand(
        `/ip ipsec policy print count-only where .id=${a.policy_id}`,
        ctx,
      );
      if (count.trim() === "0") return `IPsec policy with ID '${a.policy_id}' not found.`;

      const result = await executeMikrotikCommand(
        `/ip ipsec policy remove [find .id=${a.policy_id}]`,
        ctx,
      );
      if (looksLikeError(result)) return `Failed to remove IPsec policy: ${result}`;
      return `IPsec policy '${a.policy_id}' removed successfully.`;
    },
  }),

  // ── Monitoring ────────────────────────────────────────────────────────────
  defineTool({
    name: "get_ipsec_active_peers",
    title: "Get IPsec Active Peers",
    annotations: READ,
    description: "Shows currently established IPsec peers (active IKE sessions).",
    async handler(_a, ctx) {
      ctx.info("Getting IPsec active peers");
      const result = await executeMikrotikCommand("/ip ipsec active-peers print", ctx);
      return isEmpty(result) ? "No active IPsec peers." : `IPSEC ACTIVE PEERS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_ipsec_installed_sa",
    title: "Get IPsec Installed SAs",
    annotations: READ,
    description: "Shows installed IPsec security associations (SAs).",
    async handler(_a, ctx) {
      ctx.info("Getting IPsec installed SAs");
      const result = await executeMikrotikCommand("/ip ipsec installed-sa print", ctx);
      return isEmpty(result) ? "No installed IPsec SAs." : `IPSEC INSTALLED SAs:\n\n${result}`;
    },
  }),

  defineTool({
    name: "flush_ipsec_installed_sa",
    title: "Flush IPsec Installed SAs",
    annotations: DESTRUCTIVE,
    description: "Flushes all installed IPsec security associations, forcing tunnels to rekey.",
    async handler(_a, ctx) {
      ctx.info("Flushing IPsec installed SAs");
      const result = await executeMikrotikCommand("/ip ipsec installed-sa flush", ctx);
      if (looksLikeError(result)) return `Failed to flush IPsec SAs: ${result}`;
      return "IPsec security associations flushed (tunnels will rekey).";
    },
  }),

  defineTool({
    name: "get_ipsec_statistics",
    title: "Get IPsec Statistics",
    annotations: READ,
    description: "Shows IPsec subsystem statistics and counters.",
    async handler(_a, ctx) {
      ctx.info("Getting IPsec statistics");
      const result = await executeMikrotikCommand("/ip ipsec statistics print", ctx);
      return isEmpty(result) ? "No IPsec statistics available." : `IPSEC STATISTICS:\n\n${result}`;
    },
  }),
];
