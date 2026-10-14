# Supabase setup for Slowsenger

## 1. Add environment keys
Update `src/environments/environment.ts` with your values:
- `supabaseUrl`
- `supabaseAnonKey`

## 2. Create database schema
- **New database:** run the SQL from `supabase/schema.sql` in the Supabase SQL editor.
- **Existing database:** run the files in `supabase/migrations` that have not been applied yet, in filename order, each one as a whole.

## 3. Configure Auth
Enable email/password sign-in in Supabase Auth settings.

## 4. Storage
Create a public `avatars` bucket for profile pictures. Each user uploads to `<user id>/avatar.<ext>`.
