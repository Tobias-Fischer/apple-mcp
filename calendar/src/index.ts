#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as applescript from "./applescript.js";
import * as eventkit from "./eventkit.js";

const readOnly = process.argv.includes("--read-only");
const confirmDestructive = process.argv.includes("--confirm-destructive");

const server = new McpServer({
  name: "apple-calendar",
  version: "1.0.0",
});

// --read-only: never register tools that send, create, change or delete data.
// (Previously only delete tools were hidden; see upstream issue #12.)
const WRITE_TOOLS = new Set(["create_event", "update_event", "delete_event"]);
if (process.argv.includes("--read-only")) {
  const register = server.registerTool.bind(server) as (...args: any[]) => any;
  (server as any).registerTool = (name: string, ...rest: any[]) =>
    WRITE_TOOLS.has(name) ? undefined : register(name, ...rest);
}

// ---- list_calendars ----
server.registerTool(
  "list_calendars",
  {
    description: "List all calendars in Apple Calendar",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const calendars = await eventkit.listCalendars();
      return { content: [{ type: "text", text: JSON.stringify(calendars, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- list_all_events ----
server.registerTool(
  "list_all_events",
  {
    description: "List events across ALL calendars within a date range. Use this instead of list_events when you need events from all calendars.",
    inputSchema: z.object({
      from_date: z.string().describe("Start date (e.g. '1 January 2025')"),
      to_date: z.string().describe("End date (e.g. '31 January 2025')"),
    }),
  },
  async ({ from_date, to_date }) => {
    try {
      const events = await eventkit.listAllEvents(from_date, to_date);
      return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- list_events ----
server.registerTool(
  "list_events",
  {
    description: "List events in a calendar within a date range",
    inputSchema: z.object({
      calendar: z.string().describe("Name of the calendar"),
      from_date: z.string().describe("Start date (e.g. '1 January 2025')"),
      to_date: z.string().describe("End date (e.g. '31 January 2025')"),
    }),
  },
  async ({ calendar, from_date, to_date }) => {
    try {
      const events = await eventkit.listEvents(calendar, from_date, to_date);
      return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- get_event ----
server.registerTool(
  "get_event",
  {
    description: "Get full details of an event by its summary/title",
    inputSchema: z.object({
      summary: z.string().describe("Summary/title of the event"),
      calendar: z.string().optional().describe("Calendar to search in (searches all calendars if omitted)"),
    }),
  },
  async ({ summary, calendar }) => {
    try {
      const event = await eventkit.getEvent(summary, calendar);
      return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- create_event ----
server.registerTool(
  "create_event",
  {
    description: "Create a new event in a calendar",
    inputSchema: z.object({
      calendar: z.string().describe("Name of the calendar to add the event to"),
      summary: z.string().describe("Title/summary of the event"),
      start_date: z.string().describe("Start date and time (e.g. '15 March 2025 at 2:00 PM')"),
      end_date: z.string().describe("End date and time (e.g. '15 March 2025 at 3:00 PM')"),
      location: z.string().optional().describe("Location of the event"),
      description: z.string().optional().describe("Description or notes for the event"),
      all_day: z.boolean().optional().describe("Whether this is an all-day event"),
      alert_minutes: z.union([z.number(), z.array(z.number())]).optional().describe("Minutes before event to send an alert, e.g. 30 for 30 min before, or [30, 120] for multiple alerts"),
    }),
  },
  async ({ calendar, summary, start_date, end_date, location, description, all_day, alert_minutes }) => {
    try {
      const alertMinutes = alert_minutes === undefined ? undefined
        : Array.isArray(alert_minutes) ? alert_minutes : [alert_minutes];
      const result = await applescript.createEvent(calendar, summary, start_date, end_date, {
        location,
        description,
        allDay: all_day,
        alertMinutes,
      });
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- update_event ----
server.registerTool(
  "update_event",
  {
    description: "Update an existing calendar event's details",
    inputSchema: z.object({
      summary: z.string().describe("Current summary/title of the event to update"),
      calendar: z.string().optional().describe("Calendar the event is in (searches all calendars if omitted)"),
      match_start: z.string().optional().describe("Start date and time of the event to change (e.g. '2026-11-09 10:30'), needed when several events share the same title"),
      new_summary: z.string().optional().describe("New title/summary for the event"),
      start_date: z.string().optional().describe("New start date and time (e.g. '15 March 2025 at 2:00 PM')"),
      end_date: z.string().optional().describe("New end date and time (e.g. '15 March 2025 at 3:00 PM')"),
      location: z.string().optional().describe("New location"),
      description: z.string().optional().describe("New description or notes"),
      all_day: z.boolean().optional().describe("Whether this is an all-day event"),
      alert_minutes: z.union([z.number(), z.array(z.number())]).optional().describe("Replace all alerts with these minutes-before values, e.g. 30 or [30, 120]. Pass an empty array [] to remove all alerts. Omit to leave alerts unchanged."),
    }),
  },
  async ({ summary, calendar, match_start, new_summary, start_date, end_date, location, description, all_day, alert_minutes }) => {
    try {
      const alertMinutes = alert_minutes === undefined ? undefined
        : Array.isArray(alert_minutes) ? alert_minutes : [alert_minutes];
      const result = await applescript.updateEvent(summary, calendar, {
        matchStart: match_start,
        newSummary: new_summary,
        startDate: start_date,
        endDate: end_date,
        location,
        description,
        allDay: all_day,
        alertMinutes,
      });
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

if (!readOnly) {
  // ---- delete_event ----
  server.registerTool(
    "delete_event",
    {
      description: "Delete an event by its summary/title",
      inputSchema: z.object({
        summary: z.string().describe("Summary/title of the event to delete"),
        calendar: z.string().optional().describe("Calendar the event is in (searches all calendars if omitted)"),
        match_start: z.string().optional().describe("Start date and time of the event to change (e.g. '2026-11-09 10:30'), needed when several events share the same title"),
        ...(confirmDestructive ? { confirm: z.boolean().optional().describe("Set to true to confirm this destructive action") } : {}),
      }),
    },
    async ({ summary, calendar, match_start, confirm }: { summary: string; calendar?: string; match_start?: string; confirm?: unknown }) => {
      if (confirmDestructive && !confirm) {
        return { content: [{ type: "text", text: "This will permanently delete the calendar event. Please confirm with the user, then call again with confirm: true." }] };
      }
      try {
        const result = await applescript.deleteEvent(summary, calendar, match_start);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

// ---- search_events ----
server.registerTool(
  "search_events",
  {
    description: "Search events by summary/title across calendars",
    inputSchema: z.object({
      query: z.string().describe("Text to search for in event summaries"),
      calendar: z.string().optional().describe("Calendar to search in (searches all calendars if omitted)"),
    }),
  },
  async ({ query, calendar }) => {
    try {
      const results = await eventkit.searchEvents(query, calendar);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- Start server ----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Apple Calendar MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
