# Sensitive data

The repository is public (`github.com/atokarxd/Slowsenger`). Whatever gets into a commit once stays in the history, in forks and in caches even after it is deleted. This list says what must not get into the repository, an e-mail, a screenshot or an AI chat, and where it belongs instead.

The files to be committed are checked by `scripts/check_secrets.py` (see [Checks](#checks)).

## Keys and secrets

| Kind | How to recognize it | Where it belongs | If it leaked |
|---|---|---|---|
| Anthropic API key | `sk-ant-…` | Research: `research/.env`. The app: only the Edge Function secret `ANTHROPIC_API_KEY` (a key of its own, not the research one; never in `environment.ts`) | Claude Console: delete, new key |
| OpenAI API key | `sk-…`, `sk-proj-…` | `research/.env` | platform.openai.com: revoke, new key |
| Google (Gemini) API key | `AIza…` | `research/.env` | Google AI Studio: delete, new key |
| GIPHY API key | 32 letters and digits | Online: the Edge Function secret `GIPHY_API_KEY` (never in `Slowsenger/src/environments/environment.ts`, which is public). Offline: `SlowsengerOffline/src/environments/environment.ts`, which is gitignored | developers.giphy.com: delete the app's key, new key |
| Supabase `service_role` / secret key | JWT `"role": "service_role"`, `sb_secret_…` | Only on the server (Edge Function secret). Never in the client. | Supabase, API keys: rotate |
| Supabase `anon` / publishable key and URL | JWT `"role": "anon"`, `sb_publishable_…` | May be in the client (`environment.ts`), but only if every table has RLS | Not a secret; RLS provides the protection |
| Database password, connection URL | `postgres://<user>:<password>@…` | Server-side `.env` | Supabase: reset database password |
| Signing secret, app secret, webhook token | `JWT_SECRET=`, `META_APP_SECRET=`, `…_VERIFY_TOKEN=` | Server-side `.env` | Regenerate at the provider |
| GitHub token, SSH or other private key | `ghp_…`, `github_pat_…`, `-----BEGIN … PRIVATE KEY-----` | `~/.ssh`, keychain | GitHub: revoke; new SSH key |
| File containing a key | `.env`, `.env.local`, `*.pem`, `*.key`, `credentials*.json`, `service-account*.json` | Gitignored; only `.env.example` with empty values may go into the repository | As for the keys in it |
| Login token in a log or an image | `Authorization: Bearer eyJ…`, localStorage `sb-…-auth-token`, HAR file | Nowhere | Sign out on every device |

## Personal data

- **Neptun code, student e-mail, phone number, home address:** fine in the submission and in letters to the supervisor. Not needed in the public repository.
- **Commit author e-mail:** public in the metadata of every commit. The GitHub noreply address can be used instead (`git config user.email <id>+<name>@users.noreply.github.com`).
- **Real conversations and their participants:** messages, names, phone numbers, Supabase user identifiers (UUID), profile pictures. They may only be collected with consent. They may go into the repository only anonymized, with speakers marked by letters, as in the gold files (A, B, C). The raw data stays in a gitignored folder, like `research/data/raw/`.
- **Screenshots for the thesis and the reports:** taken with a test account and made-up names. No real e-mail, token or identifier in the URL may show on them.
- **AI tools:** no key, password or real conversation goes into a chat. Anything that got in anyway has to be treated as leaked.

## Current state (2026-11-17)

| What | State | To do |
|---|---|---|
| `Slowsenger/backend/.env` (`PORT`, `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`) | In the public history since 2026-04-26 (`d588147`). The deletion in `9cdebda` did not remove it from there. The Meta app was deleted on 2026-11-17, so the secret and the token no longer open anything. | Nothing. The Meta integration has not been in the code since `a1b5fcc`. |
| API keys pasted into the chat (Anthropic, Gemini, OpenAI) | They are in `research/.env`, which is gitignored; they did not get into the repository | Replace them after the deadline |
| `Slowsenger/src/environments/environment.ts` | Supabase URL and `anon` key | Fine, as long as every table has RLS |
| The AI features (2026-11-25) | The conversation's text goes to Anthropic only where everyone has turned on AI suggestions; the key is an Edge Function secret | Use a new key for the app, with a spending limit in the Claude Console |
| `README.md`, line 3 | Neptun code, public | Decide whether it is needed; the supervisor gets it in the e-mail anyway |
| `docs/REPORT_2026-11-06.md` | Neptun code; not in the repository | Fine for the submission |
| `Slowsenger/e2e/login.spec.ts` | `access_token` in a mocked response | A made-up value, not a JWT; fine |

## Checks

```
python3 -I scripts/check_secrets.py              # the staged files, before a commit
python3 -I scripts/check_secrets.py --all        # every tracked file
python3 -I scripts/check_secrets.py --history    # the whole git history
```

The script prints findings only masked (the first few characters and the length).
- **Error (key, file containing a secret, `service_role` key):** exit code 1.
- **Warning (e-mail, phone number, Neptun code, suspicious assignment):** does not stop the commit, but is worth a look.

To run it automatically before each commit (a local setting, it does not go into the repository):

```
printf '#!/bin/sh\npython3 -I scripts/check_secrets.py\n' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

## If something leaked

1. **First invalidate** the key at the provider. Deleting the file is not enough, because it stays in the history and in forks.
2. **Then take it out of the code** and put it in `.env`; only `.env.example` goes into the repository.
3. **Rewriting the history** (`git filter-repo`) can only come after that, and even then it is only worth it if the content itself is sensitive, such as personal data. For a key, replacing it is what matters.
