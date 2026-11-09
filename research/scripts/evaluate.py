"""Compares a system's predictions with the gold labels, per split (dev / eval) and language.

Measures:
  - false and missed commitment suggestions, per excerpt (expected_action == 'suggest');
  - accuracy of the suggest / clarify / none decision;
  - per commitment: task, owner and deadline correctness on the matched items;
  - human corrections: deleting a wrong item, creating a missed one, fixing a wrong field;
  - keyword pre-filter loss: excerpts that need a suggestion or clarification but are dropped.

Task and deadline matching are approximate (word overlap); the per-item CSV lists every pair so
they can be checked by hand.

Usage (from the research folder):
    python3 -I scripts/evaluate.py baseline [llm-claude-haiku-5-5 ...]
"""

import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run with python3 -I, which leaves this out
from common import RESULTS, conversation_of, load_excerpts, load_gold, load_jsonl, load_split, passes_prefilter

COMMITMENT_KINDS = {'commitment', 'modification', 'withdrawal'}
STOP = set('the a an to of and for on in with by it its this that be will is are az a egy és meg is hogy'.split())


def content_words(text: str | None) -> set[str]:
    # 4-letter prefixes: a rough stem that also survives Hungarian suffixes (diáit / diáinak)
    words = re.findall(r'\w+', (text or '').lower())
    return {w[:4] for w in words if len(w) > 2 and w not in STOP}


def same_owner(a, b) -> bool:
    norm = lambda o: tuple(sorted(o)) if isinstance(o, list) else o
    return norm(a) == norm(b)


def same_deadline(gold: str | None, predicted: str | None) -> bool:
    if gold is None or predicted is None:
        return gold is None and predicted is None
    return bool(content_words(gold) & content_words(predicted))


def task_ok(gold: str, predicted: str) -> bool:
    wanted = content_words(gold)
    return bool(wanted) and len(wanted & content_words(predicted)) / len(wanted) >= 0.4


def match_items(gold_items: list[dict], predicted_items: list[dict]) -> tuple[list, list, list]:
    """Greedy matching by shared evidence, then task overlap. Returns pairs, missed, extra."""
    gold_left = [g for g in gold_items if g['kind'] in COMMITMENT_KINDS]
    predicted_left = [p for p in predicted_items if p['kind'] in COMMITMENT_KINDS]
    pairs = []
    for g in list(gold_left):
        scored = [(len(set(g.get('evidence', [])) & set(p.get('evidence', []))),
                   len(content_words(g['task']) & content_words(p['task'])), p) for p in predicted_left]
        scored = [s for s in scored if s[0] or s[1]]
        if scored:
            best = max(scored, key=lambda s: (s[0], s[1]))[2]
            pairs.append((g, best))
            gold_left.remove(g)
            predicted_left.remove(best)
    return pairs, gold_left, predicted_left


def evaluate(system: str) -> dict:
    excerpts, gold, split = load_excerpts(), load_gold(), load_split()
    predictions = {p['id']: p for p in load_jsonl(RESULTS / f'{system}.jsonl')}
    rows, report = [], {}
    groups = {}
    for excerpt_id, excerpt in excerpts.items():
        side = split[conversation_of(excerpt)]
        for key in (f'{side}/{excerpt["language"]}', f'{side}/all'):
            groups.setdefault(key, []).append(excerpt_id)

    for key, ids in sorted(groups.items()):
        m = {'excerpts': 0, 'verified_labels': 0, 'missing_predictions': 0,
             'false_suggestions': 0, 'missed_suggestions': 0, 'true_suggestions': 0, 'action_correct': 0,
             'items_gold': 0, 'items_matched': 0, 'items_missed': 0, 'items_extra': 0,
             'task_correct': 0, 'owner_correct': 0, 'deadline_correct': 0, 'corrections': 0,
             'needs_handling': 0, 'prefilter_dropped_needed': 0, 'prefilter_dropped_other': 0}
        for excerpt_id in ids:
            g = gold[excerpt_id]
            p = predictions.get(excerpt_id)
            m['excerpts'] += 1
            m['verified_labels'] += bool(g.get('verified'))
            if p is None:
                m['missing_predictions'] += 1
                p = {'expected_action': 'none', 'items': []}

            gold_suggest, predicted_suggest = g['expected_action'] == 'suggest', p['expected_action'] == 'suggest'
            m['true_suggestions'] += gold_suggest and predicted_suggest
            m['false_suggestions'] += predicted_suggest and not gold_suggest
            m['missed_suggestions'] += gold_suggest and not predicted_suggest
            m['action_correct'] += g['expected_action'] == p['expected_action']

            needed = g['expected_action'] != 'none'
            m['needs_handling'] += needed
            if not passes_prefilter(excerpts[excerpt_id]):
                m['prefilter_dropped_needed' if needed else 'prefilter_dropped_other'] += 1

            pairs, missed, extra = match_items(g['items'], p['items'])
            m['items_gold'] += len(pairs) + len(missed)
            m['items_matched'] += len(pairs)
            m['items_missed'] += len(missed)
            m['items_extra'] += len(extra)
            m['corrections'] += len(missed) + len(extra)
            for gi, pi in pairs:
                checks = {'task': task_ok(gi['task'], pi['task']), 'owner': same_owner(gi['owner'], pi['owner']),
                          'deadline': same_deadline(gi['deadline'], pi['deadline'])}
                for field, ok in checks.items():
                    m[f'{field}_correct'] += ok
                    m['corrections'] += not ok
                rows.append({'group': key, 'id': excerpt_id, 'status': 'matched',
                             'gold_task': gi['task'], 'pred_task': pi['task'], 'task_ok': checks['task'],
                             'gold_owner': json.dumps(gi['owner']), 'pred_owner': json.dumps(pi['owner']), 'owner_ok': checks['owner'],
                             'gold_deadline': gi['deadline'], 'pred_deadline': pi['deadline'], 'deadline_ok': checks['deadline']})
            for gi in missed:
                rows.append({'group': key, 'id': excerpt_id, 'status': 'missed', 'gold_task': gi['task'],
                             'gold_owner': json.dumps(gi['owner']), 'gold_deadline': gi['deadline']})
            for pi in extra:
                rows.append({'group': key, 'id': excerpt_id, 'status': 'extra', 'pred_task': pi['task'],
                             'pred_owner': json.dumps(pi['owner']), 'pred_deadline': pi['deadline']})
        report[key] = m

    out = RESULTS / f'{system}_metrics.json'
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    with (RESULTS / f'{system}_items.csv').open('w', encoding='utf-8', newline='') as file:
        fields = ['group', 'id', 'status', 'gold_task', 'pred_task', 'task_ok', 'gold_owner', 'pred_owner', 'owner_ok',
                  'gold_deadline', 'pred_deadline', 'deadline_ok']
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(r for r in rows if r['group'].endswith('/all'))
    return report


def print_table(system: str, report: dict) -> None:
    print(f'\n### {system}\n')
    print('| Halmaz | Részlet | Ellenőrzött címke | Helyes döntés | Téves javaslat | Kihagyott javaslat | '
          'Vállalás (gold) | Megtalált | Feladat ok | Felelős ok | Határidő ok | Emberi javítás | Előszűrő vesztesége |')
    print('|' + '---|' * 13)
    for key, m in report.items():
        matched = m['items_matched'] or 1
        print(f"| {key} | {m['excerpts']} | {m['verified_labels']}/{m['excerpts']} | {m['action_correct']}/{m['excerpts']} | "
              f"{m['false_suggestions']} | {m['missed_suggestions']} | {m['items_gold']} | {m['items_matched']} | "
              f"{m['task_correct']}/{m['items_matched']} | {m['owner_correct']}/{m['items_matched']} | "
              f"{m['deadline_correct']}/{m['items_matched']} | {m['corrections']} | "
              f"{m['prefilter_dropped_needed']}/{m['needs_handling']} |")
    if any(m['missing_predictions'] for m in report.values()):
        print('\nFigyelem: van részlet, amire nincs előrejelzés (üres döntésként számolva).')
    if not all(m['verified_labels'] == m['excerpts'] for m in report.values()):
        print('\nFigyelem: a címkék nincsenek mind kézzel ellenőrizve, az eredmény előzetes.')


def main() -> None:
    for system in sys.argv[1:] or ['baseline']:
        print_table(system, evaluate(system))


if __name__ == '__main__':
    main()
