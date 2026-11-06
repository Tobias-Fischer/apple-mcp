import EventKit
import Foundation

// MARK: - JSON Helpers

func jsonString(_ value: String) -> String {
    let escaped = value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
        .replacingOccurrences(of: "\t", with: "\\t")
    return "\"\(escaped)\""
}

func jsonStringOrNull(_ value: String?) -> String {
    guard let v = value, !v.isEmpty else { return "null" }
    return jsonString(v)
}

func exitWithError(_ message: String) -> Never {
    let escaped = message
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
    print("{\"error\":\"\(escaped)\"}")
    exit(1)
}

// MARK: - Date Formatting

let iso8601Formatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

let displayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "EEEE, d MMMM yyyy 'at' h:mm:ss a"
    f.locale = Locale(identifier: "en_GB")
    return f
}()

func parseISO(_ string: String) -> Date? {
    // Try standard ISO 8601 first
    if let d = iso8601Formatter.date(from: string) { return d }
    // Try without timezone (local time)
    let local = DateFormatter()
    local.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    local.locale = Locale(identifier: "en_US_POSIX")
    return local.date(from: string)
}

// MARK: - EventKit Access

func requestAccess(store: EKEventStore) -> Bool {
    var granted = false
    let semaphore = DispatchSemaphore(value: 0)

    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { g, _ in
            granted = g
            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .event) { g, _ in
            granted = g
            semaphore.signal()
        }
    }
    semaphore.wait()
    return granted
}

// MARK: - Event JSON

func eventToJSON(_ event: EKEvent, includeDetails: Bool = false) -> String {
    var fields = [String]()
    fields.append("\"summary\":\(jsonString(event.title ?? ""))")
    fields.append("\"startDate\":\(jsonString(displayFormatter.string(from: event.startDate)))")
    fields.append("\"endDate\":\(jsonString(displayFormatter.string(from: event.endDate)))")
    fields.append("\"location\":\(jsonStringOrNull(event.location))")
    fields.append("\"calendar\":\(jsonString(event.calendar?.title ?? ""))")
    fields.append("\"uid\":\(jsonString(event.eventIdentifier ?? ""))")

    if includeDetails {
        fields.append("\"description\":\(jsonStringOrNull(event.notes))")
        fields.append("\"url\":\(jsonStringOrNull(event.url?.absoluteString))")
        fields.append("\"allDay\":\(event.isAllDay)")
        let alarmStrs: [String] = (event.alarms ?? []).compactMap { alarm in
            guard alarm.absoluteDate == nil else { return nil } // skip absolute-date alarms
            let offsetMinutes = Int(-alarm.relativeOffset / 60)
            return "{\"offsetMinutes\":\(offsetMinutes)}"
        }
        fields.append("\"alerts\":[\(alarmStrs.joined(separator: ","))]")
    }

    return "{\(fields.joined(separator: ","))}"
}

/// Deduplicate events by (title, startDate, endDate) tuple
func deduplicate(_ events: [EKEvent]) -> [EKEvent] {
    var seen = Set<String>()
    var result = [EKEvent]()
    for e in events {
        let key = "\(e.title ?? "")|\(e.startDate.timeIntervalSince1970)|\(e.endDate.timeIntervalSince1970)"
        if seen.insert(key).inserted {
            result.append(e)
        }
    }
    return result
}

/// Normalize smart quotes/apostrophes to ASCII for comparison
func normalizeQuotes(_ s: String) -> String {
    return s
        .replacingOccurrences(of: "\u{2018}", with: "'")  // left single
        .replacingOccurrences(of: "\u{2019}", with: "'")  // right single
        .replacingOccurrences(of: "\u{201C}", with: "\"") // left double
        .replacingOccurrences(of: "\u{201D}", with: "\"") // right double
}

// MARK: - Commands

func listCalendars(store: EKEventStore) {
    let calendars = store.calendars(for: .event)
    let items = calendars.map { cal -> String in
        let desc = cal.source?.title ?? ""
        return "{\"name\":\(jsonString(cal.title)),\"description\":\(jsonString(desc))}"
    }
    print("[\(items.joined(separator: ","))]")
}

func listEvents(store: EKEventStore, from: Date, to: Date, calendarName: String?) {
    var calendars: [EKCalendar]? = nil
    if let name = calendarName {
        let matched = store.calendars(for: .event).filter { $0.title == name }
        if matched.isEmpty {
            exitWithError("Calendar not found: \(name)")
        }
        calendars = matched
    }

    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
    let events = deduplicate(store.events(matching: predicate))

    let items = events.map { eventToJSON($0) }
    print("[\(items.joined(separator: ","))]")
}

func searchEvents(store: EKEventStore, query: String, calendarName: String?) {
    var calendars: [EKCalendar]? = nil
    if let name = calendarName {
        let matched = store.calendars(for: .event).filter { $0.title == name }
        if matched.isEmpty {
            exitWithError("Calendar not found: \(name)")
        }
        calendars = matched
    }

    // Search within a wide range: 1 year back to 2 years forward
    let from = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
    let to = Calendar.current.date(byAdding: .year, value: 2, to: Date())!
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
    let allEvents = store.events(matching: predicate)

    let queryNorm = normalizeQuotes(query.lowercased())
    let matched = deduplicate(allEvents.filter {
        normalizeQuotes(($0.title ?? "").lowercased()).contains(queryNorm)
    })

    let items = matched.map { eventToJSON($0) }
    print("[\(items.joined(separator: ","))]")
}

func getEvent(store: EKEventStore, title: String, calendarName: String?) {
    var calendars: [EKCalendar]? = nil
    if let name = calendarName {
        let matched = store.calendars(for: .event).filter { $0.title == name }
        if matched.isEmpty {
            exitWithError("Calendar not found: \(name)")
        }
        calendars = matched
    }

    // Search within a wide range
    let from = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
    let to = Calendar.current.date(byAdding: .year, value: 2, to: Date())!
    let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
    let allEvents = store.events(matching: predicate)

    let titleNorm = normalizeQuotes(title.lowercased())
    guard let event = allEvents.first(where: { normalizeQuotes(($0.title ?? "").lowercased()) == titleNorm }) else {
        exitWithError("Event not found: \(title)")
    }

    print(eventToJSON(event, includeDetails: true))
}

// MARK: - Invitations
//
// EventKit's public API exposes `attendees` read-only. Apple's own Calendar app
// uses the (private but long-stable) EKAttendee/EKCalendarItem methods below.
// When an event with attendees is saved to an Exchange/CalDAV calendar, the
// server (e.g. Exchange via exchangesyncd) sends the meeting invitations.
// Every private selector is checked with responds(to:) so a future macOS that
// drops one fails with a clear error instead of crashing.

struct InviteeSpec { let name: String?; let email: String; let optional: Bool }

func parseInvitee(_ raw: String, optional: Bool) -> InviteeSpec {
    let s = raw.trimmingCharacters(in: .whitespaces)
    if let lt = s.lastIndex(of: "<"), let gt = s.lastIndex(of: ">"), lt < gt {
        let name = s[..<lt].trimmingCharacters(in: CharacterSet(charactersIn: " \""))
        let email = String(s[s.index(after: lt)..<gt]).trimmingCharacters(in: .whitespaces)
        return InviteeSpec(name: name.isEmpty ? nil : name, email: email, optional: optional)
    }
    return InviteeSpec(name: nil, email: s, optional: optional)
}

func requireSelector(_ target: AnyObject, _ name: String) -> Selector {
    let sel = NSSelectorFromString(name)
    guard target.responds(to: sel) else {
        exitWithError("This macOS version does not support adding invitees (missing \(name)).")
    }
    return sel
}

func makeAttendee(_ spec: InviteeSpec) -> NSObject {
    guard let cls: AnyObject = NSClassFromString("EKAttendee") else {
        exitWithError("This macOS version does not support adding invitees (no EKAttendee).")
    }
    let sel = requireSelector(cls, "attendeeWithName:emailAddress:")
    guard let att = cls.perform(sel, with: spec.name ?? spec.email, with: spec.email)?.takeUnretainedValue() as? NSObject else {
        exitWithError("Could not create invitee for \(spec.email)")
    }
    // EKParticipantRole: 1 = required, 2 = optional
    att.setValue(spec.optional ? 2 : 1, forKey: "participantRole")
    return att
}

/// Adds invitees; makes the current user the organizer if the event is not yet a meeting.
func addInvitees(_ event: EKEvent, _ specs: [InviteeSpec]) {
    guard let cal = event.calendar else { exitWithError("Event has no calendar") }
    if cal.type != .exchange && cal.type != .calDAV {
        exitWithError("Calendar \"\(cal.title)\" (\(cal.source.title)) cannot send invitations. Use an Exchange or CalDAV calendar (e.g. the Exchange \"Calendar\").")
    }
    if event.organizer == nil {
        let sel = requireSelector(event, "addOrganizerAndSelfAttendeeForNewInvitationInCalendar:force:")
        typealias Fn = @convention(c) (AnyObject, Selector, AnyObject, Bool) -> Void
        unsafeBitCast(event.method(for: sel), to: Fn.self)(event, sel, cal, false)
    }
    let existing = Set((event.attendees ?? []).compactMap { participantEmail($0)?.lowercased() })
    let addSel = requireSelector(event, "addAttendee:")
    for spec in specs where !existing.contains(spec.email.lowercased()) {
        guard spec.email.contains("@") else { exitWithError("Not an email address: \(spec.email)") }
        event.perform(addSel, with: makeAttendee(spec))
    }
}

func participantEmail(_ p: EKParticipant) -> String? {
    if let e = (p as NSObject).value(forKey: "emailAddress") as? String, !e.isEmpty { return e }
    let u = p.url.absoluteString
    return u.hasPrefix("mailto:") ? String(u.dropFirst(7)) : nil
}

func participantsJSON(_ event: EKEvent) -> String {
    let roles = [0: "unknown", 1: "required", 2: "optional", 3: "chair", 4: "non-participant"]
    let statuses = [0: "unknown", 1: "pending", 2: "accepted", 3: "declined", 4: "tentative", 5: "delegated", 6: "completed", 7: "in-process"]
    let atts = (event.attendees ?? []).map { a in
        "{\"name\":\(jsonStringOrNull(a.name)),\"email\":\(jsonStringOrNull(participantEmail(a))),\"role\":\(jsonString(roles[a.participantRole.rawValue] ?? "unknown")),\"status\":\(jsonString(statuses[a.participantStatus.rawValue] ?? "unknown")),\"isMe\":\(a.isCurrentUser)}"
    }
    let org = event.organizer.map { "{\"name\":\(jsonStringOrNull($0.name)),\"email\":\(jsonStringOrNull(participantEmail($0)))}" } ?? "null"
    return "\"organizer\":\(org),\"attendees\":[\(atts.joined(separator: ","))]"
}

func findCalendar(store: EKEventStore, name: String, account: String?) -> EKCalendar {
    let matches = store.calendars(for: .event).filter {
        $0.title == name && (account == nil || $0.source.title.caseInsensitiveCompare(account!) == .orderedSame)
    }
    if matches.isEmpty { exitWithError("Calendar not found: \(name)\(account.map { " in account \($0)" } ?? "")") }
    if matches.count > 1 {
        exitWithError("Several calendars are named \"\(name)\" (accounts: \(matches.map { $0.source.title }.joined(separator: ", "))). Specify the account.")
    }
    return matches[0]
}

func saveOrDryRun(store: EKEventStore, event: EKEvent, span: EKSpan, dryRun: Bool, verb: String) {
    if !dryRun {
        do { try store.save(event, span: span, commit: true) }
        catch { exitWithError("Could not save event: \(error.localizedDescription)") }
    }
    let base = eventToJSON(event, includeDetails: true)
    let invited = (event.attendees ?? []).filter { !$0.isCurrentUser }.count
    let note = dryRun ? "Dry run: nothing was saved and no invitations were sent."
        : invited > 0 ? "\(verb). The server sends invitations to \(invited) invitee(s) when the calendar syncs."
        : "\(verb)."
    print("{" + base.dropFirst().dropLast() + ",\(participantsJSON(event)),\"dryRun\":\(dryRun),\"note\":\(jsonString(note))}")
}

func createEvent(store: EKEventStore, args: [String], getArg: (String) -> String?, getAll: (String) -> [String]) {
    guard let calName = getArg("--calendar"), let title = getArg("--title"),
          let startStr = getArg("--start"), let endStr = getArg("--end") else {
        exitWithError("create-event requires --calendar, --title, --start and --end")
    }
    guard let start = parseISO(startStr) else { exitWithError("Invalid --start: \(startStr)") }
    guard let end = parseISO(endStr) else { exitWithError("Invalid --end: \(endStr)") }
    guard end > start else { exitWithError("--end must be after --start") }
    let cal = findCalendar(store: store, name: calName, account: getArg("--account"))
    guard cal.allowsContentModifications else { exitWithError("Calendar \"\(cal.title)\" is read-only") }

    let event = EKEvent(eventStore: store)
    event.calendar = cal
    event.title = title
    event.startDate = start
    event.endDate = end
    event.isAllDay = args.contains("--all-day")
    if let loc = getArg("--location") { event.location = loc }
    if let notes = getArg("--notes") { event.notes = notes }
    for m in getAll("--alert-minutes").compactMap({ Double($0) }) { event.addAlarm(EKAlarm(relativeOffset: -m * 60)) }

    let specs = getAll("--attendee").map { parseInvitee($0, optional: false) }
        + getAll("--optional-attendee").map { parseInvitee($0, optional: true) }
    if !specs.isEmpty { addInvitees(event, specs) }
    saveOrDryRun(store: store, event: event, span: .thisEvent, dryRun: args.contains("--dry-run"),
                 verb: specs.isEmpty ? "Event created" : "Meeting created")
}

func addAttendees(store: EKEventStore, args: [String], getArg: (String) -> String?, getAll: (String) -> [String]) {
    guard let id = getArg("--id") else { exitWithError("add-attendees requires --id (the event uid)") }
    guard var event = store.event(withIdentifier: id) else { exitWithError("Event not found: \(id)") }
    var span = EKSpan.futureEvents  // whole series when starting from the first occurrence
    if let occStr = getArg("--occurrence-start") {
        guard let occ = parseISO(occStr) else { exitWithError("Invalid --occurrence-start: \(occStr)") }
        let pred = store.predicateForEvents(withStart: occ.addingTimeInterval(-60), end: occ.addingTimeInterval(60), calendars: [event.calendar])
        guard let o = store.events(matching: pred).first(where: { $0.eventIdentifier == id }) else {
            exitWithError("No occurrence of this event starts at \(occStr)")
        }
        event = o
        span = .thisEvent
    }
    if let org = event.organizer, !org.isCurrentUser {
        exitWithError("Only the organizer can invite people; this event is organised by \(org.name ?? participantEmail(org) ?? "someone else").")
    }
    let specs = getAll("--attendee").map { parseInvitee($0, optional: false) }
        + getAll("--optional-attendee").map { parseInvitee($0, optional: true) }
    guard !specs.isEmpty else { exitWithError("add-attendees requires at least one --attendee") }
    addInvitees(event, specs)
    saveOrDryRun(store: store, event: event, span: span, dryRun: args.contains("--dry-run"), verb: "Invitees added")
}

// MARK: - TCC responsibility (upstream issues #6 / #10)
//
// When an MCP host (Claude Desktop, Claude Code, ...) spawns this helper, macOS
// treats the *host app* as the "responsible process" for privacy checks. Hosts
// don't declare NSCalendarsFullAccessUsageDescription, so EventKit denies access
// immediately, no prompt is shown, and nothing appears in System Settings.
//
// Fix: re-launch ourselves with the responsibility disclaimed, so this helper is
// its own responsible process. Its embedded Info.plist (linked into __TEXT,
// __info_plist at build time) carries the usage strings, so macOS shows a normal
// "Apple MCP Calendar Helper would like to access your calendars" prompt and
// lists the helper under Privacy & Security > Calendars.

@_silgen_name("responsibility_spawnattrs_setdisclaim")
private func responsibility_spawnattrs_setdisclaim(
    _ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

private let disclaimedEnvKey = "APPLE_MCP_CALENDAR_HELPER_DISCLAIMED"

/// Re-exec with responsibility disclaimed; returns only in the child.
func becomeResponsibleProcess() {
    let env = ProcessInfo.processInfo.environment
    if env[disclaimedEnvKey] != nil { return }

    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    _ = responsibility_spawnattrs_setdisclaim(&attr, 1)

    var childEnv = env
    childEnv[disclaimedEnvKey] = "1"
    let envp: [UnsafeMutablePointer<CChar>?] = childEnv.map { strdup("\($0.key)=\($0.value)") } + [nil]
    let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
    let path = Bundle.main.executablePath ?? CommandLine.arguments[0]

    var pid: pid_t = 0
    // stdin/stdout/stderr are inherited, so the caller still gets our output.
    guard posix_spawn(&pid, path, nil, &attr, argv, envp) == 0 else { return } // fall back to in-process
    var status: Int32 = 0
    while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
    exit((status & 0x7f) == 0 ? (status >> 8) & 0xff : 1)
}

// MARK: - Main

func printUsage() -> Never {
    fputs("""
    Usage: calendar-helper <command> [options]
    Commands:
      list-calendars
      list-events --from <ISO> --to <ISO> [--calendar <name>]
      search-events --query <text> [--calendar <name>]
      get-event --title <text> [--calendar <name>]
      create-event --calendar <name> [--account <name>] --title <text> --start <ISO> --end <ISO>
                   [--location <text>] [--notes <text>] [--all-day] [--alert-minutes <n>]...
                   [--attendee "Name <email>"]... [--optional-attendee "Name <email>"]... [--dry-run]
      add-attendees --id <uid> [--occurrence-start <ISO>] --attendee "Name <email>"... [--dry-run]
    """, stderr)
    exit(1)
}

func main() {
    let args = CommandLine.arguments
    guard args.count >= 2 else { printUsage() }
    becomeResponsibleProcess()

    let store = EKEventStore()
    let status = EKEventStore.authorizationStatus(for: .event)

    if status != .authorized {
        if #available(macOS 14.0, *) {
            if status != .fullAccess {
                guard requestAccess(store: store) else {
                    exitWithError("Calendar access denied. Open System Settings > Privacy & Security > Calendars and set Apple MCP Calendar Helper to Full Access.")
                }
            }
        } else {
            guard requestAccess(store: store) else {
                exitWithError("Calendar access denied. Please grant access in System Preferences > Security & Privacy > Calendars.")
            }
        }
    }

    let command = args[1]

    func getArg(_ flag: String) -> String? {
        guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
        return args[idx + 1]
    }

    func getAll(_ flag: String) -> [String] {
        var out = [String]()
        for (i, a) in args.enumerated() where a == flag && i + 1 < args.count { out.append(args[i + 1]) }
        return out
    }

    switch command {
    case "create-event":
        createEvent(store: store, args: args, getArg: getArg, getAll: getAll)

    case "add-attendees":
        addAttendees(store: store, args: args, getArg: getArg, getAll: getAll)

    case "list-calendars":
        listCalendars(store: store)

    case "list-events":
        guard let fromStr = getArg("--from"), let toStr = getArg("--to") else {
            exitWithError("list-events requires --from and --to ISO dates")
        }
        guard let fromDate = parseISO(fromStr) else {
            exitWithError("Invalid --from date: \(fromStr)")
        }
        guard let toDate = parseISO(toStr) else {
            exitWithError("Invalid --to date: \(toStr)")
        }
        listEvents(store: store, from: fromDate, to: toDate, calendarName: getArg("--calendar"))

    case "search-events":
        guard let query = getArg("--query") else {
            exitWithError("search-events requires --query")
        }
        searchEvents(store: store, query: query, calendarName: getArg("--calendar"))

    case "get-event":
        guard let title = getArg("--title") else {
            exitWithError("get-event requires --title")
        }
        getEvent(store: store, title: title, calendarName: getArg("--calendar"))

    default:
        printUsage()
    }
}

main()
