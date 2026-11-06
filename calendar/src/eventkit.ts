import { execFile } from "node:child_process";
import { join } from "node:path";
import { parseDate, toLocalISO, endOfRange } from "./dates.js";

const BINARY = join(__dirname, "calendar-helper");

function runHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(BINARY, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Try to parse JSON error from stdout
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

function endDateToISO(input: string): string {
  return toLocalISO(endOfRange(parseDate(input)));
}

export async function listCalendars(): Promise<{ name: string; description: string }[]> {
  const raw = await runHelper(["list-calendars"]);
  return JSON.parse(raw);
}

export async function listAllEvents(
  fromDate: string,
  toDate: string
): Promise<{ summary: string; startDate: string; endDate: string; location: string | null; calendar: string; uid: string }[]> {
  const from = dateToISO(fromDate);
  const to = endDateToISO(toDate);
  const raw = await runHelper(["list-events", "--from", from, "--to", to]);
  return JSON.parse(raw);
}

export async function listEvents(
  calendarName: string,
  fromDate: string,
  toDate: string
): Promise<{ summary: string; startDate: string; endDate: string; location: string | null; uid: string }[]> {
  const from = dateToISO(fromDate);
  const to = endDateToISO(toDate);
  const raw = await runHelper(["list-events", "--from", from, "--to", to, "--calendar", calendarName]);
  const events: { summary: string; startDate: string; endDate: string; location: string | null; calendar: string; uid: string }[] = JSON.parse(raw);
  // Strip calendar field to match original signature
  return events.map(({ calendar, ...rest }) => rest);
}

export async function getEvent(summary: string, calendarName?: string): Promise<{
  summary: string;
  startDate: string;
  endDate: string;
  location: string | null;
  description: string | null;
  url: string | null;
  uid: string;
  allDay: boolean;
}> {
  const args = ["get-event", "--title", summary];
  if (calendarName) args.push("--calendar", calendarName);
  const raw = await runHelper(args);
  return JSON.parse(raw);
}

export async function searchEvents(
  query: string,
  calendarName?: string
): Promise<{ summary: string; startDate: string; endDate: string; calendar: string; uid: string }[]> {
  const args = ["search-events", "--query", query];
  if (calendarName) args.push("--calendar", calendarName);
  const raw = await runHelper(args);
  return JSON.parse(raw);
}
