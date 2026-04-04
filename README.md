# EcoVerse Student App

EcoVerse Student is a React Native + Expo app for school students to learn sustainability, complete eco missions, earn eco points, track leaderboard rank, and unlock badges.

## Tech Stack

- Expo + React Native + Expo Router
- TypeScript
- Supabase (Auth, Postgres, Realtime, Edge Functions)
- TanStack Query
- Reanimated + SVG charts

## Student-Side User Journey

### 1. Auth

- Student signs up or logs in.
- Profile is loaded from Supabase.

### 2. Dashboard

- Sees eco points, streak, level, rank.
- Weekly chart shows progress trend.
- Ecosystem Growth section visualizes progress stage.

### 3. Learning Flow (Updated)

- Learning list first view: only lesson title + topic + `Open Lesson Detail`.
- Student opens detail page, reads full lesson content.
- Student taps `Mark Complete`.
- If topic lessons are fully completed:
  - AI quiz is generated for that topic (with fallback)
  - quiz attempt is recorded
  - extra eco points and badge rewards can be granted
  - celebration feedback is shown

### 4. Missions

- Student starts mission, submits proof, waits for teacher review.
- Approved submissions increase impact and stats.

### 5. Profile & Notifications

- Student sees rank, notifications, badges.
- Notifications can be marked read.

## Project Structure (Important)

- `app/(tabs)` : Main tab screens (`index`, `learning`, `missions`, `leaderboard`, `profile`)
- `app/lesson/[lessonId].tsx` : Lesson detail + completion flow
- `lib/supabase/supabase-queries.ts` : Main query layer and schema-safe fallbacks
- `providers/auth-provider.tsx` : Auth context
- `supabase/migrations` : SQL migrations

## Environment Variables

Create a `.env` file in project root:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Local Setup

```bash
npm install
npm run lint
npx tsc --noEmit
```

Run app:

```bash
npx expo start
```

Run web on fixed port:

```bash
npx expo start --web --port 8083 --clear
```

## Scripts

- `npm run lint` : Lint checks
- `npm test -- --runInBand` : Jest tests
- `npx tsc --noEmit` : Type check

## Database Notes

- Run SQL migrations in `supabase/migrations`.
- Make sure `notifications` table supports read state.
- Query layer includes fallback for schema differences (example: if `read_at` column is missing, app falls back to `is_read` update only).

## Related Docs

- `README_AUTH.md` : Auth docs index
- `SETUP_CHECKLIST.md` : Setup checklist
- `SUPABASE_SQL_SETUP.md` : SQL setup guide
- `docs/STUDENT_AUTH_INTEGRATION.md` : Student auth integration details

## Teacher Side Integration

- Teacher web repository: https://github.com/Ni30sh/ECO_ACADEMY_WEB

How student side and teacher side work together:

- Shared backend: both apps use the same Supabase project (Auth + Postgres + RLS).
- Identity mapping: student and teacher accounts are identified by `auth.users.id`, and profile rows in `students` / `profiles` link to that identity.
- Assignment model: each student can have a `teacher_id` assignment, used to route submissions and review ownership.
- Mission review flow:
  - Student app creates mission submissions and proof records.
  - Teacher web app reads pending submissions for assigned students.
  - Teacher approves/rejects; review status is saved in Supabase.
  - Student app refreshes profile/dashboard/notifications and reflects the latest decision.
- Notifications and realtime:
  - Student app listens for changes via Supabase Realtime/subscription updates.
  - Teacher actions (review, feedback, status updates) are surfaced back to students.
- Leaderboard and points consistency:
  - Points and progress updates are stored centrally in Supabase.
  - Student app and teacher app both read from the same source of truth, so rankings and progress remain aligned.

Practical setup note:

- Configure both repositories with the same Supabase URL and keys for the same environment (dev/staging/prod) to keep student-teacher data in sync.

## Troubleshooting

### Notification error about `read_at`

If you see errors like:

`Could not find the 'read_at' column of 'notifications' in the schema cache`

Current query implementation now safely handles this by retrying without `read_at`.

### App compiles but data missing

- verify `.env` keys
- check Supabase RLS policies
- run latest migrations

### Lint/type failures

- run `npm run lint`
- run `npx tsc --noEmit`
- fix reported file directly before running app

## Current Status

- Student-side learning UX simplified for first look
- Lesson detail page handles read -> complete flow
- Topic completion can trigger AI quiz + rewards
- Notification mark-as-read schema fallback implemented

