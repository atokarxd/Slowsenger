# Slowsenger – Komponens dokumentáció

Az alkalmazás Angular 21.x standalone komponensekből épül fel. Nincs `NgModule` – minden komponens önállóan deklarálja függőségeit az `imports` tömbben.

---

## Komponens-fa

```
App (app-root)
├── GlobalLoader              – Teljes képernyős betöltő (app init)
├── ToastComponent            – Globális értesítő (toast) overlay
└── RouterOutlet
    ├── Login                 – Bejelentkezési oldal
    ├── Regist                – Regisztrációs oldal
    ├── MetaCallback          – Meta OAuth visszatérési útvonal
    └── Dashboard
        ├── AppList           – Bal oldali ikonsor (navigáció)
        ├── UserList          – Szállista (Inbox, keresés, törlés)
        └── Chat              – Csevegési ablak
            └── [Profile]     – Profil modal (overlay)
```

---

## Komponensek

### `App` (`app-root`)
**Fájl**: `src/app/app.ts`  
**Feladat**: Alkalmazás gyökere. Supabase munkamenetet ellenőriz inicializáláskor, majd megjeleníti a globális loadert vagy a router outlet-et. Tartalmazza a `<app-toast>` globális értesítőt.

---

### `GlobalLoader`
**Fájl**: `src/app/pages/global-loader/global-loader.ts`  
**Feladat**: Teljes képernyős betöltési animáció, amíg a Supabase session nem töltődött be.

---

### `ToastComponent`
**Fájl**: `src/app/core/toast/toast.component.ts`  
**Feladat**: Globális értesítő overlay. A `ToastService`-től olvassa a toastok listáját (Signal), és `position: fixed` elrendezésben jeleníti meg őket. Kattintással vagy automatikusan (3 mp) eltűnnek.

---

### `Login`
**Fájl**: `src/app/pages/auth/login/login.ts`  
**Feladat**: Bejelentkezési form. Felhasználónév vagy e-mail + jelszó. `SlowsengerDataService.signInWithUsernameOrEmail()` hívás, sikeres bejelentkezés után átirányítás `/dashboard`-ra.

---

### `Regist`
**Fájl**: `src/app/pages/auth/regist/regist.ts`  
**Feladat**: Regisztrációs form ReactiveFormsModule-lal. Validációs hibaüzenetek inline megjelenítése. `SlowsengerDataService.registerWithProfile()` hívás.

---

### `MetaCallback`
**Fájl**: `src/app/pages/auth/meta-callback/meta-callback.ts`  
**Feladat**: Meta OAuth callback útvonal (`/auth/meta/callback`). URL paraméterekből kinyeri a `code`-ot és a `state`-et, majd meghívja a `completeMetaConnection()` service metódust. Átirányít `/dashboard`-ra.

---

### `Dashboard`
**Fájl**: `src/app/pages/dashboard/dashboard.ts`  
**Feladat**: Fő elrendezés (layout) komponens. Kezeli a mobil nézet váltást (lista ↔ chat), a profil modal nyitását/zárását, és a kiválasztott felhasználót (`selectedUser`).

---

### `AppList`
**Fájl**: `src/app/pages/dashboard/app-list/app-list.ts`  
**Feladat**: Bal oldali navigációs ikonsor. Jövőbeli kiterjesztési pont (alkalmazás-navigáció).

---

### `UserList`
**Fájl**: `src/app/pages/dashboard/user-list/user-list.ts`  
**Feladat**: A csevegési szálak listája. Főbb funkciók:
- **Betöltés**: `forkJoin` a szálak és profilok párhuzamos lekérdezésére
- **Keresés**: `searchTerm` Signal + `computed` `filteredUsers` – valós idejű szűrés név/username alapján
- **Messenger szinkron**: induláskor `syncMessengerConversations()` hívás
- **Törlés**: megerősítő dialógussal, `deleteThread()` service hívás
- **Új üzenet modal**: felhasználónév alapján új csevegés indítása

**Kibocsátott események**: `chatSelected(AppUserSummary)`, `settingsClicked()`

---

### `Chat`
**Fájl**: `src/app/pages/dashboard/chat/chat.ts`  
**Feladat**: Csevegési ablak. Főbb funkciók:
- **`effect()`**: `selectedUser` input Signal változásakor automatikusan betölti az üzeneteket és feliratkozik a Realtime csatornára
- **Realtime**: Supabase `postgres_changes` csatorna az `unified_messages` táblán, `NgZone.run()` az Angular CD-n kívüli callback-ekhez
- **Küldés**: `sendDirectMessage()` belső, `sendMessengerMessage()` Messenger szálhoz
- **Swipe**: érintős időbélyeg-megjelenítés (`translateX`)
- **Cleanup**: `DestroyRef.onDestroy` + `messagesSubscription.unsubscribe()`

**Input**: `selectedUser: Signal<AppUserSummary | null>`  
**Kibocsátott esemény**: `backClicked()`

---

### `Profile`
**Fájl**: `src/app/pages/dashboard/profile/profile.ts`  
**Feladat**: Profil-szerkesztő modal. Főbb funkciók:
- **Form**: ReactiveForm – firstName, lastName, username, password (opcionális), birthday
- **Avatar**: fájlválasztó + `FileReader` előnézet + `uploadAvatar()` Supabase Storage
- **Mentés**: `updateProfile()` + opcionális jelszócsere `supabase.auth.updateUser()`
- **Platform kapcsolat**: Meta OAuth indítása (`requestMetaConnection()`), kapcsolt fiókok listázása
- **Leválasztás**: `disconnectLinkedAccount()` – státusz `revoked`-ra állítása

**Kibocsátott esemény**: `closeRequested()`

---

## Services

### `SlowsengerDataService`
**Fájl**: `src/app/core/supabase/slowsenger-data.service.ts`  
Központi adatszolgáltatás. Minden Supabase- és Meta API-hívás itt van. Observable-alapú API.

### `SupabaseService`
**Fájl**: `src/app/core/supabase/supabase.service.ts`  
Singleton Supabase kliens. Tartalmazza a `getSession()` metódust.

### `ToastService`
**Fájl**: `src/app/core/toast/toast.service.ts`  
Signal-alapú toast menedzser. `show(message, type, duration)` és `dismiss(id)` metódusok.

### `AuthGuard`
**Fájl**: `src/app/pages/auth/auth-guard.ts`  
Route guard – hitelesítetlen felhasználókat a `/login` útvonalra irányít.

---

## Routing

| Útvonal | Komponens | Guard |
|---------|-----------|-------|
| `/login` | `Login` | – |
| `/register` | `Regist` | – |
| `/auth/meta/callback` | `MetaCallback` | – |
| `/dashboard` | `Dashboard` | `AuthGuard` |
| `/` (redirect) | → `/login` | – |
