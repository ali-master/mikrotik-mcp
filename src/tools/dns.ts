/** DNS server, static records, cache, and regexp — `/ip dns`. */
import { z } from "zod";
import { executeMikrotikCommand } from "../core/connector";
import type { ToolContext } from "../core/context";
import { WRITE_IDEMPOTENT, WRITE,  READ, DESTRUCTIVE, defineTool } from "../core/registry";
import type {ToolModule} from "../core/registry";
import { yesno, whereClause, quoteValue, looksLikeError, isEmpty, Cmd } from "../core/routeros";

interface AddDnsStaticArgs {
  name: string;
  address?: string;
  cname?: string;
  mx_preference?: number;
  mx_exchange?: string;
  text?: string;
  srv_priority?: number;
  srv_weight?: number;
  srv_port?: number;
  srv_target?: string;
  ttl?: string;
  comment?: string;
  disabled?: boolean;
  regexp?: string;
}

interface UpdateDnsStaticArgs {
  entry_id: string;
  name?: string;
  address?: string;
  cname?: string;
  mx_preference?: number;
  mx_exchange?: string;
  text?: string;
  srv_priority?: number;
  srv_weight?: number;
  srv_port?: number;
  srv_target?: string;
  ttl?: string;
  comment?: string;
  disabled?: boolean;
  regexp?: string;
}

async function addDnsStatic(a: AddDnsStaticArgs, ctx: ToolContext): Promise<string> {
  ctx.info(`Adding static DNS entry: name=${a.name}`);

  const cmd = new Cmd("/ip dns static add").set("name", a.name);
  cmd.opt("address", a.address);
  cmd.opt("cname", a.cname);
  if (a.mx_preference !== undefined && a.mx_exchange) {
    cmd.set("mx-preference", a.mx_preference).set("mx-exchange", a.mx_exchange);
  }
  cmd.opt("text", a.text);
  if (
    a.srv_priority !== undefined &&
    a.srv_weight !== undefined &&
    a.srv_port !== undefined &&
    a.srv_target
  ) {
    cmd
      .set("srv-priority", a.srv_priority)
      .set("srv-weight", a.srv_weight)
      .set("srv-port", a.srv_port)
      .set("srv-target", a.srv_target);
  }
  cmd.opt("ttl", a.ttl);
  cmd.opt("comment", a.comment);
  cmd.flag("disabled", a.disabled);
  cmd.opt("regexp", a.regexp);

  const result = await executeMikrotikCommand(cmd.build(), ctx);

  if (result.trim()) {
    if (result.includes("*") || /^\d+$/.test(result.trim())) {
      const entryId = result.trim();
      const details = await executeMikrotikCommand(
        `/ip dns static print detail where .id=${entryId}`,
        ctx,
      );
      return details.trim()
        ? `Static DNS entry added successfully:\n\n${details}`
        : `Static DNS entry added with ID: ${result}`;
    }
    return `Failed to add static DNS entry: ${result}`;
  }

  const details = await executeMikrotikCommand(
    `/ip dns static print detail where name="${a.name}"`,
    ctx,
  );
  return details.trim()
    ? `Static DNS entry added successfully:\n\n${details}`
    : "Static DNS entry addition completed but unable to verify.";
}

async function updateDnsStatic(a: UpdateDnsStaticArgs, ctx: ToolContext): Promise<string> {
  ctx.info(`Updating static DNS entry: entry_id=${a.entry_id}`);

  const updates: string[] = [];
  if (a.name) updates.push(`name=${quoteValue(a.name)}`);
  if (a.address !== undefined) updates.push(a.address === "" ? "!address" : `address=${quoteValue(a.address)}`);
  if (a.cname !== undefined) updates.push(a.cname === "" ? "!cname" : `cname=${quoteValue(a.cname)}`);
  if (a.mx_preference !== undefined) updates.push(`mx-preference=${a.mx_preference}`);
  if (a.mx_exchange !== undefined) updates.push(a.mx_exchange === "" ? "!mx-exchange" : `mx-exchange=${quoteValue(a.mx_exchange)}`);
  if (a.text !== undefined) updates.push(a.text === "" ? "!text" : `text=${quoteValue(a.text)}`);
  if (a.srv_priority !== undefined) updates.push(`srv-priority=${a.srv_priority}`);
  if (a.srv_weight !== undefined) updates.push(`srv-weight=${a.srv_weight}`);
  if (a.srv_port !== undefined) updates.push(`srv-port=${a.srv_port}`);
  if (a.srv_target !== undefined) updates.push(a.srv_target === "" ? "!srv-target" : `srv-target=${quoteValue(a.srv_target)}`);
  if (a.ttl !== undefined) updates.push(a.ttl === "" ? "!ttl" : `ttl=${quoteValue(a.ttl)}`);
  if (a.comment !== undefined) updates.push(`comment=${quoteValue(a.comment)}`);
  if (a.disabled !== undefined) updates.push(`disabled=${yesno(a.disabled)}`);
  if (a.regexp !== undefined) updates.push(a.regexp === "" ? "!regexp" : `regexp=${quoteValue(a.regexp)}`);

  if (updates.length === 0) return "No updates specified.";

  const cmd = `/ip dns static set ${a.entry_id} ${updates.join(" ")}`;
  const result = await executeMikrotikCommand(cmd, ctx);

  if (looksLikeError(result)) return `Failed to update static DNS entry: ${result}`;

  const details = await executeMikrotikCommand(
    `/ip dns static print detail where .id=${a.entry_id}`,
    ctx,
  );
  return `Static DNS entry updated successfully:\n\n${details}`;
}

export const dnsTools: ToolModule = [
  defineTool({
    name: "set_dns_servers",
    title: "Set DNS Servers",
    annotations: WRITE,
    description: "Sets DNS server configuration.",
    inputSchema: {
      servers: z.array(z.string()).describe("DNS server IP addresses"),
      allow_remote_requests: z.boolean().default(false),
      max_udp_packet_size: z.number().int().optional(),
      max_concurrent_queries: z.number().int().optional(),
      cache_size: z.number().int().optional(),
      cache_max_ttl: z.string().optional(),
      use_doh: z.boolean().default(false),
      doh_server: z.string().optional(),
      verify_doh_cert: z.boolean().default(true),
    },
    async handler(a, ctx) {
      ctx.info(`Setting DNS servers: ${a.servers.join(", ")}`);

      const cmd = new Cmd("/ip dns set")
        .set("servers", a.servers.join(","))
        .bool("allow-remote-requests", a.allow_remote_requests)
        .opt("max-udp-packet-size", a.max_udp_packet_size)
        .opt("max-concurrent-queries", a.max_concurrent_queries)
        .opt("cache-size", a.cache_size)
        .opt("cache-max-ttl", a.cache_max_ttl);

      if (a.use_doh && a.doh_server) {
        cmd.set("use-doh-server", a.doh_server).bool("verify-doh-cert", a.verify_doh_cert);
      }

      const result = await executeMikrotikCommand(cmd.build(), ctx);

      if (looksLikeError(result)) return `Failed to update DNS settings: ${result}`;

      const details = await executeMikrotikCommand("/ip dns print", ctx);
      return `DNS settings updated successfully:\n\n${details}`;
    },
  }),

  defineTool({
    name: "get_dns_settings",
    title: "DNS Settings",
    annotations: READ,
    description: "Gets current DNS configuration.",
    async handler(_a, ctx) {
      ctx.info("Getting DNS settings");
      const result = await executeMikrotikCommand("/ip dns print", ctx);
      return isEmpty(result) ? "Unable to retrieve DNS settings." : `DNS SETTINGS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "add_dns_static",
    title: "Add DNS Static Entry",
    annotations: WRITE,
    description: "Adds a static DNS entry.",
    inputSchema: {
      name: z.string(),
      address: z.string().optional(),
      cname: z.string().optional(),
      mx_preference: z.number().int().optional(),
      mx_exchange: z.string().optional(),
      text: z.string().optional(),
      srv_priority: z.number().int().optional(),
      srv_weight: z.number().int().optional(),
      srv_port: z.number().int().optional(),
      srv_target: z.string().optional(),
      ttl: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
      regexp: z.string().optional(),
    },
    handler: addDnsStatic,
  }),

  defineTool({
    name: "list_dns_static",
    title: "List DNS Static Entries",
    annotations: READ,
    description: "Lists static DNS entries.",
    inputSchema: {
      name_filter: z.string().optional(),
      address_filter: z.string().optional(),
      type_filter: z.string().optional(),
      disabled_only: z.boolean().default(false),
      regexp_only: z.boolean().default(false),
    },
    async handler(a, ctx) {
      ctx.info(`Listing static DNS entries with filters: name=${a.name_filter}`);

      const filters: string[] = [];
      if (a.name_filter) filters.push(`name~"${a.name_filter}"`);
      if (a.address_filter) filters.push(`address~"${a.address_filter}"`);
      if (a.type_filter) filters.push(`type="${a.type_filter}"`);
      if (a.disabled_only) filters.push("disabled=yes");
      if (a.regexp_only) filters.push('regexp!=""');

      const result = await executeMikrotikCommand(`/ip dns static print${whereClause(filters)}`, ctx);
      return isEmpty(result) ? "No static DNS entries found matching the criteria." : `STATIC DNS ENTRIES:\n\n${result}`;
    },
  }),

  defineTool({
    name: "get_dns_static",
    title: "Get DNS Static Entry",
    annotations: READ,
    description: "Gets details of a specific static DNS entry.",
    inputSchema: { entry_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Getting static DNS entry details: entry_id=${a.entry_id}`);
      const result = await executeMikrotikCommand(
        `/ip dns static print detail where .id=${a.entry_id}`,
        ctx,
      );
      return isEmpty(result)
        ? `Static DNS entry with ID '${a.entry_id}' not found.`
        : `STATIC DNS ENTRY DETAILS:\n\n${result}`;
    },
  }),

  defineTool({
    name: "update_dns_static",
    title: "Update DNS Static Entry",
    annotations: WRITE_IDEMPOTENT,
    description: "Updates a static DNS entry.",
    inputSchema: {
      entry_id: z.string(),
      name: z.string().optional(),
      address: z.string().optional(),
      cname: z.string().optional(),
      mx_preference: z.number().int().optional(),
      mx_exchange: z.string().optional(),
      text: z.string().optional(),
      srv_priority: z.number().int().optional(),
      srv_weight: z.number().int().optional(),
      srv_port: z.number().int().optional(),
      srv_target: z.string().optional(),
      ttl: z.string().optional(),
      comment: z.string().optional(),
      disabled: z.boolean().optional(),
      regexp: z.string().optional(),
    },
    handler: updateDnsStatic,
  }),

  defineTool({
    name: "remove_dns_static",
    title: "Remove DNS Static Entry",
    annotations: DESTRUCTIVE,
    description: "Removes a static DNS entry.",
    inputSchema: { entry_id: z.string() },
    async handler(a, ctx) {
      ctx.info(`Removing static DNS entry: entry_id=${a.entry_id}`);

      const count = await executeMikrotikCommand(
        `/ip dns static print count-only where .id=${a.entry_id}`,
        ctx,
      );
      if (count.trim() === "0") return `Static DNS entry with ID '${a.entry_id}' not found.`;

      const result = await executeMikrotikCommand(`/ip dns static remove ${a.entry_id}`, ctx);
      if (looksLikeError(result)) return `Failed to remove static DNS entry: ${result}`;

      return `Static DNS entry with ID '${a.entry_id}' removed successfully.`;
    },
  }),

  defineTool({
    name: "enable_dns_static",
    title: "Enable DNS Static Entry",
    annotations: WRITE_IDEMPOTENT,
    description: "Enables a static DNS entry.",
    inputSchema: { entry_id: z.string() },
    handler: (a, ctx) => updateDnsStatic({ entry_id: a.entry_id, disabled: false }, ctx),
  }),

  defineTool({
    name: "disable_dns_static",
    title: "Disable DNS Static Entry",
    annotations: WRITE_IDEMPOTENT,
    description: "Disables a static DNS entry.",
    inputSchema: { entry_id: z.string() },
    handler: (a, ctx) => updateDnsStatic({ entry_id: a.entry_id, disabled: true }, ctx),
  }),

  defineTool({
    name: "get_dns_cache",
    title: "DNS Cache",
    annotations: READ,
    description: "Gets the current DNS cache.",
    async handler(_a, ctx) {
      ctx.info("Getting DNS cache");
      const result = await executeMikrotikCommand("/ip dns cache print", ctx);
      return isEmpty(result) ? "DNS cache is empty." : `DNS CACHE:\n\n${result}`;
    },
  }),

  defineTool({
    name: "flush_dns_cache",
    title: "Flush DNS Cache",
    annotations: DESTRUCTIVE,
    description: "Flushes the DNS cache.",
    async handler(_a, ctx) {
      ctx.info("Flushing DNS cache");
      const result = await executeMikrotikCommand("/ip dns cache flush", ctx);
      return result.trim() ? `Flush result: ${result}` : "DNS cache flushed successfully.";
    },
  }),

  defineTool({
    name: "get_dns_cache_statistics",
    title: "DNS Cache Statistics",
    annotations: READ,
    description:
      "Gets DNS cache statistics — cache size/used/max-ttl (from `/ip dns print`) and the number of " +
      "cached entries. Works on RouterOS v6 and v7 (there is no `/ip dns cache print stats` command).",
    async handler(_a, ctx) {
      ctx.info("Getting DNS cache statistics");
      // RouterOS exposes cache stats on the DNS settings, not as a cache sub-command.
      const settings = await executeMikrotikCommand("/ip dns print", ctx);
      if (looksLikeError(settings)) return `Failed to get DNS cache statistics: ${settings}`;
      if (isEmpty(settings)) return "Unable to retrieve DNS cache statistics.";

      // Keep just the cache-related fields (cache-size, cache-used, cache-max-ttl).
      const cacheLines = settings.split("\n").filter((l) => l.toLowerCase().includes("cache"));
      const stats = cacheLines.length ? cacheLines.join("\n") : settings.trim();

      // Add the live count of cached entries.
      const count = (await executeMikrotikCommand("/ip dns cache print count-only", ctx)).trim();
      const entryLine = /^\d+$/.test(count) ? `cached-entries: ${count}\n` : "";

      return `DNS CACHE STATISTICS:\n\n${entryLine}${stats}`;
    },
  }),

  defineTool({
    name: "add_dns_regexp",
    title: "Add DNS Regexp Entry",
    annotations: WRITE,
    description: "Adds a DNS regexp entry.",
    inputSchema: {
      regexp: z.string(),
      address: z.string(),
      ttl: z.string().default("1d"),
      comment: z.string().optional(),
      disabled: z.boolean().default(false),
    },
    handler: (a, ctx) =>
      addDnsStatic(
        {
          name: "dummy",
          address: a.address,
          regexp: a.regexp,
          ttl: a.ttl,
          comment: a.comment,
          disabled: a.disabled,
        },
        ctx,
      ),
  }),

  defineTool({
    name: "test_dns_query",
    title: "Test DNS Query",
    annotations: READ,
    description: "Tests a DNS query.",
    inputSchema: {
      name: z.string(),
      server: z.string().optional(),
      type: z.string().default("A"),
    },
    async handler(a, ctx) {
      ctx.info(`Testing DNS query: name=${a.name}, type=${a.type}`);

      let cmd = `/resolve ${a.name}`;
      if (a.server) cmd += ` server=${a.server}`;
      if (a.type !== "A") cmd += ` type=${a.type}`;

      const result = await executeMikrotikCommand(cmd, ctx);
      return isEmpty(result) ? `Failed to resolve ${a.name}` : `DNS QUERY RESULT for ${a.name}:\n\n${result}`;
    },
  }),

  defineTool({
    name: "export_dns_config",
    title: "Export DNS Config",
    annotations: READ,
    description: "Exports DNS configuration to a file.",
    inputSchema: { filename: z.string().optional() },
    async handler(a, ctx) {
      ctx.info("Exporting DNS configuration");

      const filename = a.filename || "dns_config";
      const result = await executeMikrotikCommand(`/ip dns export file=${filename}`, ctx);
      return result.trim() ? `Export result: ${result}` : `DNS configuration exported to ${filename}.rsc`;
    },
  }),
];
