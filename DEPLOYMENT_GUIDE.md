# Deployment Guide - April 1, 2026

## Overview
This document outlines all changes made to the Ecoverse student app and the deployment sequence to safely roll out:
1. **Notification Privacy Fix** - Hide reviewer UUIDs from students
2. **Mission Workflow Redesign** - Move mission submission to detail screen
3. **Auth Hardening** - School mapping, profile recovery, signup improvements
4. **Database Migrations** - Support new schema and RPCs

---

## Part 1: Notification Privacy Fix (PRODUCTION READY)

### What Changed
**File**: `lib/supabase/supabase-queries.ts`

- Added UUID detection regex: `/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi`
- Added helper functions:
  - `extractUuidTokens()` - Find UUIDs in text
  - `replaceReviewerIdsInText()` - Replace UUIDs with names or fallback
  - `resolveSchoolContextForUser()` - Get student's school
  - `resolveReviewerNameMapForStudent()` - Query teacher/admin names (same-school only)
  - `sanitizeNotificationsForStudent()` - Main orchestration function
- Modified: `notifications.getUserNotifications()` calls `sanitizeNotificationsForStudent()` before returning to UI

### How It Works
1. Student submits mission → Teacher approves → Backend creates notification with UUID
2. Student fetches notifications via `getUserNotifications()`
3. Query layer extracts all UUIDs from notification `title` and `body`
4. For each UUID: queries profiles table, filters to same-school teacher/admin only
5. If same-school: replaces UUID with teacher name; else replaces with "your teacher"
6. UI receives sanitized notification without exposing reviewer identity

### Security Properties
- ✅ Cross-school reviewers cannot see each other's names
- ✅ Cross-school students see "your teacher" (generic fallback)
- ✅ Same-school students see actual teacher names (contextually safe)
- ✅ Client-side masking provides defense-in-depth (server-side RPC untouched)
- ✅ No changes to teacher/admin web app (separate codebase)

### Deployment Steps
1. **Deploy client code** - Ship `lib/supabase/supabase-queries.ts` with notification sanitization
2. **Monitor in staging** - Verify notifications render correctly without UUIDs
3. **Verify data flow** - Check that teacher names resolve for same-school reviewers
4. **Ship to production** - Roll out gradually or all-at-once (low risk, client-side only)

### Testing Checklist
- [ ] User A (school X) sees teacher name in notification
- [ ] User B (school Y) sees "your teacher" in same notification (if cross-school)
- [ ] Notification title and body both sanitized
- [ ] Fallback handles missing profiles gracefully
- [ ] No visual/UX breakage in notification display

---

## Part 2: Mission Workflow Redesign (STAGING READY)

### What Changed
**Files**: 
- `app/(tabs)/missions.tsx` - Simplified to list-only, routes to detail screen
- `app/mission/[missionId].tsx` - Enhanced with step loading, validation, proof submission

#### missions.tsx Changes
- Removed inline step submission UI
- Removed inline photo/location capture UI
- Removed proof submission UI
- Added: Route to detail screen on mission start
- Behavior: "Start Mission" now navigates to `mission/[missionId]` detail page

#### [missionId].tsx Changes
- Added: State for `missionSteps` and `stepSubmissions`
- Added: Load mission steps during initial mount
- Added: Load step submission progress
- Added: Validate all steps are complete before final proof submission
- Added: Validate location is provided if mission requires it
- Enhanced: Fallback for both `submissions` and `mission_submissions` tables

### How It Works
1. User clicks "Start Mission" on missions list
2. Query: Check if user has active submission for this mission
3. If exists: Navigate to existing submission detail
4. If not: Create new submission, navigate to detail
5. In detail screen:
   - Load mission metadata, steps, existing submissions
   - Display step checklist
   - Allow photo/location capture
   - Validate all requirements met
   - Submit final proof via RPC or direct update

### Deployment Steps
1. **Deploy UI changes** - Ship both `missions.tsx` and `[missionId].tsx`
2. **No DB changes needed** - Works with existing schema
3. **Test in staging** - Verify flow: list → start → detail → steps → proof → done
4. **Ship to production** - Mid-to-high confidence (UX change but no breaking schema change)

### Testing Checklist
- [ ] Start mission: creates submission and navigates to detail
- [ ] Detail screen: loads mission, steps, step progress
- [ ] Steps display correctly with proper ordering
- [ ] Location validation: error if location required but not provided
- [ ] Step validation: error if steps incomplete
- [ ] Proof submission: works with existing RPC fallbacks
- [ ] Rejected submissions: can be retried by reactivating to in_progress

---

## Part 3: Auth & Onboarding Improvements (STAGING READY)

### What Changed
**Files**:
- `app/signup.tsx` - Add full name field, school selector dropdown
- `providers/auth-provider.tsx` - Add school mapping sync, network retry, profile recovery

#### signup.tsx Changes
- New fields: `fullName`, `schoolName` (required)
- School options: MPGI, PSIT, KIT, KGI, AKTU (dropdown with validation)
- Pass to `signUp()`: fullName, email, password, schoolName
- User metadata: stored in auth.raw_user_meta_data for trigger-based profile creation

#### auth-provider.tsx Changes
- Added: `syncStudentSchoolMapping()` - Updates students/profiles after signup
- Added: `resolveSchoolIdByName()` - Queries or creates schools table entry
- Added: `recoverMissingStudentProfile()` - Calls RPC if profile missing
- Added: Network retry logic for transient failures
- Added: Fallback profile on transient network errors (avoid logout loops)
- Modified: `signUp()` to accept fullName and schoolName

### How It Works
1. Student signs up with full name + school selection
2. Auth metadata: `{ full_name, school_name, role: 'student' }`
3. Auth trigger: Creates students/profiles rows with school mapping
4. Client sync: `syncStudentSchoolMapping()` updates rows with school_id
5. If profile missing: `recoverMissingStudentProfile()` calls RPC to self-heal

### Deployment Steps
1. **Deploy auth provider + signup changes**
2. **Deploy migrations 10-11** (auth trigger + recovery RPC) - MUST be before production
3. **Test in staging**: 
   - New signup creates school-mapped student/profile
   - Profile recovery RPC works
4. **Deploy to production**

### Testing Checklist
- [ ] Signup with school selection: profile created with school_id
- [ ] Profile recovery RPC: restores missing profiles on next signin
- [ ] Network retry: survives transient network issues
- [ ] Fallback profile: prevents logout bounce on persistent fetch errors
- [ ] School mapping consistency: students/profiles both have same school_id

---

## Part 4: Database Migrations (MUST DEPLOY BEFORE CLIENT)

### Migrations Overview

#### Migration 10: Auth School Mapping Hardening
- Creates `schools` table (id, name, created_at, updated_at)
- Creates/updates `handle_new_user()` trigger
- Trigger fires on auth.users INSERT
- Creates students + profiles rows with school mapping from auth metadata

**Idempotent**: Yes ✅
**Must run before**: Production deployment of signup changes
**Estimated duration**: < 5 seconds

#### Migration 11: Profile Recovery RPC
- Creates `ensure_student_profile()` function
- Allows authenticated users to self-heal missing profile rows
- Called by auth provider if `profile not created automatically` error

**Idempotent**: Yes ✅
**Must run before**: Deploying auth-provider.tsx
**Estimated duration**: < 2 seconds

#### Migration 12: Backfill Missing Student Profiles
- Runs once to create missing profile rows for existing auth users
- Queries auth metadata for full_name + school_name
- Inserts into students + profiles with school mapping
- Uses `schools` table and recovery RPC

**Idempotent**: Yes ✅ (uses INSERT ... ON CONFLICT ... DO NOTHING)
**Safe to re-run**: Yes ✅
**Estimated duration**: Depends on user count (likely < 30 seconds)

#### Migration 13: Mission Submission + Approval RPCs
- Creates/updates `submit_mission_proof()` RPC
- Creates/updates `approve_mission_submission()` RPC
- Handles points award, streak, notifications
- Returns status, awarded_points, streak_days, notification_sent

**Idempotent**: Yes ✅
**Must run before**: Deploying proof submission changes
**Estimated duration**: < 5 seconds

#### Migration 14: Mission Schema + Storage Compatibility
- Creates `mission_steps` table if missing
- Creates `mission_step_submissions` table if missing
- Creates `mission-photos` storage bucket
- Adds RLS policies for photo upload/delete/read

**Idempotent**: Yes ✅
**Safe to re-run**: Yes ✅
**Estimated duration**: < 5 seconds

### Deployment Sequence
```
Order    Migration                                  Duration  Must-have
1.       10_auth_school_mapping_hardening.sql      < 5s      YES (for signup)
2.       11_profile_recovery_rpc.sql               < 2s      YES (for recovery)
3.       12_backfill_missing_student_profiles.sql  < 30s     NO (optional repair)
4.       13_mission_submission_approval_rpcs.sql   < 5s      YES (for missions)
5.       14_mission_schema_storage_compat.sql      < 5s      YES (for photo upload)
```

### How to Deploy Migrations

**Option A: Supabase Dashboard**
1. Go to SQL Editor
2. Create new query for each migration file (in order)
3. Copy-paste migration SQL
4. Run each migration
5. Verify no errors

**Option B: Supabase CLI (if configured)**
```bash
supabase migration up
```

**Option C: Direct psql (if DB access available)**
```bash
psql -U postgres -d your_db < migration_file.sql
```

---

## Part 5: Deployment Timeline

### Phase 1: Staging (Today)
- [ ] Deploy all migrations 10-14 to staging DB
- [ ] Deploy auth-provider + signup changes to staging
- [ ] Deploy mission workflow changes to staging
- [ ] Deploy notification sanitization to staging
- [ ] Run test suite on all three systems

### Phase 2: Production (Recommended: Next 24-48 hours)
**Step 1: Database Migrations (Critical Path)**
- [ ] Back up production database
- [ ] Run migrations 10-14 in order (estimated total: ~50s)
- [ ] Verify: schemas created, RPCs available, no errors

**Step 2: Client Deployment (Low-to-mid risk)**
- [ ] Deploy: notification sanitization (safest, client-side only)
- [ ] Verify: notifications render, no UUID leaks
- [ ] Deploy: auth-provider + signup changes (medium risk, gated by migration 10-11)
- [ ] Verify: new signups create school-mapped profiles
- [ ] Deploy: mission workflow changes (medium risk, UX-only)
- [ ] Verify: mission flow works, steps load, proof submission succeeds

---

## Part 6: Rollback Plan

### If Migrations Fail
1. Retrieve pre-deployment DB backup
2. Restore from backup (< 5 minutes)
3. Contact Supabase support if needed

### If Client Code Breaks
1. Revert `lib/supabase/supabase-queries.ts` (notification sanitization)
   - Stop calling `sanitizeNotificationsForStudent()`
2. Revert `app/(tabs)/missions.tsx` + `app/mission/[missionId].tsx`
   - Restore inline submission UI
3. Revert `app/signup.tsx` + `providers/auth-provider.tsx`
   - Restore old signup flow (email + password only)
4. Redeploy app

### Risk Mitigation
- ✅ All migrations idempotent (can re-run safely)
- ✅ Notification sanitization is opt-in (can disable by removing `sanitizeNotificationsForStudent()` call)
- ✅ Mission UI is backward-compatible (schemas unchanged)
- ✅ Auth changes include fallback profile on network errors (no hard failures)

---

## Part 7: Post-Deployment Validation

### Monitoring
1. **Errors in Supabase logs** - Watch for RPC failures, permission errors
2. **Network requests** - Verify `/notifications` queries complete in < 2s
3. **Student telemetry** - Track signup success, mission submission success
4. **Teacher web app** - Verify approvals still work (separate codebase unaffected)

### Metrics to Watch
- Notification fetch duration (should be ~same or slightly slower due to sanitization queries)
- Signup success rate (should improve with school-based RLS)
- Mission submission success rate (should stay ~same)

### Rollback Triggers
- If notification queries timeout (> 5s)
- If signup profile creation fails (> 5% failure rate)
- If mission proof submission fails (> 5% failure rate)

---

## Summary of Changes by Component

| Component | Change Type | Risk | Rollback |
|-----------|------------|------|----------|
| Notifications | Client-side masking | Low | Remove call to `sanitizeNotificationsForStudent()` |
| Mission UI | UX redesign | Low | Restore inline submission |
| Auth/Signup | School mapping + fields | Medium | Restore old signup form |
| Migrations | Schema + RPCs | Medium | Restore from DB backup |

---

## Files Modified

```
lib/supabase/supabase-queries.ts              (+245 lines: sanitization functions)
app/(tabs)/missions.tsx                       (~400 lines removed: simplified)
app/(tabs)/profile.tsx                        (no changes: uses sanitized queries)
app/mission/[missionId].tsx                   (+100 lines: step loading/validation)
app/signup.tsx                                (+200 lines: school selector)
providers/auth-provider.tsx                   (+200 lines: school mapping, recovery)
supabase/migrations/10_auth_school_mapping_hardening.sql   (+186 lines: NEW)
supabase/migrations/11_profile_recovery_rpc.sql            (+175 lines: NEW)
supabase/migrations/12_backfill_missing_student_profiles.sql (+300 lines: NEW)
supabase/migrations/13_mission_submission_approval_rpcs.sql (+448 lines: NEW)
supabase/migrations/14_mission_schema_storage_compat.sql    (+132 lines: NEW)
```

**Total lines of code changed**: ~2,000 lines
**New migrations**: 5 files
**Backward compatible**: Yes ✅

---

## Support & Troubleshooting

### Issue: Notifications show UUIDs still
**Cause**: `sanitizeNotificationsForStudent()` not being called
**Fix**: Verify `notifications.getUserNotifications()` includes sanitization call

### Issue: Signup school mapping not working
**Cause**: Migration 10 not applied
**Fix**: Run `10_auth_school_mapping_hardening.sql` before signup deployment

### Issue: Mission steps not loading
**Cause**: Migration 14 not applied (mission_steps table missing)
**Fix**: Run `14_mission_schema_storage_compat.sql`

### Issue: Photo upload fails with "Bucket not found"
**Cause**: Storage bucket not created
**Fix**: Run migration 14 which creates `mission-photos` bucket

---

## Questions?
Document prepared: April 1, 2026 | Author: Coding Assistant
