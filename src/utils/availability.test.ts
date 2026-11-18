import { describe, expect, it } from 'vitest';
import { getRoomAvailability, groupBookingsByRoom, type Booking } from './availability';
import { atMinutesFromMidnight } from './time';

const DAY = '2026-11-18';
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return atMinutesFromMidnight(DAY, h * 60 + m);
};
const booking = (start: string, end: string, roomId = 'R1'): Booking => ({
  roomId,
  start: at(start),
  end: at(end),
});

describe('getRoomAvailability', () => {
  const day = [booking('10:00', '11:00'), booking('11:00', '12:00'), booking('14:00', '15:00')];

  it('is FREE_LONG with no bookings at all', () => {
    const r = getRoomAvailability(at('09:00'), []);
    expect(r.status).toBe('FREE_LONG');
    expect(r.freeUntil).toBeNull();
    expect(r.freeMinutes).toBe(Infinity);
  });

  it('is FREE_LONG when the next booking is 60+ minutes away', () => {
    const r = getRoomAvailability(at('09:00'), day);
    expect(r.status).toBe('FREE_LONG');
    expect(r.freeUntil).toEqual(at('10:00'));
  });

  it('is FREE_SHORT when the next booking is 31-59 minutes away', () => {
    expect(getRoomAvailability(at('09:15'), day).status).toBe('FREE_SHORT');
  });

  it('is STARTING_SOON when the next booking is within 30 minutes', () => {
    expect(getRoomAvailability(at('09:30'), day).status).toBe('STARTING_SOON');
    expect(getRoomAvailability(at('09:45'), day).status).toBe('STARTING_SOON');
  });

  it('is OCCUPIED at the exact start of a booking', () => {
    expect(getRoomAvailability(at('10:00'), day).status).toBe('OCCUPIED');
  });

  it('is free at the exact end of a booking', () => {
    const r = getRoomAvailability(at('12:00'), day);
    expect(r.status).toBe('FREE_LONG');
    expect(r.freeMinutes).toBe(120);
  });

  it('merges back-to-back bookings into busyUntil', () => {
    const r = getRoomAvailability(at('10:30'), day);
    expect(r.status).toBe('OCCUPIED');
    expect(r.busyUntil).toEqual(at('12:00'));
  });

  it('lists only bookings that have not ended', () => {
    const r = getRoomAvailability(at('11:30'), day);
    expect(r.upcoming.map((b) => b.start)).toEqual([at('11:00'), at('14:00')]);
  });
});

describe('groupBookingsByRoom', () => {
  it('groups by room and sorts by start', () => {
    const grouped = groupBookingsByRoom([
      booking('14:00', '15:00', 'A'),
      booking('08:00', '09:00', 'B'),
      booking('09:00', '10:00', 'A'),
    ]);
    expect(grouped.get('A')!.map((b) => b.start)).toEqual([at('09:00'), at('14:00')]);
    expect(grouped.get('B')).toHaveLength(1);
  });
});
