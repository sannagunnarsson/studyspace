import type { Booking } from '../utils/availability';
import { atSecondsFromMidnight } from '../utils/time';

/** Raw booking as we expect TimeEdit to return it. */
export interface TimeEditBooking {
  startTime: number; // seconds from midnight
  endTime: number; // seconds from midnight
  room: string;
}

/** Days the TimeEdit feed has data for, as "YYYY-MM-DD" (inclusive). */
export interface Coverage {
  from: string;
  to: string;
}

export type BookingsResult =
  | {
      source: 'live';
      bookings: Booking[];
      coverage: Coverage | null;
      /** false when the date is outside the feed: "no bookings" then means "no data", not "free". */
      covered: boolean;
    }
  | { source: 'demo'; bookings: Booking[]; error: string };

/** YYYY-MM-DD strings compare correctly as text. */
export const isCovered = (dateKey: string, c: Coverage | null) => !c || (dateKey >= c.from && dateKey <= c.to);

/** Our own proxy (server/bookingsPlugin.ts), which reads the TimeEdit subscription feed. */
const API_BASE = '/api/bookings';

/** What /api/bookings returns per booking. */
interface ApiBooking {
  roomId: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
}

/** Converts TimeEdit's "seconds from midnight" into local Date objects. */
export function normalizeBookings(dateKey: string, raw: TimeEditBooking[]): Booking[] {
  return raw.map((b) => ({
    roomId: b.room,
    start: atSecondsFromMidnight(dateKey, b.startTime),
    end: atSecondsFromMidnight(dateKey, b.endTime),
  }));
}

/**
 * Fetches bookings for a "YYYY-MM-DD" day. If the API fails, returns demo data
 * marked with source: 'demo' so the UI can say so instead of showing fake data as real.
 */
export async function fetchBookings(dateKey: string, signal?: AbortSignal): Promise<BookingsResult> {
  try {
    const response = await fetch(`${API_BASE}?date=${encodeURIComponent(dateKey)}`, { signal });
    const data = (await response.json().catch(() => null)) as
      | { bookings?: ApiBooking[]; coverage?: Coverage | null; covered?: boolean; error?: string }
      | null;
    if (!response.ok) {
      throw new Error(data?.error ?? `Bookings API responded ${response.status}`);
    }
    if (!Array.isArray(data?.bookings)) {
      throw new Error('Bookings API response was not a list of bookings');
    }
    const coverage = data.coverage ?? null;
    return {
      source: 'live',
      bookings: data.bookings.map((b) => ({ roomId: b.roomId, start: new Date(b.start), end: new Date(b.end) })),
      coverage,
      // Prefer the server's answer: with several feeds it also knows about gaps between them.
      covered: data.covered ?? isCovered(dateKey, coverage),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    console.warn('Falling back to demo bookings:', message);
    return { source: 'demo', bookings: getDemoBookings(dateKey), error: message };
  }
}

function getDemoBookings(dateKey: string): Booking[] {
  const h = (hours: number) => hours * 3600;
  return normalizeBookings(dateKey, [
    { room: '10131', startTime: h(8), endTime: h(10) },
    { room: '10131', startTime: h(10), endTime: h(12) }, // back-to-back
    { room: '10131', startTime: h(15), endTime: h(17) },
    { room: '2040', startTime: h(10), endTime: h(11) },
    { room: '2040', startTime: h(13.25), endTime: h(15) },
    { room: '101154', startTime: h(12), endTime: h(13) },
    { room: '101154', startTime: h(13.75), endTime: h(16) },
  ]);
}
