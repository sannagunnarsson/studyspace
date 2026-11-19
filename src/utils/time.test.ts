import { describe, expect, it } from 'vitest';
import { addDays, atSecondsFromMidnight, formatDayLabel, formatDuration, formatMinutes, minutesSinceMidnight, toDateKey } from './time';

describe('time helpers', () => {
  it('maps seconds from midnight to local wall-clock time', () => {
    const d = atSecondsFromMidnight('2026-11-18', 8 * 3600);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(0);
  });

  it('keeps wall-clock time on a DST change day', () => {
    // 2026-03-29 is the spring-forward day in Sweden.
    expect(atSecondsFromMidnight('2026-03-29', 10 * 3600).getHours()).toBe(10);
  });

  it('formats the local date key, not the UTC one', () => {
    expect(toDateKey(new Date(2026, 10, 18, 0, 30))).toBe('2026-11-18');
  });

  it('rounds minutes since midnight down to the step', () => {
    expect(minutesSinceMidnight(new Date(2026, 10, 18, 9, 44), 15)).toBe(9 * 60 + 30);
  });

  it('formats minutes as HH:MM', () => {
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(1425)).toBe('23:45');
  });
});

describe('friendly dates and durations', () => {
  it('moves across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(135)).toBe('2 h 15 min');
  });
  it('names nearby days', () => {
    expect(formatDayLabel('2026-11-18', '2026-11-18')).toBe('Today');
    expect(formatDayLabel('2026-11-19', '2026-11-18')).toBe('Tomorrow');
    expect(formatDayLabel('2026-11-17', '2026-11-18')).toBe('Yesterday');
    expect(formatDayLabel('2026-11-20', '2026-11-18')).toBe('Fri 20 Nov');
  });
});
