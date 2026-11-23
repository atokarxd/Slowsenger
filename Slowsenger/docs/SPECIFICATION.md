# Slowsenger – Functional specification

## Project description

Slowsenger is a modern, web-based messaging application for real-time chat between registered users. Conversations can be grouped and filtered with the user's own labels (e.g. "colleague").

---

## Functional requirements

### Authentication

| # | Feature | Description |
|---|---------|--------|
| F1 | Registration | A user can register with an e-mail address, password, username, phone number and date of birth. |
| F2 | Login | Login with an e-mail address and password. |
| F3 | Logout | Ends the session and redirects to the login page. |
| F4 | Route protection | Unauthenticated users cannot reach the dashboard (AuthGuard). |

### Profile

| # | Feature | Description |
|---|---------|--------|
| F5 | Viewing the profile | The logged-in user can view their data. |
| F6 | Editing the profile | First name, last name, username and date of birth can be changed. |
| F7 | Changing the password | Optional password change on saving. |
| F8 | Uploading a profile picture | Choosing a picture and uploading it to Supabase Storage. |

### Messaging (internal)

| # | Feature | Description |
|---|---------|--------|
| F9 | Finding a user | Another registered user can be found by username. |
| F10 | Starting a new chat | With the first message, the thread is created automatically for both people. |
| F11 | Real-time messaging | With Supabase Realtime, an incoming message shows up at once. |
| F12 | Listing threads | The Inbox list shows every active chat. |

### Management

| # | Feature | Description |
|---|---------|--------|
| F16 | Search / filter | Chats in the thread list can be filtered by name or username. |
| F17 | Deleting a thread | Deleting a chat thread, with a confirmation dialog. |
| F18 | Labels | Creating your own labels; one label at a time can be assigned to a conversation, and the list can be filtered by label. |
| F19 | Toast notifications | Feedback on successful and failed actions with a pop-up notification. |

---

## Non-functional requirements

- **Security**: RLS (Row Level Security) protects every Supabase table; from other users' profiles only the public fields (name, username, profile picture) can be read, not the e-mail address, phone number or date of birth.
- **Performance**: skeleton loading shows the loading state; real-time updates need no full page reload.
- **Responsiveness**: in mobile view the list and the chat are shown in turn; the layout is based on CSS Grid + Flexbox.
- **Reliability**: real-time channels are cleaned up in `onDestroy`; asynchronous subscriptions are handled with `DestroyRef`.
