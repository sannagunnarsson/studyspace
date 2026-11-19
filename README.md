# StudySpace

**Find a free study room at Ångströmslaboratoriet, Uppsala University.**

👉 **[findstudyspace.vercel.app](https://findstudyspace.vercel.app/)**

StudySpace shows which group rooms, lecture halls, classrooms and computer labs at Ångström are free right now,
and for how long. No more walking from room to room looking for an empty table.

## What you can do

- **See what's free at a glance.** Every room is coloured on an indoor map of the building:
  - green: free for at least an hour
  - light green: free, but for less than an hour
  - amber: free now, but booked within 30 minutes
  - red: occupied
- **Plan ahead.** Pick another time of day with the slider, or another date, and the map and list update.
  **Now** jumps back to the present.
- **Filter the list.** Show only group rooms, lecture halls, classrooms or computer labs. Pick how long you need
  the room (1, 2 or 3 hours or more), or search for a room number.
- **Open a room.** See its type, floor, number of seats and every booking that day. From there you can get
  directions in MazeMap or book the room in TimeEdit.
- **Switch floors** with the floor picker on the map, or switch to the **Schedule** view to see the whole day for
  every room as a timeline.

It works on phones as well as on larger screens.

## Where the data comes from

- **Bookings** come from Uppsala University's [TimeEdit](https://cloud.timeedit.net/uu/web/) schedule, through a
  subscription feed. The site reads it on the server and refreshes it every 15 minutes. Rooms booked outside
  TimeEdit can't be seen, so a room shown as free may occasionally be in use.
- **The map and room outlines** come from [MazeMap](https://use.mazemap.com/), which Uppsala University uses for
  its indoor maps.

StudySpace is an independent student project and isn't affiliated with Uppsala University, TimeEdit or MazeMap.

## Running it locally

You need [Node.js](https://nodejs.org/) 22 or later.

```bash
npm install
cp .env.example .env.local   # then paste your TimeEdit subscription link into .env.local
npm run dev
```

Without a TimeEdit link the site still runs, but shows example bookings and says so.

Other commands: `npm test` runs the tests, `npm run lint` checks the code, and `npm run build` makes a production
build.

### Getting a TimeEdit subscription link

In TimeEdit, search for the rooms you want, show the schedule and choose **Subscribe**. Copy the link (it ends in
`.ics`) into `TIMEEDIT_ICS_URL` in `.env.local`. Several links can be separated by spaces or commas.
The link is personal: keep it out of the repository. `.env.local` is already ignored by git.

## How it's built

- React, TypeScript and Tailwind CSS, built with Vite
- `src/App.tsx`: the interface (side panel, filters, time bar, schedule view)
- `src/components/RoomMap.tsx`: the MazeMap indoor map with rooms coloured by availability
- `src/data/rooms.json` and `src/data/roomGeometry.json`: the rooms and their outlines on the map
- `server/bookingsApi.ts`: reads the TimeEdit feed and answers `/api/bookings?date=YYYY-MM-DD`. Locally it runs in
  the Vite dev server (`server/bookingsPlugin.ts`), on Vercel as a serverless function (`api/bookings.ts`).
  All day boundaries use Swedish time, so results are the same wherever the server runs.

## Deploying on Vercel

The live site is hosted on Vercel and updates automatically on every push to `main`.

To set up your own copy:

1. Import the repository on [vercel.com](https://vercel.com/) (framework: Vite, defaults are fine).
2. Under **Settings → Environment Variables**, add `TIMEEDIT_ICS_URL` with your TimeEdit subscription link.
3. Deploy. If you change the variable later, choose **Redeploy** for it to take effect.
