# Annotation guide

This guide is for the manual annotation of the `research/annotation/*_gold.jsonl` files. Each excerpt has one line.

> **The current labels are drafts prepared by AI** (`"label_source": "draft: AI assistant"`, `"verified": false`).
> Only what you have reviewed by hand and set to `"verified": true` counts as an evaluation result.
> If you correct something, rewrite the fields and give the reason in the `notes` field.

## Fields per excerpt

| Field | Meaning |
|---|---|
| `has_commitment` | Whether the excerpt contains an **actual commitment**: someone took it on themselves, accepted the request, or it was assigned to them and they did not refuse. A request not accepted, or a conditional offer, is not a commitment yet. |
| `expected_action` | What the system should do: `suggest` (a commitment suggestion for the person concerned to confirm), `clarify` (clarification has to be asked for, because the owner or the task is missing or uncertain), `none` (no commitment may be created). |
| `items` | The task-like utterances that can be recognized in the excerpt (see below). An excerpt without a commitment may also list a request or a group plan here, as documentation. |
| `notes` | Reasoning, uncertainty, differences from the AMI summary. |
| `verified` | `true` if you have checked it by hand. |

## Fields per item (`items`)

| Field | Values |
|---|---|
| `kind` | `commitment`, `request` (not accepted yet), `offer` (conditional offer), `modification` (change to an existing commitment), `withdrawal`, `group_plan` (a group plan or decision with no specific owner) |
| `task` | A short description of the task, based on the conversation. |
| `owner` | The letter of the responsible speaker (`"A"`), a list of several speakers (`["B", "C"]`), `"all"` (explicitly everyone, e.g. "each of you"), or `null` if the conversation does not say. **Must not be invented.** |
| `deadline` | The deadline as it was said ("after the meeting", "péntekig"), or `null` if none was said. **Must not be invented.** |
| `agreement` | `self` (took it on unasked), `accepted` (said yes to a request), `assigned` (it was assigned to them, no acceptance visible), `conditional` (tied to a condition), `none` (no acceptance), `refused`. |
| `evidence` | The identifiers of the excerpt's utterances (AMI dialogue act or segment, or `hu-XX.N` in the Hungarian set) from which the item can be read. |

## Decision rules in short

The detailed rules are in `docs/BUSINESS_RULES.md`. For annotation this is enough:

1. **`suggest`**: there is at least one commitment, and the owner is clear (one speaker, named speakers, or explicitly everyone).
2. **`clarify`**: there is a task, but the owner is missing or uncertain; or it is a conditional offer or a request not accepted.
3. **`none`**: there is no task. This includes an immediate action during the meeting ("I will present…", "can you go to the next slide"), a report of the past, joking, and a vague plan with no specific task.

Agreeing on a meeting time is a decision, not a commitment: `group_plan`, `none`. AMI often files it under "action", so mark this difference in `notes`.
