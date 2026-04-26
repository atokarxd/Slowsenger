# Slowsenger – Adatmodell

Az alkalmazás Supabase (PostgreSQL) adatbázist használ. Az összes tábla Row Level Security (RLS) védelemmel rendelkezik.

---

## Entitások

### 1. `auth.users` (Supabase beépített)

A Supabase Authentication rendszer által kezelt tábla.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Egyedi felhasználói azonosító |
| `email` | `text` | Bejelentkezési e-mail cím |
| `created_at` | `timestamptz` | Regisztráció dátuma |

---

### 2. `profiles`

A bejelentkezett felhasználók személyes adatai. Egy-az-egyhez kapcsolódik az `auth.users` táblához.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK, FK → `auth.users.id` | Supabase auth UID |
| `display_name` | `text` | Teljes megjelenítési név |
| `email` | `text` | E-mail (szinkronizált) |
| `phone` | `text` | Telefonszám |
| `first_name` | `text` | Keresztnév |
| `last_name` | `text` | Vezetéknév |
| `username` | `text` UNIQUE | Egyedi felhasználónév |
| `birthday` | `date` | Születési dátum |
| `avatar_url` | `text` | Profilkép URL (Supabase Storage) |
| `created_at` | `timestamptz` | Létrehozás dátuma |

**RLS szabályok**: csak a saját sor olvasható/szerkeszthető; más felhasználók névjegyei olvashatók.

---

### 3. `linked_accounts`

A felhasználókhoz csatolt külső platform-fiókok (Meta Messenger, Instagram).

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Egyedi azonosító |
| `user_id` | `uuid` FK → `auth.users.id` | Tulajdonos felhasználó |
| `platform` | `text` (`messenger` \| `instagram`) | Platform neve |
| `external_user_id` | `text` | Meta Page ID vagy User ID |
| `external_username` | `text` | Page neve vagy fiók neve |
| `access_token` | `text` | Page Access Token (titkos) |
| `page_id` | `text` | Facebook Page ID |
| `status` | `text` (`connected` \| `revoked`) | Kapcsolat állapota |
| `created_at` | `timestamptz` | Csatlakozás dátuma |

**Egyedi index**: `(user_id, platform, external_user_id)`

---

### 4. `unified_threads`

Csevegési szálak – egységes modell belső és külső üzenetváltáshoz.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Egyedi szál-azonosító |
| `owner_user_id` | `uuid` FK → `auth.users.id` | A szál tulajdonosa |
| `platform` | `text` | `messenger` (belső és külső esetén is) |
| `external_thread_id` | `text` | `user:{uuid}` belső; `{convId}\|{psid}` Messenger |
| `title` | `text` | Szál neve / másik fél neve |
| `last_message_at` | `timestamptz` | Utolsó üzenet időbélyege |
| `created_at` | `timestamptz` | Szál létrehozása |

**Egyedi index**: `(owner_user_id, platform, external_thread_id)`

---

### 5. `unified_messages`

Egységes üzenettábla – minden szálhoz tartozó üzenet.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Egyedi üzenetazonosító |
| `thread_id` | `uuid` FK → `unified_threads.id` | Melyik szálhoz tartozik |
| `sender_user_id` | `uuid` nullable | Belső küldő UID-je |
| `sender_external_id` | `text` nullable | Külső küldő azonosítója (PSID) |
| `content` | `text` | Üzenet szövege |
| `direction` | `text` (`inbound` \| `outbound`) | Bejövő vagy kimenő |
| `external_message_id` | `text` nullable UNIQUE | Meta üzenet ID (dedup) |
| `created_at` | `timestamptz` | Küldés időbélyege |

**Egyedi részleges index**: `external_message_id` ahol nem null (Messenger deduplication).

---

## Kapcsolatok

```
auth.users (1) ──── (1) profiles
auth.users (1) ──── (N) linked_accounts
auth.users (1) ──── (N) unified_threads
unified_threads (1) ──── (N) unified_messages
```

---

## SECURITY DEFINER függvények

### `send_direct_message(p_recipient_id uuid, p_content text)`

Atomikusan hoz létre szálat mind a küldő, mind a fogadó oldalán, és beilleszt egy `outbound` + egy `inbound` üzenetet – RLS megkerülésével, biztonságos server-side kontextusban.
