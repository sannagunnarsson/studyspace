/**
 * Date helpers that work in the browser's local time.
 *
 * Never use `new Date("YYYY-MM-DD")` or `toISOString()` for calendar dates:
 * both treat the date as UTC, which shifts times by 1–2 hours in Sweden.
 */

/** "YYYY-MM-DD" for the given date in local time. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local time on the given "YYYY-MM-DD" day, offset by `seconds` from midnight. */
export function atSecondsFromMidnight(dateKey: string, seconds: number): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Wall-clock construction, so DST days still map 08:00 to 08:00.
  return new Date(y, m - 1, d, 0, 0, seconds);
}

/** Local time on the given day, offset by `minutes` from midnight. */
export function atMinutesFromMidnight(dateKey: string, minutes: number): Date {
  return atSecondsFromMidnight(dateKey, minutes * 60);
}

/** Minutes since local midnight, rounded down to a multiple of `step`. */
export function minutesSinceMidnight(date: Date, step = 1): number {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return Math.floor(minutes / step) * step;
}

/** 90 -> "01:30" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Date -> "HH:MM" in local time. */
export function formatClock(date: Date): string {
  return formatMinutes(date.getHours() * 60 + date.getMinutes());
}

/** "2026-11-18" moved by `days` (local calendar, DST-safe). */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

/** 135 -> "2 h 15 min", 45 -> "45 min", 120 -> "2 h" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "Today", "Tomorrow", "Yesterday", otherwise "Fri 20 Nov". */
export function formatDayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Today';
  if (dateKey === addDays(todayKey, 1)) return 'Tomorrow';
  if (dateKey === addDays(todayKey, -1)) return 'Yesterday';
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
