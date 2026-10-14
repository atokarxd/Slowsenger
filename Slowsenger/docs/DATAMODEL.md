# Slowsenger – Adatmodell

Az alkalmazás Supabase (PostgreSQL) adatbázist használ. Az összes tábla Row Level Security (RLS) védelemmel rendelkezik.

A teljes séma: `supabase/schema.sql` (új adatbázishoz). Meglévő adatbázist a `supabase/migrations` fájljai hoznak naprakész állapotba.

---

## Entitások

### 1. `auth.users` (Supabase beépített)

A Supabase Authentication rendszer által kezelt tábla.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Egyedi felhasználói azonosító |
| `email` | `text` | Bejelentkezési e-mail cím (csak itt tárolódik) |
| `created_at` | `timestamptz` | Regisztráció dátuma |

---

### 2. `profiles`

A felhasználók személyes adatai. Egy-az-egyhez kapcsolódik az `auth.users` táblához; regisztrációkor a `handle_new_user` trigger hozza létre.

| Oszlop | Típus | Más felhasználók olvashatják? | Leírás |
|--------|-------|:---:|--------|
| `id` | `uuid` PK, FK → `auth.users.id` | igen | Supabase auth UID |
| `display_name` | `text` | igen | Teljes megjelenítési név |
| `username` | `text` UNIQUE | igen | Egyedi felhasználónév (kisbetűs, normalizált) |
| `avatar_url` | `text` | igen | Profilkép URL (Supabase Storage) |
| `created_at` | `timestamptz` | igen | Létrehozás dátuma |
| `phone` | `text` | nem | Telefonszám |
| `first_name` | `text` | nem | Keresztnév |
| `last_name` | `text` | nem | Vezetéknév |
| `birthday` | `date` | nem | Születési dátum |

**Hozzáférés**: bejelentkezett felhasználók csak a publikus oszlopokat olvashatják (oszlopszintű `grant select`); a saját teljes sort a `get_my_profile()` függvény adja vissza. Írni csak a saját sort lehet.

---

### 3. `unified_threads`

Csevegési szálak. Minden felhasználónak saját példánya van egy beszélgetésből.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Egyedi szál-azonosító |
| `owner_user_id` | `uuid` FK → `auth.users.id` | A szál tulajdonosa |
| `external_thread_id` | `text` | `user:{a másik fél uuid-ja}` |
| `title` | `text` | A másik fél neve |
| `last_message_at` | `timestamptz` | Utolsó üzenet időbélyege |
| `created_at` | `timestamptz` | Szál létrehozása |

**Egyedi index**: `(owner_user_id, external_thread_id)`

---

### 4. `unified_messages`

A szálakhoz tartozó üzenetek. Egy elküldött üzenet két sort jelent: `outbound` a küldő, `inbound` a címzett szálában.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Egyedi üzenetazonosító |
| `thread_id` | `uuid` FK → `unified_threads.id` | Melyik szálhoz tartozik |
| `sender_user_id` | `uuid` nullable | A küldő UID-je |
| `content` | `text` | Üzenet szövege |
| `direction` | `text` (`inbound` \| `outbound`) | Bejövő vagy kimenő |
| `created_at` | `timestamptz` | Küldés időbélyege |

---

### 5. `user_labels`

A felhasználó saját címkéi (pl. „munkatárs”), amelyekkel a beszélgetéseit csoportosíthatja és szűrheti.

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `id` | `uuid` PK | Címke azonosító |
| `user_id` | `uuid` FK → `auth.users.id` | A címke tulajdonosa |
| `name` | `text` | Címke neve |
| `created_at` | `timestamptz` | Létrehozás dátuma |

---

### 6. `thread_labels`

Melyik beszélgetéshez melyik címke tartozik. **Egy beszélgetésnek egyszerre legfeljebb egy címkéje lehet.**

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `user_id` | `uuid` FK → `auth.users.id` | Tulajdonos |
| `thread_id` | `uuid` FK → `unified_threads.id` | Beszélgetés |
| `label_id` | `uuid` FK → `user_labels.id` | Címke |
| `created_at` | `timestamptz` | Hozzárendelés dátuma |

**Elsődleges kulcs**: `(user_id, thread_id)`. Címke vagy beszélgetés törlésekor a hozzárendelés is törlődik. RLS: a beszélgetésnek és a címkének is a hívóé kell lennie.

---

### 7. `thread_read_at`

Mikor nyitotta meg utoljára a felhasználó a beszélgetést (olvasatlan jelölés).

| Oszlop | Típus | Leírás |
|--------|-------|--------|
| `user_id` | `uuid` FK → `auth.users.id` | Tulajdonos |
| `thread_id` | `uuid` FK → `unified_threads.id` | Beszélgetés |
| `read_at` | `timestamptz` | Utolsó megnyitás |

**Elsődleges kulcs**: `(user_id, thread_id)`

---

## Kapcsolatok

```
auth.users (1) ──── (1) profiles
auth.users (1) ──── (N) unified_threads
auth.users (1) ──── (N) user_labels
unified_threads (1) ──── (N) unified_messages
unified_threads (1) ──── (0..1) thread_labels (N) ──── (1) user_labels
unified_threads (1) ──── (0..1) thread_read_at
```

---

## SECURITY DEFINER függvények

### `send_direct_message(p_recipient_id uuid, p_content text)`

Atomikusan hoz létre szálat mind a küldő, mind a fogadó oldalán, és beilleszt egy `outbound` + egy `inbound` üzenetet – RLS megkerülésével, biztonságos server-side kontextusban.

### `get_my_profile()`

A hívó saját, teljes profilsorát adja vissza (a privát oszlopokkal együtt).

### `is_username_available(p_username text)`

Regisztrációkor ellenőrzi, hogy a felhasználónév szabad-e. Csak `true`/`false` értéket ad vissza.

### `handle_new_user()` (trigger)

Az `auth.users` táblába történő beszúráskor létrehozza a `profiles` sort a regisztrációs metaadatokból.
