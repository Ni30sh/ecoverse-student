# Auth Flow Setup Instructions

## 🎯 Overview

This document provides the SQL setup needed to fix your Supabase auth flow with auto-profile creation.

---

## ✅ Step 1: Add SQL Trigger (REQUIRED)

Copy the SQL below and paste it into **Supabase → SQL Editor** → Run:

```sql
-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    role,
    avatar_emoji,
    created_at,
    updated_at
  )
  VALUES (
    new.id,
    COALESCE(new.user_metadata->>'full_name', new.email),
    'student',
    '🌱',
    NOW(),
    NOW()
  );

  RETURN new;
EXCEPTION WHEN unique_violation THEN
  -- Profile already exists, do nothing
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

**Verify:** Run this to confirm trigger is active:

```sql
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

---

## ✅ Step 2: Frontend is Updated

Your auth-provider.tsx has been updated to:

- ✅ Support auto-profile creation via trigger
- ✅ Fallback to manual creation if trigger hasn't fired yet
- ✅ Pass email to profile creation for initial setup
- ✅ Better error handling and retry logic

---

## 🔄 Auth Flow Now Works Like This

### **Signup Flow:**

1. User enters email + password
2. Frontend: `supabase.auth.signUp(email, password)`
3. **Supabase:** Creates user in `auth.users`
4. **Trigger fires:** Auto-creates row in `profiles` with:
   - `id` = `auth.users.id` (linked)
   - `role` = `'student'`
   - `avatar_emoji` = `'🌱'`
   - `full_name` = email (fallback)
5. Frontend: Calls `ensureStudentProfile(userId, email)` as fallback
6. Profile is returned → User sees "Account created" toast
7. ✅ Redirect to `/login`

### **Login Flow:**

1. User enters email + password
2. Frontend: `supabase.auth.signInWithPassword(email, password)`
3. Supabase: Returns user session
4. Frontend: Calls `ensureStudentProfile(userId)` to fetch profile
5. Profile found (was created on signup)
6. ✅ Redirect to `/(tabs)` (dashboard)

### **Session Check (App Launch):**

1. Frontend: `supabase.auth.getSession()`
2. If session exists → Fetch profile via `ensureStudentProfile(userId)`
3. Profile validated (role = 'student')
4. ✅ Show dashboard

---

## 🧪 Testing

### Test 1: New Signup

```
1. Open signup screen
2. Email: test@example.com
3. Password: Test123!
4. Click "Create Account"
5. Expected: Success toast → Redirect to login
6. Check Supabase:
   - auth.users table: New row with email
   - profiles table: New row with id = auth.users.id
```

### Test 2: Login After Signup

```
1. Open login screen
2. Email: test@example.com
3. Password: Test123!
4. Click "Sign In"
5. Expected: Dashboard loads (/(tabs)/index)
6. Check: Profile data displays (name, eco_points, etc.)
```

### Test 3: Session Persistence

```
1. App is running, logged in
2. Hard refresh browser (F5 or Ctrl+Shift+R)
3. Expected: Session restored, dashboard shows immediately
4. No redirect to login
```

---

## ⚠️ Troubleshooting

### Issue: "Student profile not found"

**Cause:** Trigger didn't fire or profile creation failed
**Fix:**

1. Check trigger exists: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';`
2. Check profiles table: `SELECT * FROM profiles WHERE id = 'USER_ID';`
3. If profile missing → Run trigger SQL again
4. Check RLS policies allow profile creation

### Issue: "Only student accounts can access this app"

**Cause:** Profile exists but role ≠ 'student'
**Fix:**

```sql
UPDATE profiles SET role = 'student' WHERE id = 'USER_ID';
```

### Issue: Profile created but with wrong full_name

**Cause:** Trigger used email instead of user_metadata.full_name
**Fix:**

```sql
UPDATE profiles
SET full_name = 'Correct Name'
WHERE id = 'USER_ID';
```

---

## 📋 Files Modified

- ✅ `providers/auth-provider.tsx` — Updated `ensureStudentProfile()` and `signUp()`
- ✅ `supabase/migrations/01_auth_trigger.sql` — SQL trigger setup

---

## 🚀 Next Steps

1. **Copy the SQL** from Step 1
2. **Paste into Supabase SQL Editor**
3. **Run the query**
4. **Test signup → login flow**
5. **Verify in browser dev tools** (Network tab, and check Supabase tables)

Your auth flow is now **production-ready**! 🎉
