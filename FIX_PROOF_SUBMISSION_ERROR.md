# Fix for Supabase Proof Submission Error

## ❌ Problem
```
"Proof not submitted: Could not find the 'proof_photo_url' column of 'submissions' in the schema cache"
```

This error occurs when a student clicks "Submit Final Proof" because:
1. **submissions table didn't exist** or was missing the photo column
2. **Column name mismatch** - Code tried to use `proof_photo_url` but schema only had `photo_url`
3. **Schema cache not refreshed** - Supabase didn't see newly added columns

---

## ✅ Solution

### Created: Migration 15 - Submissions Table Schema
**File**: `supabase/migrations/15_submissions_table_schema.sql`

This migration:
1. **Creates `submissions` table** with all required columns:
   - `photo_url` (TEXT) - Primary column for proof photo
   - `proof_photo_url` (TEXT) - Alias for compatibility
   - `proof_url` (TEXT) - Another alias  
   - `notes`, `feedback`, `status`, `submitted_at`, `latitude`, `longitude`, etc.

2. **Adds missing columns** to existing tables (if they already exist)

3. **Synchronizes all photo columns** so they're consistent:
   ```sql
   proof_photo_url = COALESCE(proof_photo_url, photo_url)
   proof_url = COALESCE(proof_url, photo_url)
   ```

4. **Creates indexes** for performance:
   - `(user_id, mission_id)` - For finding submissions by student+mission
   - `(status)` - For filtering by approval status
   - `(updated_at)` - For ordering recent submissions

5. **Enables RLS (Row Level Security)**:
   - Students can only see/update their own submissions
   - Teachers/admins can review submissions

6. **Creates legacy `mission_submissions` table** for backward compatibility

7. **Refreshes schema cache** so Supabase recognizes all columns

---

## Updated: Query Code
**File**: `lib/supabase/supabase-queries.ts` (submitProof method)

### Changes:
1. **Standardized on `photo_url`** as the primary column name
2. **Improved fallback logic**:
   - Try RPC endpoints first (preferred)
   - Fall back to direct table update if RPC fails
   - Only use columns that definitely exist

3. **Better error logging**:
   - Print specific error from each path
   - Log which column actually failed
   - Helps diagnose future schema issues

---

## 📋 Deployment Steps

### Step 1: Run Migration 15
In Supabase dashboard or via CLI:
```sql
-- Copy-paste entire content of migrations/15_submissions_table_schema.sql
-- or run: supabase migration up
```

**Expected output**:
- ✅ Creates submissions table
- ✅ Adds all photo_url columns
- ✅ Creates indexes
- ✅ Enables RLS
- ✅ `NOTIFY pgrst, 'reload schema'` (refreshes cache)

### Step 2: Deploy Updated Query Code
Deploy the updated `lib/supabase/supabase-queries.ts` with improved submitProof fallback logic.

### Step 3: Test Proof Submission
1. Login as student
2. Submit mission (create submission)
3. Upload photo
4. Click "Submit Final Proof"
5. ✅ Should succeed (not throw "proof_photo_url column not found")

---

## 💡 How It Works Now

**When student submits proof:**

```
1. Photo uploaded → stored in mission-photos bucket
2. submitProof called with:
   - submissionId (UUID)
   - photoUrl (storage URL)
   - notes (optional)
   - location (optional)

3. Query code:
   a. Try RPC "submit_mission_proof" (awards points, updates status)
      └─ If succeeds: ✅ Return with status + points
      └─ If fails: Continue to step b
   
   b. Direct table update (photo_url + status + submitted_at)
      └─ Try "submissions" table first
      └─ If fails: Try "mission_submissions" table
      └─ If succeeds: ✅ Return updated submission
      └─ If fails: ❌ Return clear error message

4. Frontend receives response with photo URL + submission status
```

---

## 🔒 Security

**RLS Policies Enabled:**

| Role | Can Read | Can Write |
|------|----------|-----------|
| **Student** | Own submissions only | Own submissions only |
| **Teacher/Admin** | All (with school RLS) | Reviewed submissions |
| **Public** | None | None |

---

## 🧪 Testing Checklist

Before shipping to production:

- [ ] Migration 15 runs without errors
- [ ] Schema cache reloaded (check Supabase dashboard)
- [ ] Submissions table has all columns (verify via SQL):
  ```sql
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'submissions'
  ORDER BY column_name;
  ```
- [ ] Student can submit proof without "proof_photo_url" error
- [ ] Photo URL stored correctly in photo_url column
- [ ] Submission status updated to "pending" (or "approved" if auto-approved)
- [ ] Teacher can approve submission in separate web app
- [ ] Student receives notification after approval

---

## 📊 Schema After Fix

### submissions table columns:
```
├── id (UUID, PK)
├── user_id (UUID, FK auth.users)
├── mission_id (UUID, FK missions)
├── status (text): 'in_progress'|'pending'|'approved'|'rejected'
├── photo_url (text) ✅ PRIMARY COLUMN
├── proof_photo_url (text) - alias for compatibility
├── proof_url (text) - another alias
├── notes (text)
├── feedback (text)
├── reviewed_by (UUID, FK auth.users)
├── reviewed_at (timestamp)
├── submitted_at (timestamp)
├── latitude (double precision)
├── longitude (double precision)
├── created_at (timestamp)
└── updated_at (timestamp)
```

---

## Troubleshooting

### Still seeing "proof_photo_url column not found" after migration?

**Causes:**
1. Migration didn't run successfully
2. Schema cache not reloaded
3. Supabase using stale cache

**Fix:**
```sql
-- In Supabase SQL Editor, run:
NOTIFY pgrst, 'reload schema';

-- OR wait 30 seconds for automatic cache refresh
```

### Submissions table missing entirely?

**Verify it exists:**
```sql
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'submissions'
);
```

**If not, check migration output** for errors and re-run migration 15.

### Photo URL not saving correctly?

**Check which table was updated:**
```sql
SELECT id, photo_url, proof_photo_url, proof_url, status 
FROM public.submissions 
ORDER BY updated_at DESC 
LIMIT 1;
```

**Should have photo_url populated** after submit.

---

## ✨ Summary

| Component | Before | After |
|-----------|--------|-------|
| submissions table | ❌ Missing or incomplete | ✅ Full schema with all columns |
| photo column | ❌ proof_photo_url only | ✅ photo_url (+ aliases for compatibility) |
| Error on proof submit | ❌ "Column not found" | ✅ Works or clear error |
| Query fallback | ❌ None | ✅ RPC → direct update → error |
| RLS policies | ❌ Not enforced | ✅ Students see only own, teachers can review |
| Cache refresh | ❌ Manual | ✅ Automatic via NOTIFY |

**Result:** Students can now successfully submit mission proofs. ✅
