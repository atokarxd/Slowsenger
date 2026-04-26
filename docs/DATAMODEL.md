
#  Slowsenger Data Model

The Supabase schema focuses on connecting external platform IDs to internal user profiles.

---

| Entity | Attributes | Type | Description |
| :--- | :--- | :--- | :--- |
| **profiles** | `id`, `username`, `email`, `avatar_url` | UUID (PK), Text, Text, Text | Internal user profile. |
| **connections** | `id`, `profile_id`, `platform`, `external_user_id`, `access_token` | UUID (PK), FK, Enum, Text, Text | Links a user to Messenger/IG/Slack. |
| **conversations** | `id`, `platform`, `external_chat_id`, `last_message_at` | UUID (PK), Enum, Text, Timestamptz | Metadata for a specific chat thread. |
| **messages** | `id`, `conv_id`, `sender_id`, `content`, `is_p2p`, `created_at` | UUID (PK), FK, Text, Text, Bool, Timestamptz | The message content and transmission type. |
| **participants** | `conv_id`, `profile_id` | UUID (FK), UUID (FK) | Join table for group chats. |

### 🔗 Relationships
* **User (1:N) Connections:** One user can have multiple platform accounts.
* **Conversation (1:N) Messages:** Each thread contains many messages.
* **User (N:M) Conversation:** Handled via the `participants` table to support group chats.
