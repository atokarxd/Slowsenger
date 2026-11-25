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
| `ai_consent` | `boolean` (default `false`) | no | AI suggestions turned on in the profile: the AI may read the user's conversations (see `conversation_ai_allowed`) |

**Access**: logged-in users can read only the public columns (column-level `grant select`); the `get_my_profile()` function returns the caller's own full row. Users can write only their own row.

---

### 3. `unified_threads`

Chat threads. Every user has their own copy of a conversation, a group conversation too.

| Column | Type | Description |
|--------|-------|--------|
| `id` | `uuid` PK | Unique thread identifier |
| `owner_user_id` | `uuid` FK → `auth.users.id` | The owner of the thread |
| `external_thread_id` | `text` | `user:{the other person's uuid}`, or `group:{the group's uuid}` |
| `title` | `text` | The other person's name, or the group's |
| `last_message_at` | `timestamptz` | Timestamp of the last message |
| `created_at` | `timestamptz` | Thread creation |

**Unique index**: `(owner_user_id, external_thread_id)`

---

### 4. `unified_messages`

The messages of the threads. A sent message means one row in every copy of the conversation: `outbound` in the sender's thread, `inbound` in the recipient's (or in every other group member's). All copies have the same `created_at`.

| Column | Type | Description |
|--------|-------|--------|
| `id` | `uuid` PK | Unique message identifier |
| `thread_id` | `uuid` FK → `unified_threads.id` | The thread it belongs to |
| `sender_user_id` | `uuid` nullable | The sender's UID; null: a card from the app itself (a suggestion of the recognizer) |
| `content` | `text` | Message text (for a card or an attachment: its plain-text summary, for previews) |
| `direction` | `text` (`inbound` \| `outbound`) | Incoming or outgoing |
| `created_at` | `timestamptz` | Time sent |
| `commitment_id` | `uuid` nullable, FK → `commitments.id` | Set: the message is a commitment card showing that commitment |
| `attachment` | `jsonb` nullable | A GIF `{kind: 'gif', giphyId, title, url, width, height}` or a file `{kind: 'file', fileId, name, size, type}` (`fileId`: its path in the `chat-files` bucket) |
| `reply_to` | `jsonb` nullable | The message it answers: `{sender_user_id, created_at, preview}` |

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

### 8. `commitments`

Commitments made in a direct conversation, readable only by its two people (RLS). They change only through `create_commitment`, `send_commitment_invite` and `apply_commitment_action`, which enforce the state machine of `docs/BUSINESS_RULES.md`.

| Column | Type | Description |
|--------|-------|--------|
| `id` | `uuid` PK | Commitment identifier |
| `participant_ids` | `uuid[]` (2) | The two people of the conversation |
| `title` | `text` | What is to be done |
| `owner_id` | `uuid` nullable | Who does it (null: not said yet) |
| `due`, `has_time` | `timestamptz`, `boolean` | The deadline; without a time, the end of that day |
| `status` | `text` | `proposed`, `accepted`, `completed`, `rejected`, `withdrawn` (`overdue` is derived) |
| `origin` | `text` | `manual` or `detected` (by the recognizer) |
| `source_message_id`, `source_text`, `source_author_id` | | The message it comes from (for an invite: its card) |
| `created_by`, `requested_by` | `uuid` | Who added it, who asked for it (null: taken on unasked) |
| `pending_change` | `jsonb` nullable | A change waiting for acceptance |
| `source_key` | `text` nullable, UNIQUE | A recognizer's suggestion: `<conversation>\|<author>\|<the message's time>\|<item>`, the same from either copy of the message, so the same thing is not suggested twice |

### 9. `commitment_events`

The history of every commitment (`commitment_id`, `at`, `actor_id`, `action`, `from_status`, `to_status`, `reason`, `before`, `after`); only ever appended to.

---

### 10. `chat_groups` and `chat_group_members`

Group conversations: the group (`id`, `name`: the members' first names, `created_by`, `created_at`) and who is in it (`group_id`, `user_id`, `joined_at`; primary key `(group_id, user_id)`). Members can read them; they change only through `create_group_with_message` and `leave_group`.

### 11. `conversation_nicknames`

A nickname someone has in a conversation, seen by everyone in it.

| Column | Type | Description |
|--------|-------|--------|
| `conversation` | `text` | `dm:{smaller uuid}:{larger uuid}` or `group:{group uuid}` |
| `user_id` | `uuid` | Who has the nickname |
| `nickname` | `text` (1–40) | The nickname |
| `set_by`, `updated_at` | | Who gave it, when |

**Primary key**: `(conversation, user_id)`. Readable by the people of the conversation; set only through `set_nickname`.

### 12. `scheduled_messages`

Messages waiting to be sent later (`id`, `sender_user_id`, `recipient_user_id`: a person or a group, `content`, `send_at`, `created_at`). Only their sender sees, adds (with `send_at` in the future) and cancels them; `deliver_due_messages` sends them every minute (pg_cron).

### Storage buckets

- `avatars` (public): profile pictures, `{user uuid}/avatar.{ext}`.
- `chat-files` (private, 10 MB a file): attached files, `{conversation folder}/{uuid}-{name}`, where the folder is the conversation key with `_` for `:`. Only the people of the conversation can read or add files.

---

## Relationships

```
auth.users (1) ──── (1) profiles
auth.users (1) ──── (N) unified_threads
auth.users (1) ──── (N) user_labels
unified_threads (1) ──── (N) unified_messages
unified_threads (1) ──── (0..1) thread_labels (N) ──── (1) user_labels
unified_threads (1) ──── (0..1) thread_read_at
commitments (1) ──── (N) commitment_events
commitments (1) ──── (N) unified_messages (cards, commitment_id)
chat_groups (1) ──── (N) chat_group_members (N) ──── (1) auth.users
auth.users (1) ──── (N) scheduled_messages
```

---

## SECURITY DEFINER functions

### `send_direct_message(p_recipient_id uuid, p_content text, p_reply_to jsonb, p_attachment jsonb)`

Sends a message to a person or into a group the caller is in: atomically creates the threads that are missing and writes every copy (through the internal `deliver_message`). The reply reference and the attachment are cleaned to their allowed fields; a GIF must come from GIPHY, a file from the conversation's own folder.

### Commitments

`create_commitment` (from a message), `send_commitment_invite` (the proposal and its two cards together), `apply_commitment_action` (one step of the state machine).

### Groups and nicknames

`create_group_with_message` (a group of at least three, made with its first message; the same people reuse their group), `my_groups`, `leave_group` (the caller's copy goes; the last one out deletes the group), `set_nickname`. Helpers: `is_group_member`, `dm_key`, `in_conversation`.

### Send later

`deliver_due_messages` (everyone's, for pg_cron), `deliver_my_due_messages` (the caller's, asked for by an open app).

### AI (`supabase/migrations/20261125_ai_features.sql`)

`conversation_ai_allowed(p_key)`: whether everyone in a conversation of the caller (`dm:<id>:<id>` or `group:<id>`) has turned on AI suggestions; false for a conversation they are not in. `record_detected_commitment(...)`: a suggestion of the recognizer, as a proposal created by nobody (`origin = 'detected'`, `created_by` null) with a card from the app (`deliver_system_card`) in both copies of the conversation; returns null if it was suggested before (`source_key`). Only the server may call these two writers (`service_role`): a client cannot pass anything off as the recognizer's.

## Edge Functions (`supabase/functions`)

| Function | Called by | What it does |
|--------|-------|--------|
| `giphy-search` | the GIF picker | Searches GIPHY with the server's key (secret `GIPHY_API_KEY`) |
| `recognize-commitments` | the sender's app, after each sent direct message | If both have turned on AI suggestions: the research prefilter, then Claude Haiku 5.5 with the research prompt over the last 12 messages; each commitment or request in the new message becomes a suggestion (`record_detected_commitment`). Secret `ANTHROPIC_API_KEY` |
| `summarize-chat` | the chat's summary panel | If everyone has turned on AI suggestions: Claude Haiku 5.5 sums up the messages since the chat was last read (3–6 points, commitments, decisions). Secret `ANTHROPIC_API_KEY` |

### `get_my_profile()`

Returns the caller's own full profile row (with the private columns).

### `is_username_available(p_username text)`

Checks at registration whether the username is free. Returns only `true`/`false`.

### `handle_new_user()` (trigger)

On an insert into the `auth.users` table, creates the `profiles` row from the registration metadata.
