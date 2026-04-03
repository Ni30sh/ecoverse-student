# Testing Plan - Notification Privacy + Mission Redesign

## Test Environment Setup

### Prerequisites
- Staging database with migrations 10-14 applied
- 2+ test schools set up (MPGI, PSIT)
- 2+ teacher accounts (one per school)
- 2+ student accounts (one per school)
- 1 mission that requires teacher approval
- 1 mission without teacher approval

### Test Data
```
Teacher 1: email@mpgi.edu (school: MPGI)
Teacher 2: john@psit.edu (school: PSIT)
Student 1: alice@mpgi.edu (school: MPGI)
Student 2: bob@psit.edu (school: PSIT)
Mission A: Requires approval (50 points)
Mission B: Auto-approved (30 points)
```

---

## Test Suite 1: Notification Privacy Fix

### Test 1.1: Same-School Teacher Name Visibility
**Scenario**: Student sees notification from same-school teacher

**Steps**:
1. Login as Student 1 (MPGI)
2. Submit Mission A (requires approval)
3. Logout
4. Login as Teacher 1 (MPGI)
5. Approve Student 1's mission with feedback "Great work!"
6. Logout
7. Login as Student 1
8. Open notifications

**Expected Result**:
- Notification title: "Mission Approved"
- Notification body: "Great work!" (or similar feedback)
- Teacher name visible in body/title (e.g., "Teacher 1 approved" or similar)
- NO UUID visible anywhere

**Pass**: ✅ if teacher name visible, ❌ if UUID or "your teacher" shown

### Test 1.2: Cross-School Teacher Fallback
**Scenario**: Student sees fallback text for cross-school teacher

**Steps**:
1. Login as Student 2 (PSIT)
2. Submit Mission A (requires approval) [assuming approvers can be cross-school]
3. Logout
4. Login as Teacher 1 (MPGI, different school)
5. Approve Student 2's mission
6. Logout
7. Login as Student 2
8. Open notifications

**Expected Result**:
- Notification body: Contains "your teacher" instead of Teacher 1's name
- NO UUID visible
- NO cross-school identity leak

**Pass**: ✅ if "your teacher" shown, ❌ if UUID or Teacher 1's name shown

### Test 1.3: Multiple UUIDs in Notification
**Scenario**: Notification with multiple UUIDs all get replaced

**Steps**:
1. Login as Teacher 1
2. Manually create/craft a notification for Student 1 with multiple UUIDs in body
3. Login as Student 1
4. Open notifications

**Expected Result**:
- All UUIDs replaced with names or "your teacher"
- No partial replacements
- No malformed text

**Pass**: ✅ if all UUIDs replaced correctly

### Test 1.4: Notification Fields Sanitized
**Scenario**: Both title and body fields sanitized

**Steps**:
1. Create notification with UUID in title + body
2. Fetch via `getUserNotifications()`
3. Inspect response JSON

**Expected Result**:
- title field: no UUID
- body field: no UUID
- reviewed_by_name field: resolved name or empty

**Pass**: ✅ if both fields sanitized

---

## Test Suite 2: Mission Workflow

### Test 2.1: Start Mission Navigation
**Scenario**: Clicking "Start Mission" navigates to detail screen

**Steps**:
1. Login as Student 1
2. Navigate to Missions tab
3. Find Mission A
4. Tap "Start Mission"

**Expected Result**:
- Submission created in database (status: in_progress)
- Navigation to `/mission/[missionId]` detail screen
- Mission title displayed

**Pass**: ✅ if navigates and submission created, ❌ if error or stays on list

### Test 2.2: Load Mission Steps
**Scenario**: Detail screen loads and displays mission steps

**Steps**:
1. On Mission A detail screen
2. Wait for page to load

**Expected Result**:
- Mission metadata (title, description, points) loaded
- Steps list displayed (in correct order)
- Each step shows title, description, action button
- Step progress tracked (completed vs pending)

**Pass**: ✅ if steps visible and ordered, ❌ if missing or error

### Test 2.3: Submit Mission Step
**Scenario**: Student can mark step as complete

**Steps**:
1. On Mission A detail screen
2. Tap "Submit Step" on Step 1

**Expected Result**:
- Step marked as completed (visual feedback)
- Step progress saved to database
- Button changes to "Completed" or disabled

**Pass**: ✅ if step marked complete, ❌ if error

### Test 2.4: Location Validation
**Scenario**: Mission requiring location validation

**Steps**:
1. On Mission A detail screen (assumes requires_location = true)
2. Tap "Add Location" button
3. Tap "Submit Final Proof" WITHOUT adding location

**Expected Result**:
- Alert: "Location required"
- Proof NOT submitted

**Pass**: ✅ if alert shown and blocked, ❌ if submitted anyway

### Test 2.5: Step Completion Validation
**Scenario**: Cannot submit proof without completing all steps

**Steps**:
1. On Mission A detail screen (has 2 steps)
2. Complete Step 1 only
3. Tap "Submit Final Proof"

**Expected Result**:
- Alert: "Requirements pending" or "Complete all mission steps"
- Proof NOT submitted

**Pass**: ✅ if alert shown and blocked, ❌ if submitted anyway

### Test 2.6: Upload and Submit Proof
**Scenario**: Student submits final proof with photo

**Steps**:
1. Complete all mission steps
2. Add location (if required)
3. Upload photo via "Upload Photo" or "Use Camera"
4. Tap "Submit Final Proof"

**Expected Result**:
- Photo uploaded to mission-photos bucket
- Submission status updated (pending or approved depending on auto-approval)
- Confirmation message displayed
- Points awarded (if auto-approved)

**Pass**: ✅ if proof submitted and stored, ❌ if error

### Test 2.7: Rejected Submission Retry
**Scenario**: Student can retry after rejection

**Steps**:
1. Submit Mission B
2. Teacher rejects submission with feedback
3. Student views submission on detail screen
4. Tap "Resubmit" or similar

**Expected Result**:
- Submission reactivated to in_progress
- Student can re-upload proof
- Can resubmit

**Pass**: ✅ if resubmission allowed, ❌ if rejected permanently

### Test 2.8: Active Submission Persistence
**Scenario**: Navigating away and back preserves submission state

**Steps**:
1. Start Mission A
2. Navigate back to Missions list
3. Click on same mission again

**Expected Result**:
- Detail screen shows same submission
- Step progress preserved
- Can continue from where left off

**Pass**: ✅ if state preserved, ❌ if reset or duplicated submission

---

## Test Suite 3: Auth & Onboarding

### Test 3.1: School Selection on Signup
**Scenario**: School dropdown works and validates

**Steps**:
1. Open app, go to signup
2. Fill name, email, password
3. Tap school dropdown
4. Select "MPGI"
5. Tap "Create Account"

**Expected Result**:
- School field required (error if blank)
- Dropdown shows all options
- Selection saves to auth metadata
- Account created

**Pass**: ✅ if school selected and saved, ❌ if error or skipped

### Test 3.2: Profile Created with School Mapping
**Scenario**: New signup creates profile with school_id

**Steps**:
1. Signup with school "MPGI"
2. Verify in database

**Query**:
```sql
SELECT id, full_name, role, school_id FROM public.students WHERE email = 'new@student.com';
```

**Expected Result**:
- students row created with school_id (not null)
- profiles row created with school_id
- Both rows have same school_id

**Pass**: ✅ if school_id populated, ❌ if null

### Test 3.3: School Dropdown Options
**Scenario**: Only valid schools shown

**Steps**:
1. Open signup form
2. Tap school dropdown

**Expected Result**:
- Shows: MPGI, PSIT, KIT, KGI, AKTU
- No other options
- Clear visual design

**Pass**: ✅ if correct options shown

### Test 3.4: Profile Recovery on Signin
**Scenario**: User with missing profile can recover

**Steps**:
1. Manually delete a student's profile rows (for testing)
2. User attempts to signin
3. Auth provider calls recovery RPC
4. Query profile

**Expected Result**:
- No immediate error on signin
- Profile rows recreated
- Signin succeeds
- Telemetry logged for recovery attempt

**Pass**: ✅ if profile recovered, ❌ if error or permanent failure

### Test 3.5: Network Retry on Transient Failure
**Scenario**: Network failures retried automatically

**Steps**:
1. Simulate network timeout on first signin attempt (using dev tools)
2. Observe retry behavior
3. Signin should succeed on retry

**Expected Result**:
- Automatic retry after ~500ms
- No manual user intervention needed
- Success on retry

**Pass**: ✅ if retry succeeds, ❌ if fails immediately

---

## Test Suite 4: Integration Tests

### Test 4.1: End-to-End: Submit Mission to Approval
**Scenario**: Complete flow from signup to approval

**Steps**:
1. New student signs up with school MPGI
2. Login
3. View missions
4. Start Mission A
5. Complete all steps
6. Submit proof
7. Logout
8. Teacher logs in (MPGI)
9. Approve mission
10. Logout
11. Student logs in
12. Check notifications

**Expected Result**:
- Student sees "Mission Approved" notification
- No UUID in notification
- Teacher name visible
- Points awarded
- No errors at any step

**Pass**: ✅ if full flow succeeds, ❌ if any step fails

### Test 4.2: End-to-End: Cross-School Notification
**Scenario**: Cross-school approval shows fallback text

**Steps**:
1. Student 1 (MPGI) submits Mission A
2. Teacher 2 (PSIT) approves (if allowed)
3. Student 1 checks notifications

**Expected Result**:
- Notification shows "your teacher" (not Teacher 2's name)
- No UUID
- Notification still communicates approval clearly

**Pass**: ✅ if fallback shown, ❌ if UUID or cross-school name leaked

### Test 4.3: Concurrent Submissions
**Scenario**: Multiple students submitting same mission simultaneously

**Steps**:
1. Student 1, Student 2, Student 3 all start Mission A
2. Complete and submit within 1 minute of each other
3. Verify all submissions recorded

**Expected Result**:
- All submissions created
- No conflicts or overwrites
- Each submission has unique ID
- All can be approved independently

**Pass**: ✅ if all submissions recorded, ❌ if any lost or conflicted

---

## Test Suite 5: Error Scenarios

### Test 5.1: Invalid School on Signup
**Scenario**: Signup rejects invalid school

**Steps**:
1. Signup with school "INVALID"
2. Tap "Create Account"

**Expected Result**:
- Alert: "Please select a valid school"
- Signup blocked
- Form preserved for retry

**Pass**: ✅ if error shown, ❌ if allowed through

### Test 5.2: Network Error During Proof Upload
**Scenario**: Photo upload failure handled gracefully

**Steps**:
1. On Mission A detail screen
2. Disconnect network
3. Tap "Upload Photo"

**Expected Result**:
- Error alert or timeout
- No crash
- User can retry or try again

**Pass**: ✅ if error handled, ❌ if app crashes

### Test 5.3: Corrupt Profile Data
**Scenario**: Malformed profile data handled

**Steps**:
1. Manually insert profile with null required fields
2. User attempts to view profile

**Expected Result**:
- No crash
- Fallback display or error message
- App remains stable

**Pass**: ✅ if handled gracefully, ❌ if crash

---

## Test Automation Checklist

- [ ] Unit test: `extractUuidTokens()` with various UUID formats
- [ ] Unit test: `replaceReviewerIdsInText()` with nested UUIDs
- [ ] Integration test: Mission creation → step loading → proof submission
- [ ] Integration test: Signup → profile creation → school mapping
- [ ] E2E test: Full mission flow with notification approval
- [ ] E2E test: Cross-school notification flow

---

## Manual Verification Checklist

**Before shipping to production:**

- [ ] Notification privacy: ✅ No UUIDs visible
- [ ] Notification names: ✅ Same-school shows names
- [ ] Mission workflow: ✅ All steps complete and validate
- [ ] Auth signup: ✅ School selection working
- [ ] School mapping: ✅ Profiles have school_id
- [ ] Network resilience: ✅ Retries work on timeouts
- [ ] Performance: ✅ Notification queries < 2s
- [ ] Visual design: ✅ All screens look correct
- [ ] Backward compat: ✅ Old clients don't break

---

## Test Results Template

```
Date: _______________
Tester: _______________
Build: _______________

Test Suite 1: Notification Privacy
  [ ] Test 1.1: Same-school teacher name visibility ___
  [ ] Test 1.2: Cross-school teacher fallback ___
  [ ] Test 1.3: Multiple UUIDs in notification ___
  [ ] Test 1.4: Notification fields sanitized ___

Test Suite 2: Mission Workflow
  [ ] Test 2.1: Start mission navigation ___
  [ ] Test 2.2: Load mission steps ___
  [ ] Test 2.3: Submit mission step ___
  [ ] Test 2.4: Location validation ___
  [ ] Test 2.5: Step completion validation ___
  [ ] Test 2.6: Upload and submit proof ___
  [ ] Test 2.7: Rejected submission retry ___
  [ ] Test 2.8: Active submission persistence ___

Test Suite 3: Auth & Onboarding
  [ ] Test 3.1: School selection on signup ___
  [ ] Test 3.2: Profile created with school mapping ___
  [ ] Test 3.3: School dropdown options ___
  [ ] Test 3.4: Profile recovery on signin ___
  [ ] Test 3.5: Network retry on transient failure ___

Test Suite 4: Integration
  [ ] Test 4.1: End-to-end submit to approval ___
  [ ] Test 4.2: End-to-end cross-school notification ___
  [ ] Test 4.3: Concurrent submissions ___

Test Suite 5: Error Scenarios
  [ ] Test 5.1: Invalid school on signup ___
  [ ] Test 5.2: Network error during upload ___
  [ ] Test 5.3: Corrupt profile data ___

Overall Result: _____ (PASS / FAIL / CONDITIONAL)
Notes: _____________________________________________________
```

---

## Sign-Off

- [ ] QA Tester: __________________ Date: __________
- [ ] Product Owner: __________________ Date: __________
- [ ] Tech Lead: __________________ Date: __________

Ready for production: ☐ YES / ☐ NO / ☐ CONDITIONAL
