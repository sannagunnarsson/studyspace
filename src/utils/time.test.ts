import { describe, expect, it } from 'vitest';
import { atSecondsFromMidnight, formatMinutes, minutesSinceMidnight, toDateKey } from './time';

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
