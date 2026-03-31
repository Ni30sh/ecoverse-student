# Leaderboard Setup & Error Resolution Guide

## ❌ Error: "Could not find table public.leaderboard in schema cache"

This error occurs when the frontend tries to query the `leaderboard` view/table but it hasn't been created yet in your Supabase database.

---

## 🏗️ Solution Overview

The leaderboard in EcoVerse is implemented as a **PostgreSQL View** that:

- Computes rankings from the `students` table
- Provides efficient read-only access to top users
- Automatically stays in sync with student data
- Includes ROW_NUMBER() for dynamic ranking

---

## 📋 Quick Fix Steps

### 1. **Create the Leaderboard View**

Run **STEP 9** from [SUPABASE_SQL_SETUP.md](SUPABASE_SQL_SETUP.md#L248-L280):

```sql
-- Drop existing leaderboard if it exists
DROP MATERIALIZED VIEW IF EXISTS public.leaderboard CASCADE;
DROP VIEW IF EXISTS public.leaderboard CASCADE;

-- Create leaderboard view with ranking
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

**Expected Result:** ✅ View created, no errors

---

### 2. **Create Leaderboard Indexes**

Run **STEP 10** from [SUPABASE_SQL_SETUP.md](SUPABASE_SQL_SETUP.md#L282-L295):

```sql
CREATE INDEX idx_students_eco_points ON public.students(eco_points DESC, updated_at ASC);
CREATE INDEX idx_students_id ON public.students(id);
```

**Expected Result:** ✅ Indexes created, no errors

---

### 3. **Refresh Supabase Schema Cache**

After creating the view, you may need to refresh the schema cache:

**In Supabase Console:**

- Go to **SQL Editor**
- Click the **refresh** icon in the top navigation
- OR wait 5-10 seconds for auto-refresh

**Alternative (forceful refresh):**

```sql
-- Run a test query to trigger schema cache refresh
SELECT * FROM public.leaderboard LIMIT 1;
```

---

## 📊 Leaderboard Schema

The `leaderboard` view returns these columns:

| Column         | Type      | Source                | Purpose                             |
| -------------- | --------- | --------------------- | ----------------------------------- |
| `id`           | UUID      | students.id           | Foreign key to auth.users           |
| `email`        | TEXT      | students.email        | User email address                  |
| `full_name`    | VARCHAR   | students.full_name    | Student display name                |
| `avatar_emoji` | VARCHAR   | students.avatar_emoji | Student avatar                      |
| `eco_points`   | BIGINT    | students.eco_points   | **Primary ranking metric**          |
| `streak_days`  | INTEGER   | students.streak_days  | Consecutive days active             |
| `school_id`    | UUID      | students.school_id    | School affiliation                  |
| `role`         | VARCHAR   | students.role         | Always 'student' (filtered)         |
| `created_at`   | TIMESTAMP | students.created_at   | Account creation time               |
| `updated_at`   | TIMESTAMP | students.updated_at   | Last profile update                 |
| `rank`         | INTEGER   | **Generated**         | Dynamic rank (1=highest eco_points) |
| `total_users`  | INTEGER   | **Generated**         | Total students in system            |

---

## 🔄 How It Works

### Query: Get Top 10 Users

```sql
SELECT * FROM public.leaderboard LIMIT 10;
```

**Returns:** Top 10 students ordered by eco_points (descending)

---

### Query: Get User's Rank

```sql
SELECT rank, eco_points, total_users
FROM public.leaderboard
WHERE email = 'student@example.com';
```

**Returns:** User's rank, their eco_points, and total users in leaderboard

---

## 🛡️ Security & Access Control

| Who Can Access            | SELECT       | INSERT               | UPDATE               | DELETE               |
| ------------------------- | ------------ | -------------------- | -------------------- | -------------------- |
| **Unauthenticated users** | ✅ Read view | ❌                   | ❌                   | ❌                   |
| **Database admin**        | ✅           | ❌ (view, read-only) | ❌ (view, read-only) | ❌ (view, read-only) |
| **Authenticated users**   | ✅ Read view | ❌                   | ❌                   | ❌                   |

**Why?** The leaderboard is public rankings - everyone should see it. Data updates happen through the `students` table, not the leaderboard view.

---

## 🚀 Frontend Integration

### In `supabase-queries.ts`

```typescript
leaderboard: {
  // Get top 10 users
  async getTopUsers(limit = 10): Promise<QueryResult<GenericRecord[]>> {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .order('eco_points', { ascending: false })
      .limit(limit);

    return { data: data ?? [], error };
  },

  // Get user's rank/position
  async getRank(userId: string): Promise<QueryResult<GenericRecord>> {
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    return { data, error };
  }
}
```

### In Components

**Example: Display Top 3 Users**

```tsx
import { supabaseQueries } from "@/lib/supabase/supabase-queries";

export function LeaderboardCard() {
  const [topUsers, setTopUsers] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadLeaderboard = async () => {
      const { data, error } = await supabaseQueries.leaderboard.getTopUsers(3);

      if (error) {
        // Graceful error handling
        console.warn("Leaderboard unavailable:", error.message);
        setTopUsers([]); // Show empty state
        return;
      }

      setTopUsers(data);
    };

    void loadLeaderboard();
  }, []);

  if (error) {
    return <Text>Leaderboard loading...</Text>;
  }

  return (
    <View>
      {topUsers.map((user, index) => (
        <View key={user.id}>
          <Text>
            {index + 1}. {user.full_name}
          </Text>
          <Text>🌱 {user.eco_points} points</Text>
        </View>
      ))}
    </View>
  );
}
```

---

## 🔧 Troubleshooting

### Issue: Still getting "Could not find table" error after creating view

**Cause:** Schema cache not refreshed

**Fix:**

1. Go to Supabase SQL Editor
2. Click the **🔄 refresh** icon
3. Wait 5-10 seconds
4. Try the query again

---

### Issue: View is empty (no users showing)

**Causes:**

- No users in `students` table yet
- All students have `role != 'student'`
- No `eco_points` data

**Fix:**

```sql
-- Check if students table has data
SELECT COUNT(*) FROM public.students WHERE role = 'student';

-- Verify students have eco_points
SELECT email, eco_points FROM public.students WHERE role = 'student' LIMIT 5;
```

---

### Issue: Leaderboard not updating when eco_points change

**Cause:** Normal - views compute on-demand

**Behavior:**

- ✅ If you update a student's `eco_points`, the leaderboard automatically reflects it
- ✅ Rankings recalculate on every query
- ⚠️ If this becomes slow, switch to MATERIALIZED VIEW (cached snapshot)

---

## 📈 Performance Notes

### Current Setup (Regular VIEW)

- **Pros:** Always up-to-date, no data duplication
- **Performance:** Fast for small datasets (<10K students)
- **Indexes:** Two indexes provided for fast lookups

### Optimization: Switch to MATERIALIZED VIEW (if needed)

When leaderboard gets slow (>50K students or frequent queries):

```sql
-- Create materialized version
DROP VIEW IF EXISTS public.leaderboard;

CREATE MATERIALIZED VIEW public.leaderboard AS
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

-- Create unique index (required for materialized view refresh)
CREATE UNIQUE INDEX ON public.leaderboard (id);

-- Create index for faster queries
CREATE INDEX idx_leaderboard_eco_points ON public.leaderboard(eco_points DESC);

-- Refresh materialized view
REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard;
```

Then create a trigger to refresh on `students` updates:

```sql
CREATE OR REPLACE FUNCTION refresh_leaderboard_on_update()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_refresh_leaderboard
AFTER UPDATE ON public.students
FOR EACH ROW
EXECUTE PROCEDURE refresh_leaderboard_on_update();
```

---

## ✅ Verification Checklist

After setup, verify everything works:

```sql
-- ✅ 1. View exists
SELECT * FROM information_schema.views WHERE table_name = 'leaderboard';

-- ✅ 2. View has data
SELECT COUNT(*) FROM public.leaderboard;

-- ✅ 3. Can get top 10
SELECT * FROM public.leaderboard LIMIT 10;

-- ✅ 4. Indexes exist
SELECT indexname FROM pg_indexes WHERE tablename LIKE '%students%';

-- ✅ 5. Rankings work correctly
SELECT id, email, eco_points, rank FROM public.leaderboard LIMIT 5;
```

---

## 📚 Related Documentation

- [SUPABASE_SQL_SETUP.md](SUPABASE_SQL_SETUP.md) - Full SQL setup guide
- [FRONTEND_AUTH_GUIDE.md](FRONTEND_AUTH_GUIDE.md) - Frontend integration
- [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) - Complete setup checklist

---

## 🎯 Summary

| Item                    | Status         | Action                         |
| ----------------------- | -------------- | ------------------------------ |
| Leaderboard view        | ⏳ Needs setup | Run STEP 9 SQL                 |
| Leaderboard indexes     | ⏳ Needs setup | Run STEP 10 SQL                |
| Frontend error handling | ✅ Complete    | Already handles missing table  |
| Schema cache refresh    | ⏳ If needed   | Click refresh icon in Supabase |

**Next Step:** Copy and run the SQL from STEP 9 and STEP 10 in your [SUPABASE_SQL_SETUP.md](SUPABASE_SQL_SETUP.md) file.
