# Slowsenger — Commitment Tracking from Group Conversations

> **Student:** István Tokár (Neptun: A7YLTZ)  
> **Thesis:** A system that builds a structured commitment and decision register from group conversations  
> **Semester:** Thesis I (SZD I.), Fall 2026/27  
> **Live version:** https://slowsenger.vercel.app

---

## Project goal

In small teams (2–15 people), the actual agreements are made in group chats, but as free text they quickly get lost in the message stream. The goal of the system is to turn conversations into trackable commitments: who committed to what, by when, and what has happened since.

The critical problem is correctly interpreting whether a sentence is a **request, a commitment, a modification, or a withdrawal**. The system only makes suggestions: a commitment is created exclusively upon confirmation by the person concerned.

---

## Scope: earlier course project vs. thesis work

| | Content |
|---|---|
| **Earlier course project** (Web Development Frameworks, Spring 2026) | Registration and login, contacts, real-time messaging, profile management, labels. Its final state is available under the `targyprojekt-vege` tag. |
| **Thesis work** (from Fall 2026) | Shared rooms and membership, stable source-message identification, the commitment lifecycle, conversation interpretation, the recognizer and its evaluation. |

---

## Two parallel work streams

### A) Conversation interpretation and business rules

- Manual annotation of meeting excerpts traceable to their source: is there a commitment, what is the task, who is responsible, is there a deadline, and was it confirmed.
- Defining business rules on concrete cases: when a suggestion may be made, when clarification must be requested, and when no commitment may be created.
- Comparing a rule-based baseline and an existing language model on the same examples.

I start with this stream, on a small sample, because it carries the greater risk.

### B) Application

- Shared rooms and membership; stable message identification instead of the current sender and recipient message copies.
- The full commitment workflow done manually: suggestion linked to a source message, acceptance, modification, closure.
- Server-side enforcement of business rules and permissions in Supabase (Row Level Security, database functions).
- Repeated processing must not create duplicates, and a single message may yield several separate commitments.

The application does not wait for the model: automatic recognition will later plug into this workflow, so the system remains usable even if the model fails.

---

## Principles

- I keep separate **what the conversation says**, **what the recognizer suggests**, and **what the person concerned confirmed** in the application. Agreement inferred by the model does not replace confirmation.
- The system does not guess an uncertain assignee or deadline; it asks for clarification instead.
- A modification does not silently overwrite the earlier commitment, and withdrawals remain traceable.
- A missed deadline does not prevent later completion.

---

## Data sources

| Source | Use | Notes |
|---|---|---|
| AMI Meeting Corpus (text transcripts and annotations) | Primary source for the manually annotated excerpts | Text only, without audio or video processing. For each excerpt I mark whether it comes from a role-play (scenario) or a natural meeting. The assignee, deadline and acceptance fields are manually verified and completed. |
| QMSum | Supplementary source for studying conversational context | A summarization dataset, not a ready-made commitment register. |
| Own Hungarian test set | Verifying behavior on Hungarian text | Translated or generated text does not count as real data. The method will later also be validated on Hungarian team conversations collected with proper consent. |

**Availability and terms of use:**

| Source | Availability | License | Citation |
|---|---|---|---|
| AMI Meeting Corpus | https://groups.inf.ed.ac.uk/ami/download | CC BY 4.0 (signals, transcripts and some of the annotations); the `LICENCE.txt` file in the downloaded annotation package is authoritative | Carletta et al.: *The AMI Meeting Corpus: A Pre-announcement*, MLMI 2005 |
| QMSum | https://github.com/Yale-LILY/QMSum | MIT (according to the repository's `LICENSE` file) | Zhong et al.: *QMSum: A New Benchmark for Query-based Multi-domain Meeting Summarization*, NAACL 2021 |
| Own Hungarian test set | not public | with participants' consent | — |

**Starting points:**
- *Shallow Discourse Structure for Action Item Detection* — the approach of examining the task description, the owner, the timeframe and the agreement separately.
- Microsoft Teams Facilitator — the user workflow of task detection with a separate acceptance step (studied as a reference only, without integration).

---

## Evaluation

- I start with about 20 short excerpts from several meetings, plus a smaller Hungarian set.
- A held-out evaluation set is used; excerpts and translations of the same conversation must not appear on both the development and the evaluation side.
- Metrics: false and missed commitment suggestions; correctness of task, assignee and deadline; required human corrections; and the loss caused by keyword-based pre-filtering.
- Comparison: a rule-based baseline, then an existing language model (e.g. Qwen3-8B as an open model, or initially a model API with limited cost). Training a custom model is not a goal. Decisions on Hungarian accuracy and model choice will be based on the results.

---

## Thesis I — semester goal

A demonstrable prototype in which:

- commitment management can be completed manually end to end (room, membership, suggestion, acceptance, modification, closure);
- AI-based suggestions are built on top of this, with human confirmation;
- recognition has been evaluated on the held-out examples, with results and known limitations documented;
- the application can be started reproducibly.

### Schedule (supervisor checkpoints)

| Date | Checkpoint | Status |
|---|---|---|
| 2026-10-09 | Two work streams, data source and semester goal documented | ✅ |
| 2026-11-06 | First recognition comparison on a small, manually verified sample; trial of business rules; working manual commitment management | ⏳ |
| 2026-12-04 | Integrated AI suggestions, human confirmation, evaluation on held-out examples | ⏳ |
| 2027-01-15 | Demonstrable prototype, reproducible startup, results and known limitations | ⏳ |
| 2027-01-30 | Finalized Thesis I result with corrections | ⏳ |

### Deferred

- Standalone decision detection, external chat integrations, P2P extension.
- Thesis II: more thorough user testing, finalizing deployment, completing the thesis.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone components, signals) |
| Backend / DB | Supabase (PostgreSQL, Auth, Realtime, Storage) |
| Deployment | Vercel |
| Unit tests | Vitest (`@angular/build:unit-test`) |
| E2E tests | Playwright |

---

## Local setup

```bash
git clone <repo-url>
cd Slowsenger
npm install
npm start          # dev server on http://localhost:4200
```

### Running tests

```bash
npm test           # unit tests (Vitest)
npm run test:e2e   # E2E tests (Playwright)
```

Credentials (API keys, tokens) are never committed to the repository.

---

## Documentation

| File | Content |
|---|---|
| `docs/SPECIFICATION.md` | Functional and non-functional requirements |
| `docs/DATAMODEL.md` | Data model (entities, relations) |
| `docs/COMPONENTS.md` | Component plan |
| `docs/AI_PROMPT_LOG.md` | Actual use and verification of AI tools |

---

## Project structure

```
├── docs/                    # Documentation
├── Slowsenger/              # Angular application
│   ├── src/app/
│   │   ├── core/supabase/   # Supabase service layer
│   │   └── pages/           # Auth, Dashboard, Chat, Profile, …
│   ├── e2e/                 # Playwright E2E tests
│   └── playwright.config.ts
└── .github/workflows/       # Automated grading of the earlier course
```

---

<details>
<summary>Earlier course project: milestones (archived)</summary>

| # | Content | Deadline | Status |
|---|---------|----------|--------|
| 1 | Specification, UI and appearance | 2026-03-29 23:59 | ✅ |
| 2 | Backend and data | 2026-04-26 23:59 | ✅ |
| 3 | Security and testing | 2026-05-10 23:59 | ✅ |

</details>