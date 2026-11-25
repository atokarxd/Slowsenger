# Supabase setup for Slowsenger

## 1. Add environment keys
Update `src/environments/environment.ts` with your values:
- `supabaseUrl`
- `supabaseAnonKey`
- `giphyFunction`: the Edge Function the GIF picker searches through (`giphy-search`, see step 7). No GIPHY
  key goes into this file: it is in the public repository.

## 2. Create database schema
- **New database:** run the SQL from `supabase/schema.sql` in the Supabase SQL editor.
- **Existing database:** run the files in `supabase/migrations` that have not been applied yet, in filename order, each one as a whole.

## 3. Configure Auth
Enable email/password sign-in in Supabase Auth settings.

## 4. Storage
Create a public `avatars` bucket for profile pictures. Each user uploads to `<user id>/avatar.<ext>`.

The private `chat-files` bucket of attached files (10 MB a file, one folder per conversation, readable
only by its people) is made by `migrations/20261124_chat_features.sql`.

## 5. Send later (pg_cron)
`migrations/20261124_chat_features.sql` schedules `deliver_due_messages()` every minute with pg_cron, if
the extension can be switched on. Otherwise it prints a notice: switch on **pg_cron** (Database →
Extensions) and run

```sql
select cron.schedule('slowsenger-send-later', '* * * * *', 'select public.deliver_due_messages()');
```

Until then, scheduled messages go out while their sender has the app open.

## 6. Realtime
The same migration adds `unified_messages` and `commitments` to the `supabase_realtime` publication, so
new messages and changed commitment cards show at once.

## 7. GIF search (Edge Function)
`functions/giphy-search/index.ts` keeps the GIPHY key on the server and searches for signed-in users only.
1. Dashboard → Edge Functions → Deploy a new function → name it `giphy-search`, paste the file, deploy
   (leave "Verify JWT" on). With the CLI: `supabase functions deploy giphy-search`.
2. Edge Functions → Secrets → add `GIPHY_API_KEY` with the key (developers.giphy.com → Dashboard →
   Create an API Key → API, Web). With the CLI: `supabase secrets set GIPHY_API_KEY=...`.

Until then the picker says GIF search is not set up on the server yet.

## 8. AI suggestions and the chat summary (Edge Functions)
`migrations/20261125_ai_features.sql` adds the consent (`profiles.ai_consent`, off by default) and the
recognizer's suggestions. Then two functions, both with Claude Haiku 5.5 and the same key:

- `functions/recognize-commitments/index.ts`: after each direct message sent, suggests the commitments in it
  (the research prompt and prefilter), as cards in the chat;
- `functions/summarize-chat/index.ts`: the summary panel's points, commitments and decisions.

1. Run the migration in the SQL editor.
2. Dashboard → Edge Functions → Deploy a new function, once for each: name it `recognize-commitments` (then
   `summarize-chat`), paste the file, deploy (leave "Verify JWT" on). With the CLI:
   `supabase functions deploy recognize-commitments` and `supabase functions deploy summarize-chat`.
3. Edge Functions → Secrets → add `ANTHROPIC_API_KEY`. Make a new key for the app in the Claude Console
   (not the research one) and give it a monthly spending limit. With the CLI:
   `supabase secrets set ANTHROPIC_API_KEY=...`.

Both run only where everyone in the conversation has turned on **AI suggestions** in their profile. Until
the functions are deployed, the summary panel says the feature is not set up on the server yet, and no
suggestions come.

