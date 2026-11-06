#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as applescript from "./applescript.js";
import * as database from "./database.js";

const server = new McpServer({
  name: "apple-messages",
  version: "1.0.0",
});

// --read-only: never register tools that send, create, change or delete data.
// (Previously only delete tools were hidden; see upstream issue #12.)
const WRITE_TOOLS = new Set(["send_message"]);
if (process.argv.includes("--read-only")) {
  const register = server.registerTool.bind(server) as (...args: any[]) => any;
  (server as any).registerTool = (name: string, ...rest: any[]) =>
    WRITE_TOOLS.has(name) ? undefined : register(name, ...rest);
}

// ---- list_chats ----
server.registerTool(
  "list_chats",
  {
    description: "List recent chats with last message preview and participant info",
    inputSchema: z.object({
      limit: z.number().optional().describe("Maximum number of chats to return (default 50)"),
    }),
  },
  async ({ limit }) => {
    try {
      const chats = database.listChats(limit);
      return { content: [{ type: "text", text: JSON.stringify(chats, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- get_chat_messages ----
server.registerTool(
  "get_chat_messages",
  {
    description: "Get message history for a specific chat",
    inputSchema: z.object({
      chat_id: z.string().describe("Chat identifier (e.g. iMessage;-;+1234567890)"),
      limit: z.number().optional().describe("Maximum number of messages to return (default 100)"),
      from_date: z.string().optional().describe("Filter messages from this date (e.g. '2025-01-01' or '2025-03-15T14:00:00')"),
      to_date: z.string().optional().describe("Filter messages up to this date (e.g. '2025-12-31')"),
    }),
  },
  async ({ chat_id, limit, from_date, to_date }) => {
    try {
      const messages = database.getChatMessages(chat_id, limit, from_date, to_date);
      return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- search_messages ----
server.registerTool(
  "search_messages",
  {
    description: "Search messages by text content",
    inputSchema: z.object({
      query: z.string().describe("Text to search for in messages"),
      chat_id: z.string().optional().describe("Limit search to a specific chat"),
      limit: z.number().optional().describe("Maximum number of results (default 50)"),
    }),
  },
  async ({ query, chat_id, limit }) => {
    try {
      const results = database.searchMessages(query, chat_id, limit);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- send_message ----
server.registerTool(
  "send_message",
  {
    description: "Send an iMessage or SMS to a phone number or email address",
    inputSchema: z.object({
      to: z.string().describe("Phone number or email address of the recipient"),
      text: z.string().describe("Message text to send"),
      service: z.enum(["iMessage", "SMS"]).optional().describe("Service to use (default iMessage)"),
    }),
  },
  async ({ to, text, service }) => {
    try {
      const result = await applescript.sendMessage(to, text, service);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- get_chat_participants ----
server.registerTool(
  "get_chat_participants",
  {
    description: "Get participants of a chat",
    inputSchema: z.object({
      chat_id: z.string().describe("Chat identifier (e.g. iMessage;-;+1234567890)"),
    }),
  },
  async ({ chat_id }) => {
    try {
      const participants = database.getChatParticipants(chat_id);
      return { content: [{ type: "text", text: JSON.stringify(participants, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- Start server ----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Apple Messages MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
