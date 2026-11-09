# Jelölési útmutató

Ez az útmutató a `research/annotation/*_gold.jsonl` fájlok kézi jelöléséhez készült. Minden részlethez egy sor tartozik.

> **A jelenlegi címkék AI által előkészített vázlatok** (`"label_source": "draft: AI assistant"`, `"verified": false`).
> Kiértékelési eredménynek csak az számít, amit kézzel átnéztél, és `"verified": true`-ra állítottál.
> Ha javítasz, írd át a mezőket, és a `notes` mezőben indokold.

## Mezők részletenként

| Mező | Jelentés |
|---|---|
| `has_commitment` | Van-e a részletben **tényleges vállalás**: valaki magára vállalta, elfogadta a kérést, vagy kiosztották neki, és nem utasította el. Egy el nem fogadott kérés vagy egy feltételes ajánlat még nem vállalás. |
| `expected_action` | Mit kellene tennie a rendszernek: `suggest` (vállalásjavaslat az érintettnek megerősítésre), `clarify` (pontosítást kell kérni, mert hiányzik vagy bizonytalan a felelős, illetve a feladat), `none` (nem keletkezhet vállalás). |
| `items` | A részletben felismerhető feladatjellegű megnyilvánulások (lásd lent). Vállalás nélküli részletnél is szerepelhet benne kérés vagy csoportterv, dokumentációként. |
| `notes` | Indoklás, bizonytalanság, eltérés az AMI összefoglalójától. |
| `verified` | `true`, ha kézzel ellenőrizted. |

## Mezők tételenként (`items`)

| Mező | Értékek |
|---|---|
| `kind` | `commitment` (vállalás), `request` (kérés, még nincs elfogadva), `offer` (feltételes ajánlat), `modification` (meglévő vállalás módosítása), `withdrawal` (visszavonás), `group_plan` (csoportos terv vagy döntés konkrét felelős nélkül) |
| `task` | A feladat rövid leírása a beszélgetés alapján. |
| `owner` | A felelős beszélő betűje (`"A"`), több beszélő listája (`["B", "C"]`), `"all"` (kifejezetten mindenki, pl. „each of you”), vagy `null`, ha a beszélgetés nem mondja meg. **Nem szabad kitalálni.** |
| `deadline` | A határidő úgy, ahogy elhangzott („after the meeting”, „péntekig”), vagy `null`, ha nem hangzott el. **Nem szabad kitalálni.** |
| `agreement` | `self` (magától vállalta), `accepted` (kérésre igent mondott), `assigned` (kiosztották neki, elfogadás nem látszik), `conditional` (feltételhez kötött), `none` (nincs elfogadás), `refused` (elutasította). |
| `evidence` | A részlet megszólalásainak azonosítói (AMI dialógus-aktus vagy szegmens, illetve a magyar készletben `hu-XX.N`), amelyekből a tétel kiolvasható. |

## Döntési szabályok röviden

A részletes szabályok a `docs/BUSINESS_RULES.md`-ben vannak. A jelöléshez ennyi elég:

1. **`suggest`**: van legalább egy vállalás, és a felelős egyértelmű (egy beszélő, megnevezett beszélők, vagy kifejezetten mindenki).
2. **`clarify`**: van feladat, de a felelős hiányzik vagy bizonytalan, vagy feltételes ajánlat, illetve el nem fogadott kérés.
3. **`none`**: nincs feladat. Ide tartozik a megbeszélés közbeni azonnali cselekvés („I will present…”, „can you go to the next slide”), a múltbeli beszámoló, a viccelődés, és a konkrét feladat nélküli homályos terv.

Egy megbeszélés-időpontban való megállapodás döntés, nem vállalás: `group_plan`, `none`. Az AMI ezt gyakran „action” alá sorolja, ezért ezt az eltérést a `notes`-ban jelöld.
