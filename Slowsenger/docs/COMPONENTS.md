# Slowsenger – Component documentation

The application is built from Angular 21.x standalone components. There is no `NgModule`: every component declares its own dependencies in its `imports` array.

---

## Component tree

```
App (app-root)
├── GlobalLoader              – Full-screen loader (app init)
├── ToastComponent            – Global notification (toast) overlay
└── RouterOutlet
    ├── Login                 – Login page
    ├── Regist                – Registration page
    └── Dashboard
        ├── UserList          – Thread list (Inbox, labels, search, delete)
        └── Chat              – Chat window
            └── [Profile]     – Profile modal (overlay)
```

---

## Components

### `App` (`app-root`)
**File**: `src/app/app.ts`  
**Role**: The root of the application. Checks the Supabase session at startup, then shows the global loader or the router outlet. Contains the global `<app-toast>` notification.

---

### `GlobalLoader`
**File**: `src/app/pages/global-loader/global-loader.ts`  
**Role**: Full-screen loading animation until the Supabase session has loaded.

---

### `ToastComponent`
**File**: `src/app/core/toast/toast.component.ts`  
**Role**: Global notification overlay. Reads the list of toasts from `ToastService` (Signal) and shows them in a `position: fixed` layout. They disappear on click or automatically (after 3 s).

---

### `Login`
**File**: `src/app/pages/auth/login/login.ts`  
**Role**: Login form. E-mail + password. Calls `SlowsengerDataService.signIn()`, and after a successful login redirects to `/dashboard`.

---

### `Regist`
**File**: `src/app/pages/auth/regist/regist.ts`  
**Role**: Registration form with ReactiveFormsModule. Shows validation errors inline. Calls `SlowsengerDataService.registerWithProfile()`.

---

### `Dashboard`
**File**: `src/app/pages/dashboard/dashboard.ts`  
**Role**: The main layout component. Handles switching views on mobile (list ↔ chat), opening and closing the profile modal, and the selected user (`selectedUser`).

---

### `UserList`
**File**: `src/app/pages/dashboard/user-list/user-list.ts`  
**Role**: The list of chat threads. Main features:
- **Loading**: `forkJoin` to fetch threads and profiles in parallel
- **Search**: `searchTerm` Signal + `computed` `filteredUsers`, live filtering by name/username
- **Labels**: creating your own labels, assigning one label per conversation, filtering by label
- **Unread marker**: based on `thread_read_at`
- **Delete**: with a confirmation dialog, `deleteThread()` service call
- **New message modal**: starting a new chat by username (`findProfileByUsername()`)

**Emitted events**: `chatSelected(AppUserSummary)`, `settingsClicked()`

---

### `Chat`
**File**: `src/app/pages/dashboard/chat/chat.ts`  
**Role**: The chat window. Main features:
- **`effect()`**: when the `selectedUser` input Signal changes, loads the messages and subscribes to the Realtime channel automatically
- **Realtime**: a Supabase `postgres_changes` channel on the `unified_messages` table; the message list is a Signal, so it updates in zoneless mode too
- **Sending**: `sendDirectMessage()`
- **Swipe**: showing timestamps by touch (`translateX`)
- **Cleanup**: `DestroyRef.onDestroy` + `messagesSubscription.unsubscribe()`

**Input**: `selectedUser: Signal<AppUserSummary | null>`  
**Emitted event**: `backClicked()`

---

### `Profile`
**File**: `src/app/pages/dashboard/profile/profile.ts`  
**Role**: Profile editor modal. Main features:
- **Form**: ReactiveForm: firstName, lastName, username, password (optional), birthday
- **Avatar**: file picker + `FileReader` preview + `uploadAvatar()` to Supabase Storage
- **Loading**: `getProfile()`, through the `get_my_profile()` RPC
- **Saving**: `updateProfile()` + optional password change with `supabase.auth.updateUser()`

**Emitted event**: `closeRequested()`

---

## Services

### `SlowsengerDataService`
**File**: `src/app/core/supabase/slowsenger-data.service.ts`  
The central data service. Every Supabase call is here. Observable-based API.

### `SupabaseService`
**File**: `src/app/core/supabase/supabase.service.ts`  
Singleton Supabase client. Contains the `getSession()` method.

### `ToastService`
**File**: `src/app/core/toast/toast.service.ts`  
Signal-based toast manager. `show(message, type, duration)` and `dismiss(id)` methods.

### `AuthGuard`
**File**: `src/app/pages/auth/auth-guard.ts`  
Route guard: redirects unauthenticated users to the `/auth/login` route.

---

## Routing

| Route | Component | Guard |
|---------|-----------|-------|
| `/` | `WelcomePages` | – |
| `/auth/login` | `Login` | – |
| `/auth/registration` | `Regist` | – |
| `/dashboard` | `Dashboard` | `AuthGuard` |
| `**` | `NotFound` | – |
