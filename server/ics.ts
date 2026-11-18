/**
 * Minimal iCalendar (.ics) parsing for TimeEdit subscription feeds.
 * Only what StudySpace needs: start, end and which room an event is in.
 * Booking text (SUMMARY/DESCRIPTION) often holds students' names, so it is
 * read only to find room numbers and never returned.
 */

export interface IcsEvent {
  start: Date;
  end: Date;
  /** LOCATION + SUMMARY + DESCRIPTION, used only to find room numbers. */
  text: string;
}

export interface RoomBooking {
  roomId: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
}

/** Joins folded lines (RFC 5545: continuation lines start with a space or tab). */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** Parses 20261118T070000Z (UTC) or 20261118T080000 (local time). */
export function parseIcsDate(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  return z ? new Date(Date.UTC(...parts)) : new Date(...parts);
}

export function parseIcs(ics: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: { start?: Date; end?: Date; text: string[] } | null = null;

  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') {
      current = { text: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.start && current.end) {
        events.push({ start: current.start, end: current.end, text: current.text.join('\n') });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1);

    if (name === 'DTSTART') current.start = parseIcsDate(value) ?? undefined;
    else if (name === 'DTEND') current.end = parseIcsDate(value) ?? undefined;
    else if (name === 'LOCATION' || name === 'SUMMARY' || name === 'DESCRIPTION') {
      current.text.push(unescapeText(value));
    }
  }
  return events;
}

/**
 * Turns events into per-room bookings. An event can name several rooms, and
 * room numbers are matched as whole tokens so "10213" doesn't match "102".
 */
export function toRoomBookings(events: IcsEvent[], roomIds: string[]): RoomBooking[] {
  const known = new Set(roomIds);
  const out: RoomBooking[] = [];
  for (const e of events) {
    const tokens = new Set(e.text.split(/[^0-9A-Za-zÅÄÖåäö]+/));
    for (const token of tokens) {
      if (known.has(token)) {
        out.push({ roomId: token, start: e.start.toISOString(), end: e.end.toISOString() });
      }
    }
  }
  return out;
}

export interface Coverage {
  from: string; // YYYY-MM-DD, first day with any event
  to: string; // YYYY-MM-DD, last day with any event
}

/**
 * All day logic uses Swedish time explicitly, so results are the same on a laptop
 * and on a hosting server that runs in UTC (like Vercel).
 */
export const TIME_ZONE = 'Europe/Stockholm';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** YYYY-MM-DD of an instant, in Swedish time. */
const dateKey = (d: Date) => dayFormat.format(d);

/** How far Swedish wall-clock time is ahead of UTC at a given instant, in ms. */
function offsetMs(d: Date): number {
  const p = Object.fromEntries(partsFormat.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant a YYYY-MM-DD day starts in Swedish time; `addDays` moves to a later day. */
export function startOfDay(key: string, addDays = 0): Date {
  const [y, m, d] = key.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d + addDays);
  // Two passes so the offset is the one in force at local midnight (DST-safe).
  const first = utcMidnight - offsetMs(new Date(utcMidnight));
  return new Date(utcMidnight - offsetMs(new Date(first)));
}

/**
 * The span of days the feed has data for, in local time. TimeEdit subscription
 * feeds cover a rolling window (e.g. this week + 4 weeks); outside it every
 * room would wrongly look free. Uses all events, not only known rooms.
 */
export function feedCoverage(events: IcsEvent[]): Coverage | null {
  if (events.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const e of events) {
    min = Math.min(min, e.start.getTime());
    max = Math.max(max, e.end.getTime() - 1); // an event ending 00:00 belongs to the day before
  }
  return { from: dateKey(new Date(min)), to: dateKey(new Date(max)) };
}

/** Combines bookings from several feeds, dropping exact duplicates (same room, start, end). */
export function mergeBookings(lists: RoomBooking[][]): RoomBooking[] {
  const seen = new Map<string, RoomBooking>();
  for (const list of lists) {
    for (const b of list) seen.set(`${b.roomId}|${b.start}|${b.end}`, b);
  }
  return [...seen.values()];
}

/** True when the day is inside at least one feed's range. */
export const isDayCovered = (dateKey: string, ranges: Coverage[]) =>
  ranges.some((r) => dateKey >= r.from && dateKey <= r.to);

/** The overall span of several ranges (for display); null if there are none. */
export function spanOf(ranges: Coverage[]): Coverage | null {
  if (ranges.length === 0) return null;
  return {
    from: ranges.reduce((m, r) => (r.from < m ? r.from : m), ranges[0].from),
    to: ranges.reduce((m, r) => (r.to > m ? r.to : m), ranges[0].to),
  };
}

/** Keeps bookings that overlap [from, to). */
export function overlapping(bookings: RoomBooking[], from: Date, to: Date): RoomBooking[] {
  const a = from.getTime();
  const b = to.getTime();
  return bookings.filter((x) => Date.parse(x.start) < b && Date.parse(x.end) > a);
}
