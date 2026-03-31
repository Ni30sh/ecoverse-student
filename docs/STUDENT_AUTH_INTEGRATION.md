# Student Auth Hook Integration Guide

## Overview

The `use-auth.ts` hook provides a **student-only** authentication system for the Ecoverse mobile app. It's built specifically for student users with role hard-coded to `'student'`.

## Key Features

✅ **Student-Only**: Designed exclusively for student users  
✅ **Supabase Integrated**: Built on Supabase auth & database  
✅ **Mobile Optimized**: Works perfectly in Expo/React Native  
✅ **Profile Management**: Auto-creates & syncs student profiles  
✅ **Error Handling**: Comprehensive error tracking & logging  
✅ **Type Safe**: Full TypeScript support  
✅ **Caching**: Smart session caching

## Setup

### 1. Wrap Your App with StudentAuthProvider

In your root layout (`app/_layout.tsx` or equivalent):

```tsx
import { StudentAuthProvider } from "@/hooks/use-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/integrations/react-query";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StudentAuthProvider>
        {/* Your app routes and components */}
      </StudentAuthProvider>
    </QueryClientProvider>
  );
}
```

Or use the convenience wrapper:

```tsx
import { AppAuthWrapper } from "@/components/app-auth-wrapper";

export default function RootLayout() {
  return <AppAuthWrapper>{/* Your app routes */}</AppAuthWrapper>;
}
```

### 2. Use the Hooks in Your Components

## Core Hooks

### `useAuth()` - Main Authentication Hook

Access the complete auth context:

```tsx
import { useAuth } from "@/hooks/use-auth";

export function StudentDashboard() {
  const {
    user, // { id, email, user_metadata }
    session, // { user, token }
    profile, // Student profile with eco_points, etc
    loading, // Auth is initializing
    error, // Any auth errors
    isAuthenticated,
    signUp,
    signIn,
    signOut,
    refreshProfile,
    updateProfile,
  } = useAuth();

  if (loading) return <ActivityIndicator />;
  if (!isAuthenticated) return <LoginScreen />;

  return (
    <View>
      <Text>Welcome, {profile?.full_name}!</Text>
      <Text>Eco Points: {profile?.eco_points}</Text>
    </View>
  );
}
```

### `useAuthSession()` - Session Only

Lightweight hook for just session info:

```tsx
import { useAuthSession } from "@/hooks/use-auth";

export function AuthGuard() {
  const { isAuthenticated, isLoading } = useAuthSession();

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <RedirectToLogin />;

  return <ProtectedContent />;
}
```

### `useStudentProfile()` - Profile Only

Access just the student profile:

```tsx
import { useStudentProfile } from "@/hooks/use-auth";

export function ProfileCard() {
  const { profile, isLoading, refreshProfile } = useStudentProfile();

  return (
    <View>
      <Text>
        {profile?.avatar_emoji} {profile?.full_name}
      </Text>
      <Text>School: {profile?.school_name}</Text>
      <Button title="Refresh" onPress={() => refreshProfile()} />
    </View>
  );
}
```

## Authentication Flows

### Sign Up (New Student)

```tsx
import { useAuth } from "@/hooks/use-auth";

export function SignUpScreen() {
  const { signUp } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    setLoading(true);
    const { error, needsEmailConfirmation } = await signUp(
      "student@school.com",
      "SecurePassword123",
      "John Doe",
      "Lincoln High School", // optional
    );

    if (error) {
      Alert.alert("Sign Up Error", error.message);
    } else if (needsEmailConfirmation) {
      Alert.alert("Verify Email", "Check your email to confirm");
    } else {
      // Already logged in
      navigation.replace("StudentDashboard");
    }
    setLoading(false);
  };

  return (
    <ScrollView>
      {/* Form fields */}
      <Button
        title={loading ? "Signing up..." : "Sign Up"}
        onPress={handleSignUp}
        disabled={loading}
      />
    </ScrollView>
  );
}
```

### Sign In (Existing Student)

```tsx
import { useAuth } from "@/hooks/use-auth";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    const { error } = await signIn(email, password);

    if (error) {
      Alert.alert("Login Error", error.message);
    } else {
      // Logged in successfully
      navigation.replace("StudentDashboard");
    }
    setLoading(false);
  };

  return (
    <View>
      <TextInput
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        editable={!loading}
      />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />
      <Button
        title={loading ? "Logging in..." : "Login"}
        onPress={handleLogin}
        disabled={loading}
      />
    </View>
  );
}
```

### Update Student Profile

```tsx
import { useAuth } from "@/hooks/use-auth";

export function EditProfileScreen() {
  const { profile, updateProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [schoolName, setSchoolName] = useState(profile?.school_name || "");
  const [city, setCity] = useState(profile?.city || "");
  const [loading, setLoading] = useState(false);

  const handleUpdate = async () => {
    setLoading(true);
    const { error } = await updateProfile({
      full_name: fullName,
      school_name: schoolName,
      city: city,
    });

    if (error) {
      Alert.alert("Update Error", error.message);
    } else {
      Alert.alert("Success", "Profile updated!");
      navigation.goBack();
    }
    setLoading(false);
  };

  return (
    <View>
      <TextInput
        value={fullName}
        onChangeText={setFullName}
        placeholder="Full Name"
      />
      <TextInput
        value={schoolName}
        onChangeText={setSchoolName}
        placeholder="School Name"
      />
      <TextInput value={city} onChangeText={setCity} placeholder="City" />
      <Button
        title={loading ? "Updating..." : "Update Profile"}
        onPress={handleUpdate}
        disabled={loading}
      />
    </View>
  );
}
```

### Sign Out

```tsx
import { useAuth } from "@/hooks/use-auth";

export function ProfileMenu() {
  const { signOut } = useAuth();

  const handleLogout = async () => {
    const { error } = await signOut();
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      // Navigate to login
      navigation.replace("Login");
    }
  };

  return <Button title="Logout" onPress={handleLogout} />;
}
```

## Student Profile Structure

```typescript
interface StudentProfile {
  id: string; // User ID
  full_name: string; // Student's name
  avatar_emoji: string; // Display emoji (🌱, 🌿, etc)
  eco_points: number; // Total earned points
  streak_days: number; // Login streak
  last_active_date: string | null; // Last activity date
  interests: string[]; // Student interests
  daily_goal: number; // Daily points goal
  school_name: string; // School name
  city: string; // City location
  created_at: string; // Account creation date
}
```

## Error Handling

All auth functions return errors in a standardized way:

```tsx
const { error: signUpError } = await signUp(...);
const { error: signInError } = await signIn(...);
const { error: updateError } = await updateProfile(...);
const { error: refreshError } = await refreshProfile(...);
const { error: signOutError } = await signOut();

// Check the auth context error
const { error: contextError } = useAuth();
```

Errors include:

- `Missing required signup fields`
- `Invalid email format`
- `Password must be at least 6 characters`
- `Email and password required`
- `Invalid email or password`
- `Not authenticated`
- `Signup already in progress`
- `Login already in progress`
- And more...

## Protected Routes

Wrap routes that require authentication:

```tsx
import { useAuth } from "@/hooks/use-auth";

export function StudentDashboardStack() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!isAuthenticated) return <LoginStack />;

  return <DashboardStack />;
}
```

## Integrating with Other Hooks

Use auth context with other data hooks:

```tsx
import { useAuth } from "@/hooks/use-auth";
import { useLeaderboardData } from "@/hooks/use-leaderboard-data";
import { useMissionProgress } from "@/hooks/use-mission-progress";

export function StudentHub() {
  const { profile } = useAuth();
  const leaderboard = useLeaderboardData("this_week", "my_school");
  const missionProgress = useMissionProgress(missionId);

  return (
    <View>
      <Text>Rank: {leaderboard.currentUserEntry?.rank}</Text>
      <Text>Progress: {missionProgress.progressPercentage}%</Text>
    </View>
  );
}
```

## Key Differences from Original

- ✅ **Student-only**: No role/teacher/admin support
- ✅ **Simplified context**: Only student-relevant fields
- ✅ **No role updates**: Student role is fixed
- ✅ **Focused dashboard**: One `/student-dashboard` path
- ✅ **Mobile optimized**: Callback memoization, lighter context
- ✅ **Better error handling**: Consistent error returns
- ✅ **Improved logging**: Debug-friendly console logs

## Best Practices

1. **Check `loading` state** before rendering protected content
2. **Handle errors** from every async function
3. **Use `useAuthSession()`** for simple auth checks
4. **Use `useStudentProfile()`** for profile-only components
5. **Call `refreshProfile()`** after user-facing changes
6. **Wrap app with `StudentAuthProvider`** at root level
7. **Test offline**: Auth persists via session storage

## Database Schema Requirements

Your Supabase `profiles` table needs:

```sql
- id (UUID, PRIMARY KEY, FK auth.users.id)
- full_name (text)
- avatar_emoji (text)
- eco_points (integer)
- streak_days (integer)
- last_active_date (timestamp)
- interests (text[])
- daily_goal (integer)
- school_id (UUID, FK schools.id)
- school_name (text)
- city (text)
- role (text, default 'student')
- created_at (timestamp)
- updated_at (timestamp)
```

And `schools` table:

```sql
- id (UUID, PRIMARY KEY)
- name (text, UNIQUE)
- created_at (timestamp)
```

## Troubleshooting

| Problem                                           | Solution                                      |
| ------------------------------------------------- | --------------------------------------------- |
| "useAuth must be used within StudentAuthProvider" | Wrap app with `<StudentAuthProvider>`         |
| Auth state not persisting                         | Supabase sessions auto-persist; check storage |
| Profile not loading                               | Call `refreshProfile()` manually              |
| Email confirmation needed                         | Check user's email inbox                      |
| Role not 'student'                                | Role is auto-set; contact admin if issue      |

## Mobile Optimizations

- ✅ Reduced re-renders with `useCallback`
- ✅ Memoized context values
- ✅ Session persistence via Supabase SDK
- ✅ In-flight request deduplication
- ✅ Efficient error handling
- ✅ Mobile-friendly validation

---

**Created**: April 1, 2026  
**Version**: 1.0.0  
**Platforms**: Expo, React Native, Web
