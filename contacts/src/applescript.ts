import { execFile } from "node:child_process";

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

const FIELD_DELIM = "|||";
const RECORD_DELIM = "<<<>>>";

export async function listGroups(): Promise<{ name: string }[]> {
  const script = `
tell application "Contacts"
  set groupList to {}
  repeat with g in groups
    set end of groupList to name of g
  end repeat
  set AppleScript's text item delimiters to "${FIELD_DELIM}"
  return groupList as text
end tell`;
  const raw = await runAppleScript(script);
  if (!raw) return [];
  return raw.split(FIELD_DELIM).map((name) => ({ name: name.trim() }));
}

export async function createGroup(name: string): Promise<string> {
  const safeName = sanitize(name);
  const script = `
tell application "Contacts"
  make new group with properties {name:"${safeName}"}
  save
  return "Group created: ${safeName}"
end tell`;
  return runAppleScript(script);
}

export async function listContacts(group?: string): Promise<{ name: string; id: string }[]> {
  let scope: string;
  if (group) {
    const safeGroup = sanitize(group);
    scope = `people of group "${safeGroup}"`;
  } else {
    scope = "people";
  }
  const script = `
tell application "Contacts"
  set contactList to {}
  repeat with p in ${scope}
    set contactName to name of p
    set contactId to id of p
    set end of contactList to contactName & "${FIELD_DELIM}" & contactId
  end repeat
  set AppleScript's text item delimiters to "${RECORD_DELIM}"
  return contactList as text
end tell`;
  const raw = await runAppleScript(script);
  if (!raw) return [];
  return raw.split(RECORD_DELIM).map((record) => {
    const [name, id] = record.split(FIELD_DELIM).map((s) => s.trim());
    return { name, id };
  });
}

export interface ContactDetails {
  name: string;
  id: string;
  emails: string[];
  phones: string[];
  organization: string | null;
  jobTitle: string | null;
  note: string | null;
  addresses: string[];
}

/** AppleScript returns the literal text "missing value" for unset properties. */
function clean(v: string | undefined): string | null {
  const t = v?.trim();
  return t && t !== "missing value" ? t : null;
}

/**
 * All contacts with exactly this name (several cards can share a name), or
 * the single contact with the given id.
 */
export async function getContacts(name: string, id?: string): Promise<ContactDetails[]> {
  if (id) return [await getContactById(id)];
  const safeName = sanitize(name);
  const raw = await runAppleScript(`
tell application "Contacts"
  set AppleScript's text item delimiters to "${FIELD_DELIM}"
  return (id of every person whose name is "${safeName}") as text
end tell`);
  const ids = raw.split(FIELD_DELIM).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error(`Contact not found: ${name}`);
  const out: ContactDetails[] = [];
  for (const i of ids) out.push(await getContactById(i));
  return out;
}

/** Kept for compatibility: the first contact with this name. */
export async function getContact(name: string): Promise<ContactDetails> {
  return (await getContacts(name))[0];
}

export async function getContactById(id: string): Promise<ContactDetails> {
  const safeId = sanitize(id);
  const script = `
tell application "Contacts"
  try
    set p to person id "${safeId}"
  on error
    error "Contact not found with id: ${safeId}"
  end try
  set contactName to name of p
  set contactId to id of p

  set emailList to {}
  repeat with e in emails of p
    set end of emailList to value of e
  end repeat
  set AppleScript's text item delimiters to ","
  set emailStr to emailList as text

  set phoneList to {}
  repeat with ph in phones of p
    set end of phoneList to value of ph
  end repeat
  set phoneStr to phoneList as text

  set orgStr to ""
  try
    set orgStr to organization of p
  end try

  set titleStr to ""
  try
    set titleStr to job title of p
  end try

  set noteStr to ""
  try
    set noteStr to note of p
  end try

  set addrList to {}
  repeat with a in addresses of p
    set addrParts to {}
    try
      set end of addrParts to street of a
    end try
    try
      set end of addrParts to city of a
    end try
    try
      set end of addrParts to state of a
    end try
    try
      set end of addrParts to zip of a
    end try
    try
      set end of addrParts to country of a
    end try
    set AppleScript's text item delimiters to ", "
    set end of addrList to addrParts as text
  end repeat
  set AppleScript's text item delimiters to "${FIELD_DELIM}"
  set addrStr to addrList as text

  return contactName & "${RECORD_DELIM}" & contactId & "${RECORD_DELIM}" & emailStr & "${RECORD_DELIM}" & phoneStr & "${RECORD_DELIM}" & orgStr & "${RECORD_DELIM}" & titleStr & "${RECORD_DELIM}" & noteStr & "${RECORD_DELIM}" & addrStr
end tell`;
  const raw = await runAppleScript(script);
  const parts = raw.split(RECORD_DELIM);
  return {
    name: parts[0]?.trim() || "",
    id: parts[1]?.trim() || "",
    emails: parts[2] ? parts[2].split(",").map((s) => s.trim()).filter(Boolean) : [],
    phones: parts[3] ? parts[3].split(",").map((s) => s.trim()).filter(Boolean) : [],
    organization: clean(parts[4]),
    jobTitle: clean(parts[5]),
    note: clean(parts[6]),
    addresses: parts[7] ? parts[7].split(FIELD_DELIM).map((s) => s.trim()).filter(Boolean) : [],
  };
}

export async function searchContacts(query: string): Promise<{ name: string; id: string }[]> {
  const safeQuery = sanitize(query);
  const script = `
tell application "Contacts"
  set results to {}
  set matchedPeople to (every person whose name contains "${safeQuery}")
  repeat with p in matchedPeople
    set contactName to name of p
    set contactId to id of p
    set end of results to contactName & "${FIELD_DELIM}" & contactId
  end repeat
  set AppleScript's text item delimiters to "${RECORD_DELIM}"
  return results as text
end tell`;
  const raw = await runAppleScript(script);
  if (!raw) return [];
  return raw.split(RECORD_DELIM).map((record) => {
    const [name, id] = record.split(FIELD_DELIM).map((s) => s.trim());
    return { name, id };
  });
}

/**
 * AppleScript that binds exactly one person to p: by id when given,
 * otherwise by name, refusing when several cards share that name.
 */
function findPersonScript(name: string, id?: string): string {
  if (id) {
    const safeId = sanitize(id);
    return `  try
    set p to person id "${safeId}"
  on error
    error "Contact not found with id: ${safeId}"
  end try`;
  }
  const safeName = sanitize(name);
  return `  set matchedPeople to (every person whose name is "${safeName}")
  if (count of matchedPeople) is 0 then
    error "Contact not found: ${safeName}"
  end if
  if (count of matchedPeople) > 1 then
    error "" & (count of matchedPeople) & " contacts are named ${safeName}. Use search_contacts to get their ids and pass the id of the one you mean."
  end if
  set p to item 1 of matchedPeople`;
}

export async function createContact(
  firstName: string,
  lastName: string,
  options?: { email?: string; phone?: string; organization?: string; jobTitle?: string; note?: string }
): Promise<string> {
  const safeFirst = sanitize(firstName);
  const safeLast = sanitize(lastName);
  let props = `{first name:"${safeFirst}", last name:"${safeLast}"`;
  if (options?.organization) props += `, organization:"${sanitize(options.organization)}"`;
  if (options?.jobTitle) props += `, job title:"${sanitize(options.jobTitle)}"`;
  if (options?.note) props += `, note:"${sanitize(options.note)}"`;
  props += "}";

  let extras = "";
  if (options?.email) {
    const safeEmail = sanitize(options.email);
    extras += `\n  make new email at end of emails of newPerson with properties {label:"work", value:"${safeEmail}"}`;
  }
  if (options?.phone) {
    const safePhone = sanitize(options.phone);
    extras += `\n  make new phone at end of phones of newPerson with properties {label:"mobile", value:"${safePhone}"}`;
  }

  const script = `
tell application "Contacts"
  set newPerson to make new person with properties ${props}${extras}
  save
  return "Contact created: ${safeFirst} ${safeLast}"
end tell`;
  return runAppleScript(script);
}

export async function updateContact(
  name: string,
  updates: { firstName?: string; lastName?: string; email?: string; phone?: string; organization?: string; jobTitle?: string; note?: string },
  id?: string
): Promise<string> {
  const safeName = sanitize(name);
  let setStatements = "";
  if (updates.firstName) setStatements += `\n  set first name of p to "${sanitize(updates.firstName)}"`;
  if (updates.lastName) setStatements += `\n  set last name of p to "${sanitize(updates.lastName)}"`;
  if (updates.organization) setStatements += `\n  set organization of p to "${sanitize(updates.organization)}"`;
  if (updates.jobTitle) setStatements += `\n  set job title of p to "${sanitize(updates.jobTitle)}"`;
  if (updates.note) setStatements += `\n  set note of p to "${sanitize(updates.note)}"`;
  if (updates.email) {
    const safeEmail = sanitize(updates.email);
    setStatements += `\n  make new email at end of emails of p with properties {label:"work", value:"${safeEmail}"}`;
  }
  if (updates.phone) {
    const safePhone = sanitize(updates.phone);
    setStatements += `\n  make new phone at end of phones of p with properties {label:"mobile", value:"${safePhone}"}`;
  }
  const script = `
tell application "Contacts"
${findPersonScript(name, id)}${setStatements}
  save
  return "Contact updated: ${safeName}"
end tell`;
  return runAppleScript(script);
}

export async function removeContactFromGroup(contactName: string, groupName: string, id?: string): Promise<string> {
  const safeName = sanitize(contactName);
  const safeGroup = sanitize(groupName);
  const script = `
tell application "Contacts"
${findPersonScript(contactName, id)}
  set g to group "${safeGroup}"
  remove p from g
  save
  return "Removed ${safeName} from group ${safeGroup}"
end tell`;
  return runAppleScript(script);
}

export async function deleteGroup(name: string): Promise<string> {
  const safeName = sanitize(name);
  const script = `
tell application "Contacts"
  set matchedGroups to (every group whose name is "${safeName}")
  if (count of matchedGroups) is 0 then
    error "Group not found: ${safeName}"
  end if
  delete item 1 of matchedGroups
  save
  return "Group deleted: ${safeName}"
end tell`;
  return runAppleScript(script);
}

export async function deleteContact(name: string, id?: string): Promise<string> {
  const safeName = sanitize(name);
  const script = `
tell application "Contacts"
${findPersonScript(name, id)}
  delete p
  save
  return "Contact deleted: ${safeName}"
end tell`;
  return runAppleScript(script);
}

export async function addContactToGroup(contactName: string, groupName: string, id?: string): Promise<string> {
  const safeName = sanitize(contactName);
  const safeGroup = sanitize(groupName);
  const script = `
tell application "Contacts"
${findPersonScript(contactName, id)}
  set g to group "${safeGroup}"
  add p to g
  save
  return "Added ${safeName} to group ${safeGroup}"
end tell`;
  return runAppleScript(script);
}
