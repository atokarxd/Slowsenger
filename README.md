[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/Ew36zBjj)
# Webfejlesztési keretrendszerek — Projektmunka

> **Hallgató neve:** Tokár István  
> **Neptun kód:** H378482  
> **Projekt téma:** Slowsenger — valós idejű üzenetküldő alkalmazás  
> **Keretrendszer:** Angular 21

---

## About

Slowsenger is a real-time messaging application. Users can register, log in (including via Meta/Facebook OAuth), browse contacts, send messages, manage their profile, and create custom labels for contacts.

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone components, signals) |
| Backend / DB | Supabase (PostgreSQL, Auth, Realtime, Storage) |
| Deployment | Vercel |
| Unit tests | Vitest (via `@angular/build:unit-test`) |
| E2E tests | Playwright |

---

## 🚀 Local setup

```bash
git clone <repo-url>
cd Slowsenger
npm install
npm start          # dev server on http://localhost:4200
```

### Running tests

```bash
npm test           # unit tests (Vitest)
npm run test:e2e   # E2E tests (Playwright) — requires the dev server to be running or starts it automatically
```

---

## 🌐 Public URL

https://slowsenger.vercel.app

---

## 📁 Project structure

```
├── docs/                    # Documentation
│   ├── SPECIFICATION.md     # Functional and non-functional requirements
│   ├── DATAMODEL.md         # Data model (entities, relations)
│   ├── COMPONENTS.md        # Component plan
│   └── AI_PROMPT_LOG.md     # AI prompt log
├── Slowsenger/              # Angular application
│   ├── src/app/
│   │   ├── core/supabase/   # Supabase service layer
│   │   └── pages/           # Auth, Dashboard, Chat, Profile, …
│   ├── e2e/                 # Playwright E2E tests
│   └── playwright.config.ts
└── .github/workflows/       # Automated grading (do not modify)
```

---

## 📅 Milestones

| # | Content | Deadline | Status |
|---|---------|----------|--------|
| 1 | Specification, UI and appearance | 2026.03.29. 23:59 | ✅ |
| 2 | Backend and data | 2026.04.26. 23:59 | ✅ |
| 3 | Security and testing | 2026.05.10. 23:59 | ✅ |

### How to request grading

1. Commit and push your work to the `main` branch
2. Go to the **Actions** tab of the repo
3. Select the **"Mérföldkő értékelés"** workflow
4. Click **"Run workflow"** → choose the milestone → **"Run workflow"**
5. The result will appear as a **GitHub Issue**

> ⚠️ You can run the evaluation **maximum 2 times** per milestone. Use them wisely!  
> ⚠️ Automatic grading also runs at the deadlines.

---

## ⚠️ Important

- Do **not** modify the `.github/workflows/` directory!
- Place documentation files in the `docs/` folder.
- Maintain the `AI_PROMPT_LOG.md` file in the `docs/` folder.
