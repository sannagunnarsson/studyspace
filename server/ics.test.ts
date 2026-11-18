import { describe, expect, it } from 'vitest';
import {
  feedCoverage,
  isDayCovered,
  mergeBookings,
  overlapping,
  parseIcs,
  parseIcsDate,
  spanOf,
  toRoomBookings,
} from './ics.js';

describe('several feeds', () => {
  const a = { roomId: '2040', start: '2026-11-18T07:00:00.000Z', end: '2026-11-18T08:00:00.000Z' };
  const b = { roomId: '2040', start: '2026-11-18T09:00:00.000Z', end: '2026-11-18T10:00:00.000Z' };

  it('merges bookings and drops duplicates', () => {
    expect(mergeBookings([[a, b], [b]])).toEqual([a, b]);
  });

  it('treats a day as covered if any feed covers it, and leaves gaps uncovered', () => {
    const ranges = [
      { from: '2026-11-16', to: '2026-12-18' },
      { from: '2027-01-10', to: '2027-01-15' },
    ];
    expect(isDayCovered('2026-12-18', ranges)).toBe(true);
    expect(isDayCovered('2027-01-01', ranges)).toBe(false);
    expect(isDayCovered('2027-01-12', ranges)).toBe(true);
    expect(spanOf(ranges)).toEqual({ from: '2026-11-16', to: '2027-01-15' });
    expect(spanOf([])).toBeNull();
  });
});

describe('feedCoverage', () => {
  it('spans the first to the last day with events, in local time', () => {
    expect(feedCoverage(parseIcs(FEED))).toEqual({ from: '2026-11-18', to: '2026-11-19' });
  });
  it('counts an event ending at midnight as the earlier day', () => {
    const ev = [{ start: new Date('2026-12-18T20:00:00+01:00'), end: new Date('2026-12-19T00:00:00+01:00'), text: '' }];
    expect(feedCoverage(ev)).toEqual({ from: '2026-12-18', to: '2026-12-18' });
  });
  it('is null for an empty feed', () => {
    expect(feedCoverage([])).toBeNull();
  });
});

const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART:20261118T070000Z',
  'DTEND:20261118T090000Z',
  'SUMMARY:Some Student\\, private note',
  'LOCATION:Lokal: 10131\\, Ångström',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261118T120000Z',
  'DTEND:20261118T130000Z',
  'LOCATION:10213\\, Ångström\\, 2040\\, Ång',
  ' ström',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261119T120000Z',
  'DTEND:20261119T130000Z',
  'LOCATION:99999\\, Somewhere else',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const ROOMS = ['10131', '10213', '2040', '102'];

describe('parseIcsDate', () => {
  it('parses UTC times', () => {
    expect(parseIcsDate('20261118T070000Z')!.toISOString()).toBe('2026-11-18T07:00:00.000Z');
  });
  it('parses floating times as local time', () => {
    const d = parseIcsDate('20261118T080000')!;
    expect([d.getDate(), d.getHours()]).toEqual([18, 8]);
  });
  it('returns null for junk', () => {
    expect(parseIcsDate('soon')).toBeNull();
  });
});

describe('toRoomBookings', () => {
  const bookings = toRoomBookings(parseIcs(FEED), ROOMS);

  it('finds every known room in an event, including folded lines', () => {
    expect(bookings.map((b) => b.roomId)).toEqual(['10131', '10213', '2040']);
  });

  it('does not match partial room numbers', () => {
    expect(bookings.some((b) => b.roomId === '102')).toBe(false);
  });

  it('returns only room and times, never booking text', () => {
    expect(Object.keys(bookings[0]).sort()).toEqual(['end', 'roomId', 'start']);
    expect(JSON.stringify(bookings)).not.toContain('Student');
  });

  it('filters to a time window', () => {
    const day = overlapping(bookings, new Date('2026-11-18T08:00:00Z'), new Date('2026-11-18T12:30:00Z'));
    expect(day.map((b) => b.roomId)).toEqual(['10131', '10213', '2040']);
    expect(overlapping(bookings, new Date('2026-11-18T09:00:00Z'), new Date('2026-11-18T12:00:00Z'))).toEqual([]);
  });
});
