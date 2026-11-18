export type AvailabilityStatus =
  | 'OCCUPIED' // red
  | 'FREE_LONG' // green: free for at least FREE_LONG_MINUTES
  | 'FREE_SHORT' // light green: free, but for less than FREE_LONG_MINUTES
  | 'STARTING_SOON'; // yellow: free now, booking starts within SOON_MINUTES

export const FREE_LONG_MINUTES = 60;
export const SOON_MINUTES = 30;

export interface Booking {
  roomId: string;
  start: Date;
  end: Date;
}

export interface RoomAvailability {
  status: AvailabilityStatus;
  /** When the room next becomes busy; null = no more bookings in the loaded data. */
  freeUntil: Date | null;
  /** When the room becomes free again (back-to-back bookings merged); null if free now. */
  busyUntil: Date | null;
  /** Free minutes from `at`; Infinity when no later booking is known. 0 when occupied. */
  freeMinutes: number;
  /** Bookings that haven't ended yet at `at`, sorted by start. */
  upcoming: Booking[];
}

const MINUTE = 60 * 1000;

/** Groups bookings per room, each list sorted by start time. */
export function groupBookingsByRoom(bookings: Booking[]): Map<string, Booking[]> {
  const byRoom = new Map<string, Booking[]>();
  for (const b of bookings) {
    const list = byRoom.get(b.roomId);
    if (list) list.push(b);
    else byRoom.set(b.roomId, [b]);
  }
  for (const list of byRoom.values()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  return byRoom;
}

/**
 * Availability of one room at time `at`.
 * `roomBookings` must belong to a single room and be sorted by start
 * (as returned by groupBookingsByRoom).
 */
export function getRoomAvailability(at: Date, roomBookings: Booking[]): RoomAvailability {
  const t = at.getTime();
  const upcoming = roomBookings.filter((b) => b.end.getTime() > t);

  const current = upcoming.find((b) => b.start.getTime() <= t);
  if (current) {
    // Follow back-to-back or overlapping bookings to find the real free time.
    let busyUntil = current.end.getTime();
    for (const b of upcoming) {
      if (b.start.getTime() <= busyUntil && b.end.getTime() > busyUntil) {
        busyUntil = b.end.getTime();
      }
    }
    return {
      status: 'OCCUPIED',
      freeUntil: null,
      busyUntil: new Date(busyUntil),
      freeMinutes: 0,
      upcoming,
    };
  }

  const next = upcoming[0];
  const freeMinutes = next ? (next.start.getTime() - t) / MINUTE : Infinity;

  let status: AvailabilityStatus;
  if (freeMinutes <= SOON_MINUTES) status = 'STARTING_SOON';
  else if (freeMinutes < FREE_LONG_MINUTES) status = 'FREE_SHORT';
  else status = 'FREE_LONG';

  return {
    status,
    freeUntil: next ? next.start : null,
    busyUntil: null,
    freeMinutes,
    upcoming,
  };
}
