# Fix Leaderboard Error - Quick Start

## 🚨 Error You're Seeing

```
Could not find table public.leaderboard in schema cache
```

## ⚡ 3-Minute Fix

### Step 1️⃣ Copy This SQL

Go to your **Supabase Console → SQL Editor** and copy-paste this query:

```sql
DROP MATERIALIZED VIEW IF EXISTS public.leaderboard CASCADE;
DROP VIEW IF EXISTS public.leaderboard CASCADE;

CREATE VIEW public.leaderboard AS
SELECT
  s.id,
  s.email,
  s.full_name,
  s.avatar_emoji,
  s.eco_points,
  s.streak_days,
  s.school_id,
  s.role,
  s.created_at,
  s.updated_at,
  ROW_NUMBER() OVER (ORDER BY s.eco_points DESC, s.updated_at ASC) AS rank,
  COUNT(*) OVER () AS total_users
FROM public.students s
WHERE s.role = 'student'
ORDER BY s.eco_points DESC, s.updated_at ASC;
```

### Step 2️⃣ Run It

Click **Run** or press `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows)

**Expected:** ✅ View successfully created

### Step 3️⃣ Create Indexes (Performance)

Copy-paste this second query:

```sql
CREATE INDEX idx_students_eco_points ON public.students(eco_points DESC, updated_at ASC);
CREATE INDEX idx_students_id ON public.students(id);
```

Click **Run**

**Expected:** ✅ Indexes successfully created

### Step 4️⃣ Refresh Schema Cache

Click the **🔄 Refresh** icon in Supabase Console top navigation (or wait 5-10 seconds)

### Step 5️⃣ Test It

Run this verification query:

```sql
SELECT * FROM public.leaderboard LIMIT 5;
```

**Expected:** ✅ Shows 5 rows with user data

---

## ✅ Done!

Your leaderboard should now work. The error "Could not find table" won't appear anymore.

---

## 🤔 What Changed?

| Component               | Before           | After                         |
| ----------------------- | ---------------- | ----------------------------- |
| Leaderboard             | ❌ Not created   | ✅ View created               |
| Leaderboard data        | ❌ Not available | ✅ Synced from students table |
| Rankings                | ❌ Broken        | ✅ Dynamic via ROW_NUMBER()   |
| Performance indexes     | ❌ Missing       | ✅ Added 2 indexes            |
| Frontend error handling | ⚠️ Crashes       | ✅ Graceful fallback          |

---

## 📖 Full Details

See [LEADERBOARD_SETUP.md](LEADERBOARD_SETUP.md) for:

- Complete explanation of what leaderboard is
- How rankings work
- Performance optimization options
- Troubleshooting

---

## ❓ Still Having Issues?

1. **"Could not find table" still shows?**
   - Click the 🔄 Refresh icon in Supabase
   - Wait 10 seconds
   - Try again

2. **View runs but shows no data?**
   - Make sure you have users in the `students` table
   - Run: `SELECT COUNT(*) FROM public.students;`
   - Should show > 0

3. **"Syntax error" when running SQL?**
   - Make sure you copied the **entire** SQL block
   - Check for missing semicolons at the end

---

## 🎉 Result

- Leaderboard screen loads without errors
- Top users display with rankings
- User's rank shows in profile
- No more "schema cache" errors
