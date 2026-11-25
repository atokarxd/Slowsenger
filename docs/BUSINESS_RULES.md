# Business rules: commitments

> Status: **first version, tried out** on the samples in `research/` (see section 7) and on the tests of the application's state machine; the recognizer is in the application (section 6). Last modified: 2026-11-25.

## 1. Three separate layers

The system keeps three things apart, and none of them overwrites another:

| Layer | What it is | Who creates it | Can it change |
|---|---|---|---|
| **Conversation** | The messages, with stable identifiers. | The participants. | No: a commitment only refers to it. |
| **Suggestion** | According to the recognizer (or a member, by hand), this may be a commitment. It holds the identifier of the source message(s), the task, the owner and the deadline, if the conversation states them. | The recognizer or a member. | Only through a new version. |
| **Confirmed commitment** | What the person concerned has accepted in the application. | Only the acceptance of the person concerned. | Only through the transitions of the state machine, logged. |

Agreement as the model sees it (e.g. "Okay" in the conversation) is not acceptance. At most it signals that a suggestion is worth making.

## 2. State machine

```
              accept (owner)              complete (owner)
 proposed ───────────────────▶ accepted ─────────────────────▶ completed
    │                             │  ▲                              ▲
    │ reject (owner, or the       │  │ change accepted              │ complete
    │  room admin for a           │  │ (new version)                │ (late too)
    │  wrong suggestion)          │  │                              │
    ▼                             │  └──── change proposed          │
 rejected                         │                            overdue (derived:
                                  │ withdraw (owner, with reason)   accepted + deadline passed)
                                  ▼
                              withdrawn
```

| State | Meaning |
|---|---|
| `proposed` | A suggestion. Not a commitment yet; only the owner can accept or reject it. |
| `accepted` | An accepted commitment. |
| `overdue` | Accepted, and its deadline has passed. Not a stored state but computed from the deadline, so being late does not rule out completion. |
| `completed` | Done. |
| `rejected` | The suggestion was rejected. It is kept and can be traced. |
| `withdrawn` | The owner withdrew a commitment already accepted. It is kept and can be traced. It was added to the original state machine at the supervisor's request. |

**Transitions and permissions**

| Transition | Who may do it | Condition |
|---|---|---|
| `accept` | The owner of the suggestion. | The owner is known. With an unknown owner, someone first has to take it on (`claim`): they become the owner and can then accept it. |
| `reject` | The owner; or the room admin, if the suggestion is a wrong recognition. | Only from `proposed`. |
| `complete` | The owner. | `accepted` or `overdue`. |
| `withdraw` | The owner. | `accepted` or `overdue`, with a reason. |
| `propose_change` | Anyone in the room. | On an open commitment, at least one field (task, deadline, owner) changes. |
| `accept_change` | See section 3. | There is a pending change. |

`completed`, `rejected` and `withdrawn` are final states. Instead of reopening, a new commitment is created that refers to the old one.

Every transition goes into the commitment's log as an event: who, when, what, from which state to which, and why, if there is a reason. The log can only grow.

## 3. Changes

The supervisor's example: "Megcsinálnád péntekig?" ("Could you do it by Friday?") → "Igen, vállalom." ("Yes, I'll do it.") → "Inkább hétfőre tudom." ("I can do it by Monday rather.")

1. The first two messages become a suggestion (owner: whoever said yes; deadline: Friday). The owner accepts it in the application.
2. "Inkább hétfőre tudom" is a **change proposal**, not a new agreement. Friday stays in force until the change is accepted.
3. Who accepts the change:
   - **the owner asks for the change:** the person who originally made the request accepts it. If the owner took it on unasked, the change applies at once, but it is logged as a new version.
   - **someone else asks for it** (e.g. an earlier deadline): the owner has to accept it.
   - **the owner changes:** the new owner has to accept it; in effect it is a new suggestion.
4. The earlier version is kept. The interface shows "originally: Friday".

## 4. When the recognizer may make a suggestion

| Situation | Decision | Example from the sample |
|---|---|---|
| Someone takes on a task themselves (even without a deadline). | **suggestion** for the speaker | "I'll circulate it to everyone" (`ami-IB4005-a1`); "A bejelentkezési hibát majd megnézem." ("I'll look at the login bug.", `hu-07`) |
| A request, and the person asked says yes. | **suggestion** for the person asked | `hu-01`, `hu-08` |
| An assignment ("as the industrial designer, you're gonna…"), and no refusal. | **suggestion** for the person named, marked `assigned` | `ami-ES2002a-a1`, `ami-ES2008b-a2` |
| Explicitly addressed to everyone ("each of you", "mindenki"). | **a separate suggestion** for each person | `ami-ES2008b-a1`, `hu-12` |
| Several tasks in one message. | **several separate suggestions** | `hu-08`, `ami-ES2008b-a2` |
| A request with no owner ("Valaki ránézne…?", "Could someone look at…?"), or it is not clear who does it ("holnapra meglesz", "it will be ready by tomorrow"). | **ask for clarification**; we do not invent an owner | `hu-03`, `hu-04` |
| A conditional offer ("Ha Péter nem ér rá, én elviszem", "If Péter can't make it, I'll take it"). | **ask for clarification** | `hu-11`, `ami-IS1008b-a2` |
| A request to a group with no answer. | **ask for clarification** | `ami-IB4003-a3` |
| An immediate action during the meeting ("I will present…", "Most átküldöm a linket", "I'm sending the link now"). | **no commitment** | `ami-IS1003b-c1`, `hu-10` |
| A report of the past ("elküldtem a számlát", "I've sent the invoice"). | **no new commitment**; at most it can signal that an existing one is done | `hu-06` |
| A joke, a hypothetical condition. | **no commitment** | `hu-09` |
| A refused request. | **no commitment** | `hu-13` |
| A meeting of the two people of a direct conversation, proposed with a day or time ("Holnap 11:00-kor lemegyünk gym-be?"). | **suggestion** for the person it is proposed to, who accepts or declines it like an invite (since 2026-11-25) | — |
| A group decision with no owner, a meeting time agreed in a meeting. | **no commitment** (a decision; this is the topic of the second semester) | `ami-IB4010-a1` |
| Withdrawal ("mégsem fér bele", "I can't fit it in after all"). | **a suggested state change** for the existing commitment; the commitment is not deleted | `hu-05` |
| A deadline change ("inkább hétfőre", "Monday rather"). | **change proposal** (section 3) | `hu-02` |

When the recognizer is unsure, it leans towards clarification. A missed suggestion can be added by hand, but a false one creates noise and erodes trust.

## 5. Source, repeated processing, permissions

- **Source:** every suggestion refers to its source message: the earliest message it is based on (for a request answered with "yes", the request). Each person has their own copy of a message, so the stable key is made from what the copies share: the conversation, the author and the time the message was sent.
- **Idempotency:** the key of a suggestion is that source plus its owner (`commitments.source_key`: `<conversation>|<author>|<time>|<owner>`). Processing the same message again, from either copy, or the answer to a request already suggested, yields the same key, so no duplicate is created. Reprocessing never rewrites an existing commitment.
- **Edited message:** starts a new recognition round. It does not rewrite a commitment already accepted; at most it proposes a change.
- **Consent:** the recognizer and the summary send the conversation's text to an outside AI (Anthropic's Claude). They run only where everyone in the conversation has turned on **AI suggestions** in their profile; it is off by default, and only the user sees their own setting. The server checks it (`conversation_ai_allowed`), not the interface.
- **Permissions:** the members of the room see the commitments. Only the person named in section 2 can carry out a transition. The server checks this (Supabase: database functions and RLS), not the interface.

## 6. In the application (2026-11-25)

The recognizer runs after every direct message sent, on the server (Edge Function `recognize-commitments`): the prefilter, then Claude Haiku 5.5 with the research prompt over the new message and the eleven before it. Of the rows of section 4, it suggests:

- a commitment taken on, accepted or assigned, and a request still unanswered, for the person named (a request is accepted or rejected by the person asked, on its card);
- one for each person when it is meant for everyone;
- one with **nobody named** when the conversation does not say who: its card asks for someone to take it on (the clarification of section 4);
- a **meeting** of the two of them with a day or time said (what the research prompt calls a `group_plan`): for the one it is proposed to, asked by the one who proposed it.

The day and time said ("holnap 11-kor", "péntekig", "jövő kedden", "tomorrow at 3pm") become the card's date: the application reads them, from when the message was sent and in the user's time zone. The recognizer itself still never infers a date (its prompt is unchanged); what the application cannot read ("a meeting után") stays in the title, as it was said.

Not yet: conditional offers, group decisions, withdrawals and changes of an existing commitment, and suggestions in groups (commitments are between two people for now). A suggestion is a proposal created by nobody (`origin = 'detected'`), shown as a card from the app in the middle of the chat; from there it goes through the state machine of section 2 like any other.

## 7. Trial

The rules were tried out in two places:

1. **On conversation excerpts** (`research/`): 25 AMI and 14 Hungarian excerpts with manual labels (still to be verified). Every row of section 4 appears in at least one example, and the recognizers are evaluated against the same labels.
2. **In the application:** the unit tests of the state machine (`SlowsengerOffline/src/app/core/commitments/lifecycle.ts`) check the rules of sections 2–3. Among them: only the owner can accept, completing late is allowed, withdrawals and changes are logged, and there is no way back from a final state.
