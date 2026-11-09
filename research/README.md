# Research: beszélgetések értelmezése és a felismerés kiértékelése

Ez a mappa a szakdolgozat „A” munkaszála. Független az alkalmazástól: nem importál belőle, és az alkalmazás sem innen fut.

## Tartalom

| Út | Mi ez |
|---|---|
| `data/en_excerpts.jsonl` | 25 rövid angol részlet 11 AMI-megbeszélésből (4 természetes, 7 szerepjátékos), forrásazonosítókkal. |
| `data/hu_constructed.jsonl` | 14 rövid magyar chatrészlet. **Saját összeállítású próbapélda, nem valódi adat.** Az üzleti szabályok eseteit fedik le. |
| `data/split.json` | Fejlesztési és félretett értékelési oldal, beszélgetésenként: egy megbeszélés vagy chat csak az egyik oldalon szerepel. |
| `annotation/GUIDE.md` | Jelölési útmutató. |
| `annotation/*_gold.jsonl` | Helyes értelmezés részletenként. **Jelenleg AI által előkészített vázlat, kézi ellenőrzésre vár** (`verified: false`). |
| `annotation/REVIEW.md` | Generált, olvasható nézet az ellenőrzéshez. |
| `scripts/ami_excerpts.py` | Kivágja a részleteket az AMI kézi annotációiból. |
| `scripts/baseline.py` | Szabályalapú összehasonlítási alap (kulcsszavak és minták). |
| `scripts/llm_recognize.py` | Meglévő nyelvi modell (Gemini, Claude vagy OpenAI GPT) ugyanazokon a részleteken, sémához kötött kimenettel. |
| `scripts/evaluate.py` | Mérőszámok: téves és kihagyott javaslatok, feladat, felelős és határidő helyessége, emberi javítások száma, előszűrő vesztesége. |
| `results/` | Előrejelzések, mérőszámok, tételenkénti CSV a kézi ellenőrzéshez. |

## Futtatás

```bash
cd research
# 1. Adat (egyszer; kb. 23 MB, a repóba nem kerül be)
mkdir -p data/raw/ami && curl -L -o data/raw/ami/ami_public_manual_1.6.2.zip \
  https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip
unzip -q data/raw/ami/ami_public_manual_1.6.2.zip -d data/raw/ami/extracted
python3 -I scripts/ami_excerpts.py data/raw/ami/extracted data/en_excerpts.jsonl

# 2. Baseline és kiértékelés
python3 -I scripts/baseline.py
python3 -I scripts/evaluate.py baseline

# 3. Nyelvi modell. API-kulcs kell a research/.env fájlba (a git kihagyja):
#      GEMINI_API_KEY=...   https://aistudio.google.com/apikey (a Flash modellek ingyenes kereten is futnak)
#      ANTHROPIC_API_KEY=...   https://platform.claude.com/settings/keys (kredit kell hozzá)
#      OPENAI_API_KEY=...   https://platform.openai.com/api-keys (kredit kell hozzá)
#    A szolgáltató a modellnévből jön: gemini-* → Google, claude-* → Anthropic, minden más → OpenAI.
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -I scripts/llm_recognize.py --split dev --limit 3   # próba
.venv/bin/python -I scripts/llm_recognize.py                         # claude-haiku-5-5 (39 részlet ~2 cent)
.venv/bin/python -I scripts/llm_recognize.py --prefilter            # kulcsszavas előszűrővel
.venv/bin/python -I scripts/llm_recognize.py --model gemini-3.6-flash  # ugyanez Geminivel (ingyenes keret)
.venv/bin/python -I scripts/llm_recognize.py --model gpt-6.1-sol    # ugyanez OpenAI-jal
python3 -I scripts/evaluate.py baseline llm-claude-haiku-5-5 llm-claude-haiku-5-5-prefiltered

# Jelölés-ellenőrző nézet újragenerálása
python3 -I scripts/render_review.py
```

A szkripteket `python3 -I`-vel futtatjuk, mert letöltött adatot olvasnak.

## Források és felhasználási feltételek

| Forrás | Hol | Licenc | Hivatkozás |
|---|---|---|---|
| AMI Meeting Corpus, kézi annotációk 1.6.2 | https://groups.inf.ed.ac.uk/ami/download | CC BY 4.0 (a letöltött `LICENCE.txt` szerint) | Carletta et al.: *The AMI Meeting Corpus: A Pre-announcement*, MLMI 2005 |
| Saját magyar próbakészlet | ez a repó | saját | — |

QMSum ebben a körben nincs felhasználva.

Az AMI-ból csak szöveget és annotációt használunk; hangot és videót nem. A felelős, a határidő és az elfogadás mező nincs benne az AMI-ban. Ezeket kézzel kell ellenőrizni és kiegészíteni. Az AMI összefoglaló-mondata csak segítség a jelölőnek.

## Ismert korlátok

- **Kis minta:** a minta kicsi (25 angol + 14 magyar részlet). Az eredmény irányt mutat, de nem statisztikailag megbízható.
- **Természetes megbeszélések helye:** a természetes (IB) megbeszéléseknél az összefoglaló nincs visszakötve a megszólalásokhoz. A részlet helyét szóátfedés alapján kerestük, és ez egy esetben (IB4011-a1) az összefoglaló egy másik pontját találta el. Ezt jelöltük.
- **Magyar készlet:** a magyar részletek összeállított próbapéldák. Valódi, hozzájárulással gyűjtött magyar csapatbeszélgetésen később kell ellenőrizni.
- **Automatikus egyezésvizsgálat:** a feladat- és határidő-egyezést az `evaluate.py` szóátfedéssel közelíti. A `results/*_items.csv`-ben minden pár kézzel ellenőrizhető.
