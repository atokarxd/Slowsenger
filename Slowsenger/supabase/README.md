# Supabase setup for Slowsenger

## 1. Add environment keys
Update `src/environments/environment.ts` with your values:
- `supabaseUrl`
- `supabaseAnonKey`

## 2. Create database schema
Run the SQL from `supabase/schema.sql` in the Supabase SQL editor.

## 3. Configure Auth
Enable email/password sign-in in Supabase Auth settings.

## 4. Build Meta integration with Edge Functions
The Angular app expects these functions:
- `meta-oauth-start`
- `meta-relay-message`

These functions should:
1. Start OAuth for Messenger/Instagram
2. Store refreshed tokens securely
3. Ingest webhooks into `unified_threads` and `unified_messages`
4. Relay outbound messages to Meta APIs

## 5. Required Meta APIs
For platform linking and message relay you still need:
- Facebook Graph API
- Messenger Platform
- Instagram Messaging API

Supabase handles your app data and auth, but Meta permissions and app review are still required for production.
