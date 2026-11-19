import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { fetchBookings, type BookingsResult, type Coverage } from './services/timeedit';
import {
  getRoomAvailability,
  groupBookingsByRoom,
  type AvailabilityStatus,
  type Booking,
  type RoomAvailability,
} from './utils/availability';
import {
  addDays,
  atMinutesFromMidnight,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatMinutes,
  minutesSinceMidnight,
  toDateKey,
} from './utils/time';
import roomsData from './data/rooms.json';
import geometry from './data/roomGeometry.json';
import { RoomMap } from './components/RoomMap';

const STEP_MINUTES = 15;
const LAST_SLOT = 24 * 60 - STEP_MINUTES; // 23:45
// Window shown on the schedule board: the hours rooms are realistically used.
const DAY_START = 7 * 60;
const DAY_END = 22 * 60;
const AXIS_HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START / 60 + i);

const STATUS: Record<AvailabilityStatus, { dot: string; label: string; rank: number }> = {
  FREE_LONG: { dot: 'bg-free', label: 'Free 1 h+', rank: 0 },
  FREE_SHORT: { dot: 'bg-short', label: 'Free under 1 h', rank: 1 },
  STARTING_SOON: { dot: 'bg-soon', label: 'Booked soon', rank: 2 },
  OCCUPIED: { dot: 'bg-busy', label: 'Occupied', rank: 3 },
};

const TYPE_LABEL: Record<string, string> = {
  'group-room': 'Group room',
  'study-area': 'Study area',
  'lunch-room': 'Student lunch room',
  'lecture-hall': 'Lecture hall',
  classroom: 'Classroom',
  'seminar-room': 'Seminar room',
  'computer-lab': 'Computer lab',
};

const TYPE_FILTERS = [
  { key: 'all', label: 'All', types: null },
  { key: 'group', label: 'Group rooms', types: ['group-room', 'study-area', 'lunch-room'] },
  { key: 'lecture-hall', label: 'Lecture halls', types: ['lecture-hall'] },
  { key: 'classroom', label: 'Classrooms', types: ['classroom', 'seminar-room'] },
  { key: 'computer-lab', label: 'Computer labs', types: ['computer-lab'] },
] as const;
type TypeFilterKey = (typeof TYPE_FILTERS)[number]['key'];

// "How long do you need it?" — minimum free time from the chosen moment.
const NEED_OPTIONS = [
  { minutes: 0, label: 'Any' },
  { minutes: 60, label: '1 h+' },
  { minutes: 120, label: '2 h+' },
  { minutes: 180, label: '3 h+' },
] as const;

const FLOOR_OF = geometry as unknown as Record<string, { floor: string }>;
const floorLabel = (id: string) => (FLOOR_OF[id] ? `Floor ${FLOOR_OF[id].floor}` : null);

/** Free minutes from `at` until the next booking, capped at midnight. */
const freeFor = (a: RoomAvailability, at: number) => Math.min(a.freeMinutes, 24 * 60 - at);

function describe(a: RoomAvailability, at: number): string {
  if (a.status === 'OCCUPIED') return `Busy until ${formatClock(a.busyUntil!)}`;
  if (a.freeUntil) return `Free for ${formatDuration(freeFor(a, at))} · until ${formatClock(a.freeUntil)}`;
  return 'Free for the rest of the day';
}

/** Group room · Floor 1 · 6 seats */
const roomSubtitle = (room: (typeof roomsData)[number]) =>
  [TYPE_LABEL[room.type], floorLabel(room.id), room.seats > 0 && `${room.seats} seats`].filter(Boolean).join(' · ');

function Legend() {
  return (
    <ul aria-label="Colour key" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {(Object.keys(STATUS) as AvailabilityStatus[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <StatusDot status={s} size="h-2 w-2" />
          {STATUS[s].label}
        </li>
      ))}
    </ul>
  );
}

/** "2026-12-18" -> "18 Dec" */
const formatDay = (dateKey: string) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function NoData({ coverage, onToday }: { coverage: Coverage | null; onToday: () => void }) {
  return (
    <div role="status" className="m-auto max-w-xs px-4 py-8 text-center text-sm">
      <p className="mb-1 font-semibold">No booking data for this date</p>
      <p className="mb-4 text-muted">
        {coverage
          ? `TimeEdit only has bookings from ${formatDay(coverage.from)} to ${formatDay(coverage.to)}, so StudySpace can't tell which rooms are free.`
          : "TimeEdit has no bookings for this date, so StudySpace can't tell which rooms are free."}
      </p>
      <button type="button" onClick={onToday} className="h-9 rounded-md bg-ink px-4 font-semibold text-paper hover:opacity-90">
        Go to today
      </button>
    </div>
  );
}

const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const endMinute = (d: Date) => minuteOfDay(d) || 24 * 60;
const pct = (m: number) => ((Math.min(Math.max(m, DAY_START), DAY_END) - DAY_START) / (DAY_END - DAY_START)) * 100;
const clampTime = (m: number) => Math.min(Math.max(m, 0), LAST_SLOT);

// --- Small inline icons (stroke follows currentColor) ---
const Icon = ({ d, className = 'h-5 w-5' }: { d: string; className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);
const I = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  close: 'M18 6 6 18M6 6l12 12',
  back: 'M15 18l-6-6 6-6',
  panel: 'M4 5h16v14H4zM9 5v14',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  now: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
};

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-10 w-10 place-items-center bg-surface text-ink hover:bg-paper"
    >
      {children}
    </button>
  );
}

function StatusDot({ status, size = 'h-2.5 w-2.5' }: { status: AvailabilityStatus; size?: string }) {
  return <span className={`${size} shrink-0 rounded-full transition-colors duration-300 ${STATUS[status].dot}`} />;
}

type RoomRow = { room: (typeof roomsData)[number]; bookings: Booking[]; availability: RoomAvailability };

function App() {
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [timeOffset, setTimeOffset] = useState(() => minutesSinceMidnight(new Date(), STEP_MINUTES));
  const [loaded, setLoaded] = useState<{ date: string; result: BookingsResult } | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilterKey>('all');
  const [need, setNeed] = useState(0); // minutes the user needs the room for
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true); // desktop side panel
  const [sheetExpanded, setSheetExpanded] = useState(false); // mobile bottom sheet
  const [view, setView] = useState<'map' | 'schedule'>('map');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Abort the previous request so a slow response can't overwrite a newer date.
    const controller = new AbortController();
    fetchBookings(selectedDate, controller.signal)
      .then((result) => setLoaded({ date: selectedDate, result }))
      .catch(() => {
        /* aborted */
      });
    return () => controller.abort();
  }, [selectedDate]);

  const loading = loaded?.date !== selectedDate;
  const result = loading ? null : loaded.result;
  // Outside the feed's window an empty day means "unknown", not "everything free".
  const noData = result?.source === 'live' && !result.covered;
  // Last known coverage, kept while the next date loads (used to limit the date picker).
  const coverage = loaded?.result.source === 'live' ? loaded.result.coverage : null;
  const bookingsByRoom = useMemo(() => groupBookingsByRoom(result?.bookings ?? []), [result]);
  const at = atMinutesFromMidnight(selectedDate, timeOffset);

  const rooms: RoomRow[] = roomsData
    .map((room) => {
      const bookings = bookingsByRoom.get(room.id) ?? [];
      return { room, bookings, availability: getRoomAvailability(at, bookings) };
    })
    // Free rooms first, the longest free stretch at the top; busy rooms by when they free up.
    .sort(
      (a, b) =>
        STATUS[a.availability.status].rank - STATUS[b.availability.status].rank ||
        freeFor(b.availability, timeOffset) - freeFor(a.availability, timeOffset) ||
        (a.availability.busyUntil?.getTime() ?? 0) - (b.availability.busyUntil?.getTime() ?? 0) ||
        a.room.name.localeCompare(b.room.name, 'sv', { numeric: true }),
    );
  const q = query.trim().toLowerCase();
  const allowedTypes: readonly string[] | null = TYPE_FILTERS.find((f) => f.key === typeFilter)!.types;
  const ofType = allowedTypes ? rooms.filter(({ room }) => allowedTypes.includes(room.type)) : rooms;
  const longEnough = need ? ofType.filter((r) => freeFor(r.availability, timeOffset) >= need) : ofType;
  const visible = q
    ? longEnough.filter(({ room }) => `${room.name} ${room.id} ${TYPE_LABEL[room.type]}`.toLowerCase().includes(q))
    : longEnough;
  const freeCount = ofType.filter((r) => r.availability.status !== 'OCCUPIED').length;
  const [todayKey] = useState(() => toDateKey(new Date()));
  const canGoBack = !coverage || addDays(selectedDate, -1) >= coverage.from;
  const canGoForward = !coverage || addDays(selectedDate, 1) <= coverage.to;
  const selected = rooms.find((r) => r.room.id === selectedId) ?? null;

  const goToNow = () => {
    const now = new Date();
    setSelectedDate(toDateKey(now));
    setTimeOffset(minutesSinceMidnight(now, STEP_MINUTES));
  };
  const selectRoom = (id: string | null) => {
    setSelectedId(id);
    setPanelOpen(true);
    // Keep the sheet low on phones so the map can show the picked room.
    if (id) setSheetExpanded(false);
  };
  const pickTime = (e: MouseEvent<HTMLElement>, roomId?: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = DAY_START + ((e.clientX - r.left) / r.width) * (DAY_END - DAY_START);
    setTimeOffset(clampTime(Math.round(m / STEP_MINUTES) * STEP_MINUTES));
    if (roomId) selectRoom(roomId);
  };

  // ---------- Side panel (desktop) / bottom sheet (mobile) ----------
  const panel = (
    <aside
      aria-label="Rooms"
      onKeyDown={(e) => e.key === 'Escape' && selected && setSelectedId(null)}
      className={[
        'fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-2xl bg-surface shadow-float transition-[height,transform] duration-300 ease-out',
        sheetExpanded ? 'h-[85dvh]' : 'h-[42dvh]',
        'md:absolute md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:h-auto md:w-[360px] md:rounded-xl',
        panelOpen ? 'md:translate-x-0' : 'md:-translate-x-[calc(100%+2rem)]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => setSheetExpanded((v) => !v)}
        aria-label={sheetExpanded ? 'Collapse panel' : 'Expand panel'}
        aria-expanded={sheetExpanded}
        className="flex justify-center py-2 md:hidden"
      >
        <span className="h-1 w-10 rounded-full bg-line" />
      </button>

      {/* On phones a room's details replace search and filters, so they fit above the fold. */}
      <div className={`border-b border-line px-4 pb-3 md:block md:pt-4 ${selected ? 'hidden' : ''}`}>
        <div className="mb-3 hidden items-center justify-between md:flex">
          <h1 className="font-bold tracking-tight">StudySpace</h1>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Hide panel"
            title="Hide panel"
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-paper hover:text-ink"
          >
            <Icon d={I.panel} className="h-4 w-4" />
          </button>
        </div>
        <div className="flex h-11 items-center gap-2 rounded-lg bg-paper px-3 focus-within:outline-2 focus-within:outline-ink">
          <Icon d={I.search} className="h-4 w-4 text-muted" />
          <label htmlFor="search" className="sr-only">Search rooms</label>
          <input
            id="search"
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search rooms"
            autoComplete="off"
            onFocus={() => setSheetExpanded(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedId(null);
            }}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="text-muted hover:text-ink">
              <Icon d={I.close} className="h-4 w-4" />
            </button>
          )}
        </div>
        <div role="group" aria-label="Room type" className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={typeFilter === f.key}
              onClick={() => {
                setTypeFilter(f.key);
                setSelectedId(null);
              }}
              className={`h-8 shrink-0 rounded-full border px-3 text-sm ${
                typeFilter === f.key ? 'border-ink bg-ink font-semibold text-paper' : 'border-line text-ink hover:bg-paper'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Free for at least" className="mt-2 flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted">Need it for</span>
          <div className="flex flex-1 rounded-lg bg-paper p-0.5">
            {NEED_OPTIONS.map((o) => (
              <button
                key={o.minutes}
                type="button"
                aria-pressed={need === o.minutes}
                onClick={() => {
                  setNeed(o.minutes);
                  setSelectedId(null);
                }}
                className={`h-7 flex-1 rounded-md px-1 ${need === o.minutes ? 'bg-surface font-semibold shadow-float' : 'text-muted hover:text-ink'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div key={selectedId ?? "list"} className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Loading bookings…</p>
        ) : noData ? (
          <NoData coverage={coverage} onToday={goToNow} />
        ) : selected ? (
          <RoomDetail row={selected} at={timeOffset} onBack={() => setSelectedId(null)} />
        ) : (
          <>
            <div className="space-y-2 px-4 pb-1 pt-3">
              <p aria-live="polite" className="text-sm">
                <strong className="font-semibold">{freeCount} of {ofType.length} rooms free</strong>{' '}
                <span className="text-muted">
                  {selectedDate === todayKey ? '' : `${formatDayLabel(selectedDate, todayKey)} `}at {formatMinutes(timeOffset)}
                </span>
              </p>
              <Legend />
            </div>
            {visible.length === 0 ? (
              <div className="px-4 py-8 text-sm">
                <p className="mb-2">
                  {q
                    ? `No rooms match “${query}”.`
                    : `No room is free for ${formatDuration(need)} from ${formatMinutes(timeOffset)}.`}
                </p>
                <button
                  type="button"
                  onClick={() => (q ? setQuery('') : setNeed(0))}
                  className="font-semibold underline underline-offset-2"
                >
                  {q ? 'Clear search' : 'Show all rooms'}
                </button>
              </div>
            ) : (
              <ul className="p-2">
                {visible.map(({ room, availability }) => (
                  <li key={room.id}>
                    <button
                      type="button"
                      onClick={() => selectRoom(room.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-paper"
                    >
                      <StatusDot status={availability.status} size="h-3 w-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{room.name}</span>
                        <span className="block truncate text-xs text-muted">{roomSubtitle(room)}</span>
                        <span className={`block text-sm ${availability.status === 'OCCUPIED' ? 'text-muted' : ''}`}>
                          {describe(availability, timeOffset)}
                        </span>
                      </span>
                      <Icon d="M9 18l6-6-6-6" className="h-4 w-4 shrink-0 text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {result?.source === 'demo' && (
        <p role="status" className="border-t border-line bg-soon/10 px-4 py-2.5 text-xs leading-snug">
          <strong className="font-semibold">Example bookings.</strong> Live data from TimeEdit couldn't be loaded (
          {result.error}).
        </p>
      )}
    </aside>
  );

  // ---------- Schedule board (the "map" canvas) ----------
  const cursorVisible = timeOffset >= DAY_START && timeOffset <= DAY_END;
  const board = (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface shadow-float">
      <div className="flex border-b border-line">
        <div className="w-24 shrink-0 sm:w-32" />
        <div aria-hidden className="relative h-8 flex-1 text-[11px] text-muted tabular-nums">
          {AXIS_HOURS.map((h, i) => (
            <span
              key={h}
              className={`absolute top-2 -translate-x-1/2 ${i % 2 ? 'hidden sm:inline' : ''}`}
              style={{ left: `${pct(h * 60)}%` }}
            >
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* hour grid + time cursor, aligned with the track column */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-24 right-0 sm:left-32">
          {AXIS_HOURS.map((h) => (
            <span key={h} className="absolute inset-y-0 w-px bg-line/70" style={{ left: `${pct(h * 60)}%` }} />
          ))}
          {cursorVisible && (
            <span className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-ink transition-[left] duration-200" style={{ left: `${pct(timeOffset)}%` }} />
          )}
        </div>

        {loading ? (
          <p className="m-auto text-sm text-muted">Loading bookings…</p>
        ) : noData ? (
          <p className="m-auto px-4 text-center text-sm text-muted">No booking data for this date.</p>
        ) : visible.length === 0 ? (
          <p className="m-auto text-sm text-muted">No rooms to show.</p>
        ) : (
          visible.map(({ room, bookings, availability }) => (
            <div
              key={room.id}
              className={`flex min-h-12 flex-1 basis-12 border-b border-line last:border-b-0 sm:max-h-32 ${room.id === selectedId ? 'bg-paper/70' : ''}`}
            >
              <button
                type="button"
                onClick={() => selectRoom(room.id)}
                className="flex w-24 shrink-0 items-center gap-2 border-r border-line px-3 text-left text-sm font-medium sm:w-32"
              >
                <StatusDot status={availability.status} />
                <span className="truncate">{room.id}</span>
              </button>
              <div
                aria-hidden
                onClick={(e) => pickTime(e, room.id)}
                className="relative flex-1 cursor-pointer"
                title="Click to jump to this time"
              >
                {bookings.map((b, i) => {
                  const left = pct(minuteOfDay(b.start));
                  const width = pct(endMinute(b.end)) - left;
                  return width > 0 ? (
                    <span
                      key={i}
                      className="absolute inset-y-3 overflow-hidden whitespace-nowrap rounded-md bg-busy/85 px-1.5 py-1 text-[11px] font-medium leading-tight text-white tabular-nums"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      {width > 9 && `${formatClock(b.start)}–${formatClock(b.end)}`}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="relative h-dvh overflow-hidden bg-paper font-sans">
      {/* Canvas: leaves room for the panel on desktop and the sheet on mobile */}
      <main
        className={[
          'flex h-full flex-col gap-3 p-3 pb-[calc(42dvh+0.75rem)] transition-[padding] duration-300 ease-out md:gap-4 md:p-4 md:pr-20',
          panelOpen ? 'md:pl-[392px]' : 'md:pl-20',
        ].join(' ')}
      >
        <h1 className="sr-only md:hidden">StudySpace</h1>
        <section aria-label="Time" className="rounded-xl bg-surface px-4 py-3 shadow-float">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <output htmlFor="time" className="text-4xl font-semibold leading-none tracking-tight tabular-nums md:text-5xl">
              {formatMinutes(timeOffset)}
            </output>
            <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
              <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-line sm:flex-none">
                <button
                  type="button"
                  aria-label="Previous day"
                  title="Previous day"
                  disabled={!canGoBack}
                  onClick={() => setSelectedDate(addDays(selectedDate, -1))}
                  className="grid h-full w-9 shrink-0 place-items-center text-muted hover:text-ink disabled:opacity-30"
                >
                  <Icon d={I.back} className="h-4 w-4" />
                </button>
                {/* The native date picker sits invisibly on top of the friendly label. */}
                <label className="relative flex h-full min-w-0 flex-1 cursor-pointer items-center justify-center border-x border-line px-3 text-sm font-medium sm:w-40 sm:flex-none">
                  <span className="truncate">
                    {formatDayLabel(selectedDate, todayKey)}
                    {/* "Today" / "Tomorrow" get the date added; other days already show it. */}
                    {!/\d/.test(formatDayLabel(selectedDate, todayKey)) && (
                      <span className="font-normal text-muted"> · {formatDay(selectedDate)}</span>
                    )}
                  </span>
                  <span className="sr-only">Choose date</span>
                  <input
                    id="date"
                    type="date"
                    value={selectedDate}
                    min={coverage?.from}
                    max={coverage?.to}
                    onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
                <button
                  type="button"
                  aria-label="Next day"
                  title="Next day"
                  disabled={!canGoForward}
                  onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                  className="grid h-full w-9 shrink-0 place-items-center text-muted hover:text-ink disabled:opacity-30"
                >
                  <Icon d="M9 18l6-6-6-6" className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={goToNow}
                className="h-9 shrink-0 rounded-md bg-ink px-4 text-sm font-semibold text-paper hover:opacity-90"
              >
                Now
              </button>
            </div>
            <div role="group" aria-label="View" className="ml-auto flex rounded-lg bg-paper p-0.5 text-sm font-medium">
              {(['map', 'schedule'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1.5 capitalize ${view === v ? 'bg-surface shadow-float' : 'text-muted hover:text-ink'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <label htmlFor="time" className="sr-only">Time of day</label>
          <input
            id="time"
            type="range"
            min={0}
            max={LAST_SLOT}
            step={STEP_MINUTES}
            value={timeOffset}
            onChange={(e) => setTimeOffset(Number(e.target.value))}
            className="mt-3 h-2 w-full cursor-pointer"
          />
          <div aria-hidden className="relative mt-1 h-4 text-[11px] text-muted tabular-nums">
            {[0, 6, 9, 12, 15, 18, 21].map((h) => (
              <button
                key={h}
                type="button"
                tabIndex={-1}
                onClick={() => setTimeOffset(h * 60)}
                className={`absolute -translate-x-1/2 hover:text-ink ${h === 0 ? 'translate-x-0' : ''}`}
                style={{ left: `${((h * 60) / LAST_SLOT) * 100}%` }}
              >
                {String(h).padStart(2, '0')}
              </button>
            ))}
          </div>
        </section>
        {view === 'map' ? (
          <RoomMap
            rooms={noData || loading ? [] : visible.map((r) => ({ id: r.room.id, status: r.availability.status }))}
            selectedId={selectedId}
            onSelect={selectRoom}
          />
        ) : (
          board
        )}
      </main>

      {/* Reopen panel (desktop), like a floating search button */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => {
            setPanelOpen(true);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
          aria-label="Show rooms panel"
          title="Show rooms panel"
          className="absolute left-4 top-4 z-20 hidden h-10 w-10 place-items-center rounded-lg bg-ink text-paper shadow-float md:grid"
        >
          <Icon d={I.search} />
        </button>
      )}

      {/* Floating controls, right edge */}
      <div className="absolute right-3 top-3 z-10 hidden flex-col gap-2 md:right-4 md:top-4 md:flex">
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-full shadow-float">
          <RoundButton label="15 minutes later" onClick={() => setTimeOffset((t) => clampTime(t + STEP_MINUTES))}>
            <Icon d={I.plus} className="h-4 w-4" />
          </RoundButton>
          <RoundButton label="15 minutes earlier" onClick={() => setTimeOffset((t) => clampTime(t - STEP_MINUTES))}>
            <Icon d={I.minus} className="h-4 w-4" />
          </RoundButton>
        </div>
      </div>

      {panel}
    </div>
  );
}

function RoomDetail({ row, at, onBack }: { row: RoomRow; at: number; onBack: () => void }) {
  const { room, bookings, availability } = row;
  return (
    <div className="p-4">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-3 flex items-center gap-1 rounded-md px-1 py-1 text-sm text-muted hover:text-ink"
      >
        <Icon d={I.back} className="h-4 w-4" />
        All rooms
      </button>
      <h2 className="text-2xl font-semibold tracking-tight">{room.name}</h2>
      <p className="text-sm text-muted">
        {[roomSubtitle(room), `${room.building} ${room.id}`].join(' · ')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {room.mazeMapUrl && (
          <a
            href={room.mazeMapUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-paper"
          >
            Directions in MazeMap ↗
          </a>
        )}
        {room.timeEditId && (
          <a
            href="https://cloud.timeedit.net/uu/web/wr_student/"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-paper"
          >
            Book in TimeEdit ↗
          </a>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-paper px-3 py-3">
        <StatusDot status={availability.status} size="h-3 w-3" />
        <div>
          <p className="font-medium">{STATUS[availability.status].label}</p>
          <p className="text-sm text-muted">{describe(availability, at)}</p>
        </div>
      </div>
      <h3 className="mb-2 mt-6 text-sm font-semibold">Bookings this day</h3>
      {bookings.length === 0 ? (
        <p className="text-sm text-muted">No bookings. The room is free all day.</p>
      ) : (
        <ol className="space-y-1">
          {bookings.map((b, i) => {
            const past = endMinute(b.end) <= at;
            const now = minuteOfDay(b.start) <= at && at < endMinute(b.end);
            return (
              <li
                key={i}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm tabular-nums ${now ? 'bg-busy/10 font-medium' : ''} ${past ? 'text-muted line-through decoration-line' : ''}`}
              >
                <span>
                  {formatClock(b.start)}–{formatClock(b.end)}
                </span>
                {now && <span className="text-xs text-busy">Now</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default App;
