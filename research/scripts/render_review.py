"""Writes annotation/REVIEW.md: every excerpt with its draft labels, for checking them by hand.

Usage (from the research folder):
    python3 -I scripts/render_review.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run with python3 -I, which leaves this out
from common import ROOT, conversation_of, load_excerpts, load_gold, load_split


def main() -> None:
    excerpts, gold, split = load_excerpts(), load_gold(), load_split()
    lines = ['# Labels for manual review', '',
             'Generated file (`scripts/render_review.py`), do not edit it: corrections go into the `*_gold.jsonl` files.', '']
    for excerpt_id, excerpt in excerpts.items():
        g = gold[excerpt_id]
        state = 'verified' if g.get('verified') else '**not verified**'
        lines += [f'## {excerpt_id}', '',
                  f"{excerpt['origin']} · {split[conversation_of(excerpt)]} · {state}", '']
        if excerpt['source'].get('summary_action'):
            lines += [f"AMI summary (only a help): _{excerpt['source']['summary_action']}_", '']
        for turn in excerpt['turns']:
            who = turn['speaker'] + (f"/{turn['role']}" if turn.get('role') else '') + (f" ({turn['name']})" if turn.get('name') else '')
            lines.append(f"- `{turn['da_id']}` **{who}**: {turn['text']}")
        lines += ['', f"**Decision:** `{g['expected_action']}` · commitment: {'yes' if g['has_commitment'] else 'no'}", '']
        for item in g['items']:
            lines.append(f"- `{item['kind']}` — {item['task']} · owner: `{json.dumps(item['owner'])}` · "
                         f"deadline: `{item['deadline']}` · {item['agreement']}")
        lines += ['', f"_{g['notes']}_", '']
    out = ROOT / 'annotation' / 'REVIEW.md'
    out.write_text('\n'.join(lines), encoding='utf-8')
    print(f'{len(excerpts)} excerpts -> {out}')


if __name__ == '__main__':
    main()
