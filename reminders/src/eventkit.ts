import { execFile } from "node:child_process";
import { join } from "node:path";
import { parseDate, toLocalISO } from "./dates.js";

const BINARY = join(__dirname, "reminders-helper");

function runHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(BINARY, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            reject(new Error(parsed.error));
            return;
          }
        } catch {}
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function dateToISO(input: string): string {
  return toLocalISO(parseDate(input));
}

export async function listLists(): Promise<{ name: string; id: string }[]> {
  const raw = await runHelper(["list-lists"]);
  return JSON.parse(raw);
}

export async function listReminders(
  listName: string,
  includeCompleted?: boolean
): Promise<{ name: string; id: string; completed: boolean; dueDate: string | null; priority: number }[]> {
  const args = ["list-reminders", "--list", listName];
  if (includeCompleted) args.push("--include-completed");
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function getReminder(name: string | undefined, listName?: string, id?: string): Promise<{
  name: string;
  id: string;
  completed: boolean;
  dueDate: string | null;
  body: string | null;
  priority: number;
  list: string;
}> {
  const args = ["get-reminder"];
  if (id) { args.push("--id", id); } else if (name) { args.push("--name", name); }
  if (listName) args.push("--list", listName);
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function searchReminders(
  query: string,
  listName?: string
): Promise<{ name: string; id: string; list: string; completed: boolean }[]> {
  const args = ["search-reminders", "--query", query];
  if (listName) args.push("--list", listName);
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function completeReminder(name: string | undefined, listName?: string, id?: string): Promise<string> {
  const args = ["complete-reminder"];
  if (id) { args.push("--id", id); } else if (name) { args.push("--name", name); }
  if (listName) args.push("--list", listName);
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function uncompleteReminder(name: string | undefined, listName?: string, id?: string): Promise<string> {
  const args = ["uncomplete-reminder"];
  if (id) { args.push("--id", id); } else if (name) { args.push("--name", name); }
  if (listName) args.push("--list", listName);
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function createList(name: string): Promise<string> {
  const raw = await runHelper(["create-list", "--name", name]);
  return JSON.parse(raw);
}

export async function deleteList(name: string): Promise<string> {
  const raw = await runHelper(["delete-list", "--name", name]);
  return JSON.parse(raw);
}

export async function createReminder(
  name: string,
  listName: string,
  options?: { body?: string; dueDate?: string; priority?: number }
): Promise<string> {
  const args = ["create-reminder", "--name", name, "--list", listName];
  if (options?.body) args.push("--body", options.body);
  if (options?.dueDate) args.push("--due-date", dateToISO(options.dueDate));
  if (options?.priority !== undefined) args.push("--priority", String(options.priority));
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function deleteReminder(name: string | undefined, listName?: string, id?: string): Promise<string> {
  const args = ["delete-reminder"];
  if (id) { args.push("--id", id); } else if (name) { args.push("--name", name); }
  if (listName) args.push("--list", listName);
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function updateReminder(
  name: string | undefined,
  listName: string | undefined,
  updates: { newName?: string; body?: string; dueDate?: string; priority?: number },
  id?: string
): Promise<string> {
  const args = ["update-reminder"];
  if (id) { args.push("--id", id); } else if (name) { args.push("--name", name); }
  if (listName) args.push("--list", listName);
  if (updates.newName) args.push("--new-name", updates.newName);
  if (updates.body) args.push("--body", updates.body);
  if (updates.dueDate) args.push("--due-date", dateToISO(updates.dueDate));
  if (updates.priority !== undefined) args.push("--priority", String(updates.priority));
  const raw = await runHelper(args);
  return JSON.parse(raw);
}
