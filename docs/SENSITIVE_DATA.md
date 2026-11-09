# Érzékeny adatok

A repó nyilvános (`github.com/atokarxd/Slowsenger`). Ami egyszer bekerül egy commitba, az a törlés után is megmarad az előzményekben, a forkokban és a gyorsítótárakban. Ez a lista azt sorolja fel, mi nem kerülhet a repóba, e-mailbe, képernyőképre vagy AI-chatbe, és hol a helye.

A commitolandó fájlokat a `scripts/check_secrets.py` nézi át (lásd [Ellenőrzés](#ellenőrzés)).

## Kulcsok és titkok

| Fajta | Felismerés | Hol a helye | Ha kiszivárgott |
|---|---|---|---|
| Anthropic API-kulcs | `sk-ant-…` | `research/.env` | Claude Console: törlés, új kulcs |
| OpenAI API-kulcs | `sk-…`, `sk-proj-…` | `research/.env` | platform.openai.com: revoke, új kulcs |
| Google (Gemini) API-kulcs | `AIza…` | `research/.env` | Google AI Studio: törlés, új kulcs |
| Supabase `service_role` / secret kulcs | JWT `"role": "service_role"`, `sb_secret_…` | Csak a szerveren (Edge Function secret). Soha nem a kliensben. | Supabase, API keys: rotate |
| Supabase `anon` / publishable kulcs és URL | JWT `"role": "anon"`, `sb_publishable_…` | Lehet a kliensben (`environment.ts`), de csak ha minden táblán RLS van | Nem titok, a védelmet az RLS adja |
| Adatbázis-jelszó, kapcsolati URL | `postgres://<felhasználó>:<jelszó>@…` | Szerveroldali `.env` | Supabase: reset database password |
| Aláíró titok, app secret, webhook-token | `JWT_SECRET=`, `META_APP_SECRET=`, `…_VERIFY_TOKEN=` | Szerveroldali `.env` | Újragenerálás a szolgáltatónál |
| GitHub-token, SSH- vagy más privát kulcs | `ghp_…`, `github_pat_…`, `-----BEGIN … PRIVATE KEY-----` | `~/.ssh`, kulcstartó | GitHub: revoke; új SSH-kulcs |
| Kulcsot tartalmazó fájl | `.env`, `.env.local`, `*.pem`, `*.key`, `credentials*.json`, `service-account*.json` | Gitignore-olva; a repóba csak `.env.example` kerülhet, üres értékekkel | Mint a benne lévő kulcsoknál |
| Bejelentkezési token naplóban vagy képen | `Authorization: Bearer eyJ…`, localStorage `sb-…-auth-token`, HAR-fájl | Sehol | Kijelentkezés minden eszközön |

## Személyes adatok

- **Neptun-kód, hallgatói e-mail, telefonszám, lakcím:** a beadásban és a tanárnak írt levélben rendben van. A nyilvános repóba nem kell.
- **Commit-szerző e-mail:** minden commit metaadatában nyilvános. Helyette használható a GitHub noreply címe (`git config user.email <azonosító>+<név>@users.noreply.github.com`).
- **Valódi beszélgetések és résztvevőik:** üzenetek, nevek, telefonszámok, Supabase-felhasználóazonosítók (UUID), profilképek. Csak hozzájárulással gyűjthetők. A repóba csak anonimizálva kerülhetnek, betűkkel jelölt beszélőkkel, ahogy a gold fájlokban (A, B, C). A nyers adat gitignore-olt mappában marad, mint a `research/data/raw/`.
- **Képernyőképek a dolgozatba és a jelentésekbe:** tesztfiókkal és kitalált nevekkel készüljenek. Ne látsszon rajtuk valódi e-mail, token vagy azonosító az URL-ben.
- **AI-eszközök:** kulcs, jelszó vagy valódi beszélgetés ne kerüljön chatbe. Ami mégis bekerült, azt úgy kell kezelni, mintha kiszivárgott volna.

## Jelenlegi állapot (2026-11-09)

| Mi | Állapot | Teendő |
|---|---|---|
| `Slowsenger/backend/.env` (`PORT`, `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`) | 2026-04-26 óta a nyilvános előzményekben van (`d588147`). A `9cdebda` törlés nem vette ki onnan. | **A Meta-alkalmazás titkát és webhook-tokenjét újra kell generálni, vagy az alkalmazást törölni.** A Meta-integráció az `a1b5fcc` óta nincs a kódban. |
| A chatbe bemásolt API-kulcsok (Anthropic, Gemini, OpenAI) | A `research/.env`-ben vannak, ami gitignore-olt, a repóba nem került | Cserélni a határidő után |
| `Slowsenger/src/environments/environment.ts` | Supabase URL és `anon` kulcs | Rendben, ha minden táblán RLS van |
| `README.md`, 3. sor | Neptun-kód, nyilvánosan | Eldönteni, kell-e; a tanár a levélben úgyis megkapja |
| `docs/REPORT_2026-11-06.md` | Neptun-kód; nincs a repóban | Beadáshoz rendben |
| `Slowsenger/e2e/login.spec.ts` | `access_token` egy mockolt válaszban | Kitalált érték, nem JWT; rendben |

## Ellenőrzés

```
python3 -I scripts/check_secrets.py              # a stage-elt fájlok, commit előtt
python3 -I scripts/check_secrets.py --all        # minden követett fájl
python3 -I scripts/check_secrets.py --history    # a teljes git-előzmény
```

A szkript a találatokat csak maszkolva írja ki (az első néhány karakter és a hossz).
- **Hiba (kulcs, titkot tartalmazó fájl, `service_role` kulcs):** 1-es kilépési kód.
- **Figyelmeztetés (e-mail, telefonszám, Neptun-kód, gyanús értékadás):** nem állítja meg a commitot, de érdemes megnézni.

Commit előtti automatikus futtatás (helyi beállítás, nem kerül a repóba):

```
printf '#!/bin/sh\npython3 -I scripts/check_secrets.py\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

## Ha valami kiszivárgott

1. **Először érvényteleníteni** a kulcsot a szolgáltatónál. A fájl törlése nem elég, mert az előzményekben és a forkokban megmarad.
2. **Utána kivenni a kódból**, és `.env`-be tenni, a repóba pedig csak `.env.example` kerül.
3. **Az előzmények átírása** (`git filter-repo`) csak ezután jöhet, és akkor is csak akkor érdemes, ha maga a tartalom érzékeny, például személyes adat. Kulcsnál a csere a lényeg.
