import { execFile } from "node:child_process";
import { parseDate } from "./dates.js";

export function sanitize(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\n/g, "\\n");
}

export function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`AppleScript error: ${stderr || error.message}`));
        return;
      }
      resolve(stdout.trimEnd());
    });
  });
}

/**
 * Build locale-independent AppleScript that sets `varName` to the given date.
 * Day is reset to 1 first so that e.g. setting February while "current date"
 * is the 31st cannot roll over into March.
 */
export function dateToAppleScript(input: string, varName: string): string {
  const p = parseDate(input);
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `set ${varName} to current date
set day of ${varName} to 1
set year of ${varName} to ${p.year}
set month of ${varName} to ${months[p.month - 1]}
set day of ${varName} to ${p.day}
set hours of ${varName} to ${p.hours}
set minutes of ${varName} to ${p.minutes}
set seconds of ${varName} to ${p.seconds}`;
}

export async function createEvent(
  calendarName: string,
  summary: string,
  startDate: string,
  endDate: string,
  options?: { location?: string; description?: string; allDay?: boolean; alertMinutes?: number[] }
): Promise<string> {
  const safeCal = sanitize(calendarName);
  const safeSummary = sanitize(summary);

  const startDateScript = dateToAppleScript(startDate, "eventStart");
  const endDateScript = dateToAppleScript(endDate, "eventEnd");

  let extraProps = "";
  if (options?.location) extraProps += `, location:"${sanitize(options.location)}"`;
  if (options?.description) extraProps += `, description:"${sanitize(options.description)}"`;
  if (options?.allDay !== undefined) extraProps += `, allday event:${options.allDay}`;

  let alarmScript = "";
  if (options?.alertMinutes && options.alertMinutes.length > 0) {
    alarmScript = options.alertMinutes
      .map((m) => `\n  make new display alarm at end of display alarms of theEvent with properties {trigger interval:${-m}}`)
      .join("");
  }

  const script = `
tell application "Calendar"
  set theCal to calendar "${safeCal}"
  ${startDateScript}
  ${endDateScript}
  set theEvent to make new event at end of events of theCal with properties {summary:"${safeSummary}", start date:eventStart, end date:eventEnd${extraProps}}${alarmScript}
  return "Event created: ${safeSummary}"
end tell`;
  return runAppleScript(script);
}

/**
 * AppleScript that finds exactly one event and binds it to `e`.
 * Errors instead of silently picking the first one when several events share
 * the same title (upstream issue #12). `matchStart` narrows by start time.
 */
function findSingleEventScript(summary: string, calendarName?: string, matchStart?: string): string {
  const safeSummary = sanitize(summary);
  const startSetup = matchStart ? dateToAppleScript(matchStart, "matchStart") : "";
  const cond = `summary is "${safeSummary}"` + (matchStart ? " and start date is matchStart" : "");
  const collect = calendarName
    ? `set matchedEvents to (every event of calendar "${sanitize(calendarName)}" whose ${cond})`
    : `set matchedEvents to {}
  repeat with c in calendars
    set matchedEvents to matchedEvents & (every event of c whose ${cond})
  end repeat`;
  return `${startSetup}
  ${collect}
  if (count of matchedEvents) is 0 then
    error "Event not found: ${safeSummary}"
  end if
  if (count of matchedEvents) > 1 then
    error "" & (count of matchedEvents) & " events are titled \\"${safeSummary}\\". Specify the calendar and/or match_start (the event's start date and time) to pick one."
  end if
  set e to item 1 of matchedEvents`;
}

export async function updateEvent(
  summary: string,
  calendarName: string | undefined,
  updates: { matchStart?: string; newSummary?: string; startDate?: string; endDate?: string; location?: string; description?: string; allDay?: boolean; alertMinutes?: number[] }
): Promise<string> {
  const safeSummary = sanitize(summary);
  let setStatements = "";
  if (updates.newSummary) setStatements += `\n    set summary of e to "${sanitize(updates.newSummary)}"`;
  if (updates.location) setStatements += `\n    set location of e to "${sanitize(updates.location)}"`;
  if (updates.description) setStatements += `\n    set description of e to "${sanitize(updates.description)}"`;
  if (updates.allDay !== undefined) setStatements += `\n    set allday event of e to ${updates.allDay}`;

  // Alert update: only modify if alertMinutes is explicitly provided.
  // Empty array removes all alerts; non-empty replaces all alerts.
  if (updates.alertMinutes !== undefined) {
    setStatements += `\n    repeat (count of display alarms of e) times\n      delete last display alarm of e\n    end repeat`;
    for (const m of updates.alertMinutes) {
      setStatements += `\n    make new display alarm at end of display alarms of e with properties {trigger interval:${-m}}`;
    }
  }

  let dateSetup = "";
  if (updates.startDate && updates.endDate) {
    // Build both date variables first, then set in safe order.
    // Calendar enforces start < end after each individual `set`, so moving
    // an event forward would fail if we blindly set start before end.
    // Read the current end date and branch: if the new start would exceed it,
    // set end first; otherwise set start first.
    dateSetup += `\n    ${dateToAppleScript(updates.startDate, "eventStart")}`;
    dateSetup += `\n    ${dateToAppleScript(updates.endDate, "eventEnd")}`;
    dateSetup += `\n    if eventStart > end date of e then`;
    dateSetup += `\n      set end date of e to eventEnd`;
    dateSetup += `\n      set start date of e to eventStart`;
    dateSetup += `\n    else`;
    dateSetup += `\n      set start date of e to eventStart`;
    dateSetup += `\n      set end date of e to eventEnd`;
    dateSetup += `\n    end if`;
  } else if (updates.startDate) {
    dateSetup += `\n    ${dateToAppleScript(updates.startDate, "eventStart")}`;
    dateSetup += `\n    set start date of e to eventStart`;
  } else if (updates.endDate) {
    dateSetup += `\n    ${dateToAppleScript(updates.endDate, "eventEnd")}`;
    dateSetup += `\n    set end date of e to eventEnd`;
  }

  const script = `
tell application "Calendar"
  ${findSingleEventScript(summary, calendarName, updates.matchStart)}${setStatements}${dateSetup}
  return "Event updated: ${safeSummary}"
end tell`;
  return runAppleScript(script);
}

export async function deleteEvent(summary: string, calendarName?: string, matchStart?: string): Promise<string> {
  const safeSummary = sanitize(summary);
  const script = `
tell application "Calendar"
  ${findSingleEventScript(summary, calendarName, matchStart)}
  delete e
  return "Event deleted: ${safeSummary}"
end tell`;
  return runAppleScript(script);
}

