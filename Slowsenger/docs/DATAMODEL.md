# Slowsenger – Data model

The application uses a Supabase (PostgreSQL) database. Every table is protected by Row Level Security (RLS).

The full schema: `supabase/schema.sql` (for a new database). An existing database is brought up to date by the files in `supabase/migrations`.

---

## Entities

### 1. `auth.users` (Supabase built-in)

The table managed by Supabase Authentication.

| Column | Type | Description |
|--------|-------|--------|
| `id` | `uuid` PK | Unique user identifier |
| `email` | `text` | Login e-mail address (stored only here) |
| `created_at` | `timestamptz` | Date of registration |

---

### 2. `profiles`

The users' personal data. One-to-one with the `auth.users` table; the `handle_new_user` trigger creates it at registration.

| Column | Type | Readable by other users? | Description |
|--------|-------|:---:|--------|
| `id` | `uuid` PK, FK → `auth.users.id` | yes | Supabase auth UID |
| `display_name` | `text` | yes | Full display name |
| `username` | `text` UNIQUE | yes | Unique username (lowercase, normalized) |
| `avatar_url` | `text` | yes | Profile picture URL (Supabase Storage) |
| `created_at` | `timestamptz` | yes | Date of creation |
| `phone` | `text` | no | Phone number |
| `first_name` | `text` | no | First name |
| `last_name` | `text` | no | Last name |
| `birthday` | `date` | no | Date of birth |

**Access**: logged-in users can read only the public columns (column-level `grant select`); the `get_my_profile()` function returns the caller's own full row. Users can write only their own row.

---

### 3. `unified_threads`

Chat threads. Every user has their own copy of a conversation.

| Column | Type | Description |
|--------|-------|--------|
| `id` | `uuid` PK | Unique thread identifier |
| `owner_user_id` | `uuid` FK → `auth.users.id` | The owner of the thread |
| `external_thread_id` | `text` | `user:{the other person's uuid}` |
| `title` | `text` | The other person's name |
| `last_message_at` | `timestamptz` | Timestamp of the last message |
| `created_at` | `timestamptz` | Thread creation |

**Unique index**: `(owner_user_id, external_thread_id)`

---

### 4. `unified_messages`

The messages of the threads. A sent message means two rows: `outbound` in the sender's thread, `inbound` in the recipient's.

| Column | Type | Description |
|--------|-------|--------|
| `id` | `uuid` PK | Unique message identifier |
| `thread_id` | `uuid` FK → `unified_threads.id` | The thread it belongs to |
| `sender_user_id` | `uuid` nullable | The sender's UID |
| `content` | `text` | Message text |
| `direction` | `text` (`inbound` \| `outbound`) | Incoming or outgoing |
| `created_at` | `timestamptz` | Time sent |

---

### 5. `user_labels`

The user's own labels (e.g. "colleague"), for grouping and filtering their conversations.

| Column | Type | Description |
|--------|-------|--------|
| `id` | `uuid` PK | Label identifier |
| `user_id` | `uuid` FK → `auth.users.id` | The owner of the label |
| `name` | `text` | Label name |
| `created_at` | `timestamptz` | Date of creation |

---

### 6. `thread_labels`

Which label belongs to which conversation. **A conversation can have at most one label at a time.**

| Column | Type | Description |
|--------|-------|--------|
| `user_id` | `uuid` FK → `auth.users.id` | Owner |
| `thread_id` | `uuid` FK → `unified_threads.id` | Conversation |
| `label_id` | `uuid` FK → `user_labels.id` | Label |
| `created_at` | `timestamptz` | Date assigned |

**Primary key**: `(user_id, thread_id)`. Deleting the label or the conversation also deletes the assignment. RLS: both the conversation and the label must belong to the caller.

---

### 7. `thread_read_at`

When the user last opened the conversation (unread marker).

| Column | Type | Description |
|--------|-------|--------|
| `user_id` | `uuid` FK → `auth.users.id` | Owner |
| `thread_id` | `uuid` FK → `unified_threads.id` | Conversation |
| `read_at` | `timestamptz` | Last opened |

**Primary key**: `(user_id, thread_id)`

---

## Relationships

```
auth.users (1) ──── (1) profiles
auth.users (1) ──── (N) unified_threads
auth.users (1) ──── (N) user_labels
unified_threads (1) ──── (N) unified_messages
unified_threads (1) ──── (0..1) thread_labels (N) ──── (1) user_labels
unified_threads (1) ──── (0..1) thread_read_at
```

---

## SECURITY DEFINER functions

### `send_direct_message(p_recipient_id uuid, p_content text)`

Atomically creates the thread on both the sender's and the recipient's side, and inserts one `outbound` and one `inbound` message, bypassing RLS in a safe server-side context.

### `get_my_profile()`

Returns the caller's own full profile row (with the private columns).

### `is_username_available(p_username text)`

Checks at registration whether the username is free. Returns only `true`/`false`.

### `handle_new_user()` (trigger)

On an insert into the `auth.users` table, creates the `profiles` row from the registration metadata.
