# Research: interpreting conversations and evaluating recognition

This folder is work stream "A" of the thesis. It is independent of the application: it imports nothing from it, and the application does not run from here.

## Contents

| Path | What it is |
|---|---|
| `data/en_excerpts.jsonl` | 25 short English excerpts from 11 AMI meetings (4 natural, 7 role-play), with source identifiers. |
| `data/hu_constructed.jsonl` | 14 short Hungarian chat excerpts. **Constructed test examples, not real data.** They cover the cases of the business rules. |
| `data/split.json` | Development and held-out evaluation sides, split by conversation: a meeting or a chat appears on one side only. |
| `annotation/GUIDE.md` | Annotation guide. |
| `annotation/*_gold.jsonl` | The correct interpretation of each excerpt. **Currently a draft prepared by AI, awaiting manual review** (`verified: false`). |
| `annotation/REVIEW.md` | A generated, readable view for the review. |
| `scripts/ami_excerpts.py` | Cuts the excerpts out of the AMI manual annotations. |
| `scripts/baseline.py` | Rule-based baseline (keywords and patterns). |
| `scripts/llm_recognize.py` | An existing language model (Gemini, Claude or OpenAI GPT) on the same excerpts, with schema-bound output. |
| `scripts/evaluate.py` | Metrics: false and missed suggestions; correctness of task, owner and deadline; number of human corrections; loss caused by the prefilter. |
| `results/` | Predictions, metrics, and a per-item CSV for manual checking. |

## Running

```bash
cd research
# 1. Data (once; about 23 MB, it does not go into the repository)
mkdir -p data/raw/ami && curl -L -o data/raw/ami/ami_public_manual_1.6.2.zip \
  https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip
unzip -q data/raw/ami/ami_public_manual_1.6.2.zip -d data/raw/ami/extracted
python3 -I scripts/ami_excerpts.py data/raw/ami/extracted data/en_excerpts.jsonl

# 2. Baseline and evaluation
python3 -I scripts/baseline.py
python3 -I scripts/evaluate.py baseline

# 3. Language model. Needs an API key in research/.env (git ignores it):
#      GEMINI_API_KEY=...   https://aistudio.google.com/apikey (the Flash models also run on the free tier)
#      ANTHROPIC_API_KEY=...   https://platform.claude.com/settings/keys (needs credit)
#      OPENAI_API_KEY=...   https://platform.openai.com/api-keys (needs credit)
#    The provider comes from the model name: gemini-* → Google, claude-* → Anthropic, anything else → OpenAI.
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -I scripts/llm_recognize.py --split dev --limit 3   # trial
.venv/bin/python -I scripts/llm_recognize.py                         # claude-haiku-5-5 (39 excerpts, ~2 cents)
.venv/bin/python -I scripts/llm_recognize.py --prefilter            # with the keyword prefilter
.venv/bin/python -I scripts/llm_recognize.py --model gemini-3.6-flash  # the same with Gemini (free tier)
.venv/bin/python -I scripts/llm_recognize.py --model gpt-6.1-sol    # the same with OpenAI
python3 -I scripts/evaluate.py baseline llm-claude-haiku-5-5 llm-claude-haiku-5-5-prefiltered

# Regenerate the annotation review view
python3 -I scripts/render_review.py
```

The scripts are run with `python3 -I` because they read downloaded data.

## Sources and terms of use

| Source | Where | Licence | Citation |
|---|---|---|---|
| AMI Meeting Corpus, manual annotations 1.6.2 | https://groups.inf.ed.ac.uk/ami/download | CC BY 4.0 (according to the downloaded `LICENCE.txt`) | Carletta et al.: *The AMI Meeting Corpus: A Pre-announcement*, MLMI 2005 |
| Own Hungarian test set | this repository | own | — |

QMSum is not used in this round.

From AMI we use only text and annotations, no audio or video. The owner, deadline and agreement fields are not in AMI. They have to be checked and filled in by hand. The AMI summary sentence is only a help for the annotator.

## Known limitations

- **Small sample:** the sample is small (25 English + 14 Hungarian excerpts). The result shows a direction, but it is not statistically reliable.
- **Locating the natural meetings:** for the natural (IB) meetings the summary is not linked back to the utterances. The place of the excerpt was found by word overlap, and in one case (IB4011-a1) this hit a different point of the summary. This is marked.
- **Hungarian set:** the Hungarian excerpts are constructed test examples. They have to be checked later on real Hungarian team conversations collected with consent.
- **Automatic matching:** `evaluate.py` approximates the task and deadline match by word overlap. Every pair can be checked by hand in `results/*_items.csv`.
