# Slowsenger – Funkcionális Specifikáció

## Projektleírás

A Slowsenger egy modern, webalapú üzenetküldő alkalmazás, amely egyetlen felületen egyesíti a belső (felhasználók közötti) csevegést és a külső platformokról (Meta Messenger, Instagram) érkező üzeneteket. A célja, hogy az üzemeltetők egyetlen dashboardon kezelhessék összes kommunikációs csatornájukat.

---

## Funkcionális követelmények

### Autentikáció

| # | Funkció | Leírás |
|---|---------|--------|
| F1 | Regisztráció | Felhasználó regisztrálhat e-mail, jelszó, felhasználónév, telefonszám és születési dátum megadásával. |
| F2 | Bejelentkezés | Bejelentkezés e-mail-cím vagy felhasználónév + jelszó párossal. |
| F3 | Kijelentkezés | A munkamenet megszüntetése és átirányítás a login oldalra. |
| F4 | Útvonalvédelem | Nem hitelesített felhasználók nem érhetik el a dashboardot (AuthGuard). |

### Profil

| # | Funkció | Leírás |
|---|---------|--------|
| F5 | Profil megtekintése | A bejelentkezett felhasználó megtekintheti adatait. |
| F6 | Profil szerkesztése | Keresztnév, vezetéknév, felhasználónév, születési dátum módosítható. |
| F7 | Jelszó változtatás | Opcionális jelszócsere mentéskor. |
| F8 | Profilkép feltöltés | Kép kiválasztása és feltöltése Supabase Storage-ba. |

### Üzenetküldés (Belső)

| # | Funkció | Leírás |
|---|---------|--------|
| F9 | Felhasználó keresése | Felhasználónév alapján megkereshet egy másik regisztrált felhasználót. |
| F10 | Új csevegés indítása | Az első üzenettel automatikusan létrejön a szál mindkét félnél. |
| F11 | Valós idejű üzenetváltás | Supabase Realtime segítségével azonnal megjelenik a beérkező üzenet. |
| F12 | Szálak listázása | Az Inbox listában szerepel minden aktív csevegés. |

### Külső platformok (Meta)

| # | Funkció | Leírás |
|---|---------|--------|
| F13 | Messenger csatlakoztatás | Facebook OAuth 2.0 folyamaton keresztül Page Access Token szerzése. |
| F14 | Messenger szinkronizálás | A legutóbbi Messenger-szálak és üzenetek letöltése a Meta Graph API-ról. |
| F15 | Messenger üzenetküldés | A beérkező Messenger-szálakra válasz küldése a Meta Send API-n keresztül. |

### Kezelés

| # | Funkció | Leírás |
|---|---------|--------|
| F16 | Keresés / szűrés | A szállistában név vagy felhasználónév alapján szűrhetők a csevegések. |
| F17 | Szál törlése | Csevegési szál törlése megerősítő dialógussal. |
| F18 | Fiók leválasztása | Külső platform-kapcsolat (linked_account) leválasztása (státusz: revoked). |
| F19 | Toast értesítések | Sikeres/hibaesemények visszajelzése felugró értesítővel. |

---

## Nem funkcionális követelmények

- **Biztonság**: RLS (Row Level Security) védi az összes Supabase táblát; a Meta App Secret kizárólag a Node.js backenden él.
- **Teljesítmény**: Skeleton loading jelzi a betöltési állapotot; Realtime frissítés nem igényel teljes oldal-újratöltést.
- **Reszponzivitás**: Mobil nézetben a lista és a chat váltakozva jelenik meg; a layout CSS Grid + Flexbox alapú.
- **Megbízhatóság**: A valós idejű csatornák `onDestroy` során takarítódnak el; az aszinkron feliratkozások `DestroyRef` segítségével kezeltek.
