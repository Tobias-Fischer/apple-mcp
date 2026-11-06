#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as applescript from "./applescript.js";

const readOnly = process.argv.includes("--read-only");
const confirmDestructive = process.argv.includes("--confirm-destructive");

const server = new McpServer({
  name: "apple-contacts",
  version: "1.0.0",
});

// --read-only: never register tools that send, create, change or delete data.
// (Previously only delete tools were hidden; see upstream issue #12.)
const WRITE_TOOLS = new Set(["update_contact", "create_contact", "delete_contact", "create_group", "add_contact_to_group", "remove_contact_from_group", "delete_group"]);
if (process.argv.includes("--read-only")) {
  const register = server.registerTool.bind(server) as (...args: any[]) => any;
  (server as any).registerTool = (name: string, ...rest: any[]) =>
    WRITE_TOOLS.has(name) ? undefined : register(name, ...rest);
}

// ---- list_groups ----
server.registerTool(
  "list_groups",
  {
    description: "List all groups in Apple Contacts",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const groups = await applescript.listGroups();
      return { content: [{ type: "text", text: JSON.stringify(groups, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- list_contacts ----
server.registerTool(
  "list_contacts",
  {
    description: "List all contacts, optionally filtered by group",
    inputSchema: z.object({
      group: z.string().optional().describe("Group name to filter contacts (lists all if omitted)"),
    }),
  },
  async ({ group }) => {
    try {
      const contacts = await applescript.listContacts(group);
      return { content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- get_contact ----
server.registerTool(
  "get_contact",
  {
    description:
      "Get full details of a contact by name (emails, phones, organization, addresses). Several cards can " +
      "share a name: then all of them are returned under 'matches'. Pass id (from search_contacts) to get one card.",
    inputSchema: z.object({
      name: z.string().describe("Full name of the contact to retrieve"),
      id: z.string().optional().describe("Contact id from search_contacts, to pick one card when several share the name"),
    }),
  },
  async ({ name, id }) => {
    try {
      const contacts = await applescript.getContacts(name, id);
      const result = contacts.length === 1
        ? contacts[0]
        : { note: `${contacts.length} contacts are named "${name}". All are listed; they may be duplicates of one person.`, matches: contacts };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- search_contacts ----
server.registerTool(
  "search_contacts",
  {
    description: "Search contacts by name",
    inputSchema: z.object({
      query: z.string().describe("Text to search for in contact names"),
    }),
  },
  async ({ query }) => {
    try {
      const results = await applescript.searchContacts(query);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- update_contact ----
server.registerTool(
  "update_contact",
  {
    description: "Update an existing contact's details. For email and phone, new entries are added (existing ones are not removed).",
    inputSchema: z.object({
      name: z.string().describe("Full name of the contact to update"),
      id: z.string().optional().describe("Contact id from search_contacts; required when several contacts share the name"),
      first_name: z.string().optional().describe("New first name"),
      last_name: z.string().optional().describe("New last name"),
      email: z.string().optional().describe("Email address to add"),
      phone: z.string().optional().describe("Phone number to add"),
      organization: z.string().optional().describe("New company or organization"),
      job_title: z.string().optional().describe("New job title"),
      note: z.string().optional().describe("New note"),
    }),
  },
  async ({ name, id, first_name, last_name, email, phone, organization, job_title, note }) => {
    try {
      const result = await applescript.updateContact(name, {
        firstName: first_name,
        lastName: last_name,
        email,
        phone,
        organization,
        jobTitle: job_title,
        note,
      }, id);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- create_contact ----
server.registerTool(
  "create_contact",
  {
    description: "Create a new contact in Apple Contacts",
    inputSchema: z.object({
      first_name: z.string().describe("First name of the contact"),
      last_name: z.string().describe("Last name of the contact"),
      email: z.string().optional().describe("Email address"),
      phone: z.string().optional().describe("Phone number"),
      organization: z.string().optional().describe("Company or organization"),
      job_title: z.string().optional().describe("Job title"),
      note: z.string().optional().describe("Note about the contact"),
    }),
  },
  async ({ first_name, last_name, email, phone, organization, job_title, note }) => {
    try {
      const result = await applescript.createContact(first_name, last_name, {
        email,
        phone,
        organization,
        jobTitle: job_title,
        note,
      });
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

if (!readOnly) {
  // ---- delete_contact ----
  server.registerTool(
    "delete_contact",
    {
      description: "Delete a contact by name",
      inputSchema: z.object({
        name: z.string().describe("Full name of the contact to delete"),
        id: z.string().optional().describe("Contact id from search_contacts; required when several contacts share the name"),
        ...(confirmDestructive ? { confirm: z.boolean().optional().describe("Set to true to confirm this destructive action") } : {}),
      }),
    },
    async ({ name, id, confirm }: { name: string; id?: string; confirm?: unknown }) => {
      if (confirmDestructive && !confirm) {
        return { content: [{ type: "text", text: "This will permanently delete the contact. Please confirm with the user, then call again with confirm: true." }] };
      }
      try {
        const result = await applescript.deleteContact(name, id);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

// ---- create_group ----
server.registerTool(
  "create_group",
  {
    description: "Create a new group in Apple Contacts",
    inputSchema: z.object({
      name: z.string().describe("Name of the group to create"),
    }),
  },
  async ({ name }) => {
    try {
      const result = await applescript.createGroup(name);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- add_contact_to_group ----
server.registerTool(
  "add_contact_to_group",
  {
    description: "Add an existing contact to a group",
    inputSchema: z.object({
      contact_name: z.string().describe("Full name of the contact"),
      id: z.string().optional().describe("Contact id from search_contacts; required when several contacts share the name"),
      group_name: z.string().describe("Name of the group to add the contact to"),
    }),
  },
  async ({ contact_name, group_name, id }) => {
    try {
      const result = await applescript.addContactToGroup(contact_name, group_name, id);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---- remove_contact_from_group ----
server.registerTool(
  "remove_contact_from_group",
  {
    description: "Remove a contact from a group",
    inputSchema: z.object({
      contact_name: z.string().describe("Full name of the contact"),
      id: z.string().optional().describe("Contact id from search_contacts; required when several contacts share the name"),
      group_name: z.string().describe("Name of the group to remove the contact from"),
    }),
  },
  async ({ contact_name, group_name, id }) => {
    try {
      const result = await applescript.removeContactFromGroup(contact_name, group_name, id);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

if (!readOnly) {
  // ---- delete_group ----
  server.registerTool(
    "delete_group",
    {
      description: "Delete a contact group",
      inputSchema: z.object({
        name: z.string().describe("Name of the group to delete"),
        ...(confirmDestructive ? { confirm: z.boolean().optional().describe("Set to true to confirm this destructive action") } : {}),
      }),
    },
    async ({ name, confirm }: { name: string; confirm?: unknown }) => {
      if (confirmDestructive && !confirm) {
        return { content: [{ type: "text", text: "This will permanently delete the contact group. Please confirm with the user, then call again with confirm: true." }] };
      }
      try {
        const result = await applescript.deleteGroup(name);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

// ---- Start server ----
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Apple Contacts MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
