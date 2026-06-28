/**
 * AAA dashboard — the MCP App view's backing tools.
 *
 * One model-facing entry tool (`manage_radius_user_manager`) renders the
 * interactive RADIUS + User Manager management view; the rest are app-only
 * helpers the view calls through the App bridge to list a section, mutate a row,
 * or read/write the singleton settings. All of them go through the shared
 * `aaa-data` layer, so the widget and the observability dashboard issue
 * identical RouterOS commands.
 */
import { z } from "zod";
import { READ, WRITE, defineTool } from "../core/registry";
import type { ToolModule } from "../core/registry";
import { uiViewUri } from "../core/ui-meta";
import {
  AAA_ENTITIES,
  addAaaEntity,
  getRadiusIncoming,
  getUmSettings,
  listAaaEntity,
  removeAaaEntity,
  resetRadiusCounters,
  setRadiusIncoming,
  setUmSettings,
  toggleAaaEntity,
  updateAaaEntity,
} from "./aaa-data";
import type { AaaList } from "./aaa-data";

const SLUGS = Object.keys(AAA_ENTITIES) as [string, ...string[]];
const AAA_UI = {
  resourceUri: uiViewUri("aaa"),
  visibility: ["model", "app"] as ("model" | "app")[],
};
const APP_ONLY = { resourceUri: uiViewUri("aaa"), visibility: ["app"] as ("model" | "app")[] };

/** The `structuredContent` payload for one section (entity list). */
function sectionView(slug: string, list: AaaList): Record<string, unknown> {
  return {
    __mikrotikView: "aaa-section",
    slug,
    available: list.available,
    rows: list.rows,
    generatedAt: new Date().toISOString(),
  };
}

function summarize(slug: string, list: AaaList): string {
  if (!list.available) return `User Manager is not installed on this device (section '${slug}').`;
  return `${slug}: ${list.rows.length} row(s).`;
}

export const aaaViewTools: ToolModule = [
  defineTool({
    name: "manage_radius_user_manager",
    title: "Manage RADIUS & User Manager (Dashboard)",
    annotations: READ,
    ui: { ...AAA_UI },
    description:
      "Opens the interactive RADIUS & User Manager management dashboard — a single view to manage" +
      " the router's RADIUS client (`/radius`) and the built-in User Manager RADIUS server" +
      " (`/user-manager`). Tabs cover RADIUS servers, User Manager users, service profiles," +
      " rate/quota limitations, NAS clients (routers), profile assignments, accounting sessions," +
      " and global/CoA settings, each with full add/edit/enable-disable/remove. `section` picks the" +
      " tab to open first. For one-off scripted changes the granular tools (add_radius_server," +
      " add_user_manager_user, …) still apply.",
    inputSchema: {
      section: z
        .enum(SLUGS)
        .optional()
        .describe("Which section/tab to open first (default 'radius')"),
    },
    async handler(a, ctx) {
      const slug = a.section ?? "radius";
      ctx.info(`Opening AAA dashboard: ${slug}`);
      const list = await listAaaEntity(ctx, slug);
      return { text: summarize(slug, list), structuredContent: sectionView(slug, list) };
    },
  }),

  defineTool({
    name: "get_aaa_section",
    title: "Get AAA Section (Dashboard)",
    annotations: READ,
    ui: { ...APP_ONLY },
    description:
      "App-only helper for the RADIUS & User Manager dashboard: returns the rows of one section" +
      " (radius, um-users, um-profiles, um-limitations, um-routers, um-user-profiles, um-sessions)" +
      " as structured records with a stable id and secrets redacted, so the view can render and" +
      " refresh its table.",
    inputSchema: { slug: z.enum(SLUGS) },
    async handler(a, ctx) {
      const list = await listAaaEntity(ctx, a.slug);
      return { text: summarize(a.slug, list), structuredContent: sectionView(a.slug, list) };
    },
  }),

  defineTool({
    name: "aaa_mutate",
    title: "Mutate AAA Row (Dashboard)",
    annotations: WRITE,
    ui: { ...APP_ONLY },
    description:
      "App-only helper for the RADIUS & User Manager dashboard: performs one create/update/remove/" +
      "toggle on a section row through the shared whitelist-guarded data layer, then returns the" +
      " refreshed section so the view can adopt it. `op` is add|update|remove|toggle; `slug` is the" +
      " section; `id` is the row's stable identifier (RouterOS .id or name); `fields` carries the" +
      " RouterOS attribute values for add/update; `enable` is the target state for toggle.",
    inputSchema: {
      op: z.enum(["add", "update", "remove", "toggle"]),
      slug: z.enum(SLUGS),
      id: z.string().optional().describe("Row stable id (.id or name) for update/remove/toggle"),
      enable: z.boolean().optional().describe("Target enabled state for op=toggle"),
      fields: z
        .record(z.string(), z.string())
        .optional()
        .describe("RouterOS attribute=value pairs for add/update"),
    },
    async handler(a, ctx) {
      const fields = a.fields ?? {};
      let result;
      if (a.op === "add") result = await addAaaEntity(ctx, a.slug, fields);
      else if (a.op === "update")
        result = a.id
          ? await updateAaaEntity(ctx, a.slug, a.id, fields)
          : { ok: false, message: "id required" };
      else if (a.op === "remove")
        result = a.id
          ? await removeAaaEntity(ctx, a.slug, a.id)
          : { ok: false, message: "id required" };
      else
        result = a.id
          ? await toggleAaaEntity(ctx, a.slug, a.id, a.enable === true)
          : { ok: false, message: "id required" };

      const list = await listAaaEntity(ctx, a.slug);
      return {
        text: `${result.ok ? "OK" : "Failed"}: ${result.message}`,
        structuredContent: { ...sectionView(a.slug, list), lastOp: result },
      };
    },
  }),

  defineTool({
    name: "get_aaa_settings",
    title: "Get AAA Settings (Dashboard)",
    annotations: READ,
    ui: { ...APP_ONLY },
    description:
      "App-only helper for the RADIUS & User Manager dashboard: returns the singleton settings —" +
      " RADIUS incoming/CoA listener (`/radius incoming`) and User Manager global settings" +
      " (`/user-manager`) — for the Settings tab.",
    async handler(_a, ctx) {
      const [radiusIncoming, um] = await Promise.all([getRadiusIncoming(ctx), getUmSettings(ctx)]);
      return {
        text: "AAA settings loaded.",
        structuredContent: {
          __mikrotikView: "aaa-settings",
          radiusIncoming,
          umAvailable: um.available,
          umSettings: um.settings,
        },
      };
    },
  }),

  defineTool({
    name: "set_aaa_settings",
    title: "Set AAA Settings (Dashboard)",
    annotations: WRITE,
    ui: { ...APP_ONLY },
    description:
      "App-only helper for the RADIUS & User Manager dashboard: writes a singleton setting and" +
      " returns the refreshed settings. `target` is radius-incoming (CoA accept/port), um-settings" +
      " (enabled, use-profiles, certificate, ports) or radius-reset-counters; `fields` carries the" +
      " RouterOS attribute values.",
    inputSchema: {
      target: z.enum(["radius-incoming", "um-settings", "radius-reset-counters"]),
      fields: z.record(z.string(), z.string()).optional(),
    },
    async handler(a, ctx) {
      const fields = a.fields ?? {};
      let result;
      if (a.target === "radius-incoming") result = await setRadiusIncoming(ctx, fields);
      else if (a.target === "um-settings") result = await setUmSettings(ctx, fields);
      else result = await resetRadiusCounters(ctx);

      const [radiusIncoming, um] = await Promise.all([getRadiusIncoming(ctx), getUmSettings(ctx)]);
      return {
        text: `${result.ok ? "OK" : "Failed"}: ${result.message}`,
        structuredContent: {
          __mikrotikView: "aaa-settings",
          radiusIncoming,
          umAvailable: um.available,
          umSettings: um.settings,
          lastOp: result,
        },
      };
    },
  }),
];
