"""Rule-based baseline: keyword and pattern rules per turn, no language model.

It is meant to be the simple point of comparison, not a good recogniser: first-person future
phrases become commitments of the speaker, requests and assignments look for an owner in the
same turn (name or role) or an acceptance in the next turn, and the first date-like phrase
nearby becomes the deadline.

Usage (from the research folder):
    python3 -I scripts/baseline.py            -> results/baseline.jsonl
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run with python3 -I, which leaves this out
from common import RESULTS, load_excerpts, passes_prefilter, write_jsonl

PATTERNS = {
    'en': {
        'self': re.compile(r"\b(i'll|i will|i'm going to|i am going to|i'm gonna|i can|let me|i shall)\b", re.I),
        'request': re.compile(r"\b(can you|could you|would you|will you|you could|if everyone could)\b", re.I),
        'assign': re.compile(r"\b(you're gonna|you are gonna|you're going to|you will|you'll|you're supposed to|i'm supposed to|supposed to)\b", re.I),
        'everyone': re.compile(r"\b(each|everyone|everybody|all of you)\b", re.I),
        'we': re.compile(r"\b(we'll|we will|we're gonna|we are going to|we need to|we have to|we should)\b", re.I),
        'accept': re.compile(r"^\W*(yes|yeah|yep|sure|okay|ok|right|fine|will do)\b", re.I),
        'deadline': re.compile(
            r"\b(?:(?:by|before|until|on|next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|meeting|time|month)"
            r"|tomorrow|tonight|in (?:thirty|twenty|fifteen|ten|five|\d+) minutes|after the meeting"
            r"|(?:january|february|march|april|may|june|july|august|september|october|november|december) \w+)\b", re.I),
    },
    'hu': {
        'self': re.compile(r"\b(vállalom|majd én|(?:meg|el|át|fel|ki|be|össze|utána|rá)\w*(?:om|em|öm|ok|ek|ök))\b", re.I),
        'request': re.compile(r"\b(\w+(?:nád|néd|nánk)|valaki|tudnád)\b", re.I),
        'assign': re.compile(r"$^"),  # no separate pattern
        'everyone': re.compile(r"\b(mindenki|mindannyian)\b", re.I),
        'we': re.compile(r"\b(\w+(?:unk|ünk))\b", re.I),
        'accept': re.compile(r"^\W*(igen|vállalom|oké|ok|rendben|persze|jó)\b", re.I),
        'deadline': re.compile(
            r"(holnap\s+\d{1,2}-ig|\d{1,2}(?:[:.]\d{2})?-ig"
            r"|\b(?:hétfő|kedd|szerdá|szerda|csütörtök|péntek|szombat|vasárnap|holnap|jövő hét|a hét)\w*)", re.I),
    },
}

ROLE_WORDS = {
    'ID': re.compile(r"\b(industrial design\w*|i_d_)", re.I),
    'UI': re.compile(r"\b(user interface)", re.I),
    'ME': re.compile(r"\b(marketing|market trend)", re.I),
    'PM': re.compile(r"\b(project manager)", re.I),
}


def task_of(text: str, cue: re.Match) -> str:
    words = text[cue.end():].strip(' ,.').split()
    return ' '.join(words[:12]) or text


def mentioned_owner(text: str, excerpt: dict, speaker: str) -> str | None:
    """Speaker named (hu) or whose role is named (AMI) in the turn, other than the one speaking."""
    for turn in excerpt['turns']:
        other = turn['speaker']
        if other == speaker:
            continue
        if turn.get('name') and re.search(rf"\b{re.escape(turn['name'])}", text, re.I):
            return other
        role = turn.get('role')
        if role and role in ROLE_WORDS and ROLE_WORDS[role].search(text):
            return other
    return None


def recognise(excerpt: dict) -> dict:
    rules = PATTERNS[excerpt['language']]
    turns = excerpt['turns']
    items = []
    for i, turn in enumerate(turns):
        text, speaker = turn['text'], turn['speaker']
        nearby = ' '.join(t['text'] for t in turns[i:i + 2])
        deadline = rules['deadline'].search(nearby)
        deadline = deadline.group(0) if deadline else None

        if cue := rules['self'].search(text):
            items.append({'kind': 'commitment', 'task': task_of(text, cue), 'owner': speaker,
                          'deadline': deadline, 'evidence': [turn['da_id']]})
        elif cue := (rules['request'].search(text) or rules['assign'].search(text)):
            owner = mentioned_owner(text, excerpt, speaker)
            reply = turns[i + 1] if i + 1 < len(turns) else None
            if owner is None and reply and reply['speaker'] != speaker and rules['accept'].search(reply['text']):
                owner = reply['speaker']
            if rules['everyone'].search(text):
                owner = 'all'
            items.append({'kind': 'commitment' if owner else 'request', 'task': task_of(text, cue), 'owner': owner,
                          'deadline': deadline, 'evidence': [turn['da_id']]})
        elif cue := rules['everyone'].search(text):
            items.append({'kind': 'commitment', 'task': task_of(text, cue), 'owner': 'all',
                          'deadline': deadline, 'evidence': [turn['da_id']]})
        elif cue := rules['we'].search(text):
            items.append({'kind': 'group_plan', 'task': task_of(text, cue), 'owner': None,
                          'deadline': deadline, 'evidence': [turn['da_id']]})

    if any(item['kind'] == 'commitment' and item['owner'] for item in items):
        action = 'suggest'
    elif any(item['kind'] in ('commitment', 'request') for item in items):
        action = 'clarify'
    else:
        action = 'none'
    return {'id': excerpt['id'], 'expected_action': action, 'items': items,
            'has_commitment': action == 'suggest', 'prefilter': passes_prefilter(excerpt)}


def main() -> None:
    predictions = [recognise(excerpt) for excerpt in load_excerpts().values()]
    write_jsonl(RESULTS / 'baseline.jsonl', predictions)
    print(f'{len(predictions)} excerpts -> {RESULTS / "baseline.jsonl"}')


if __name__ == '__main__':
    main()
