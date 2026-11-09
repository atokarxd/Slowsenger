"""Loading the excerpts, gold labels and split, plus the keyword pre-filter shared by all systems."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXCERPT_FILES = [ROOT / 'data' / 'en_excerpts.jsonl', ROOT / 'data' / 'hu_constructed.jsonl']
GOLD_FILES = [ROOT / 'annotation' / 'en_gold.jsonl', ROOT / 'annotation' / 'hu_gold.jsonl']
SPLIT_FILE = ROOT / 'data' / 'split.json'
RESULTS = ROOT / 'results'


def load_jsonl(path: Path) -> list[dict]:
    """JSON objects one after the other: one per line, or spread over several lines (the gold files
    are indented by hand for reading)."""
    text = path.read_text(encoding='utf-8')
    decoder, rows, at = json.JSONDecoder(), [], 0
    while start := re.compile(r'\S').search(text, at):  # the next object starts at the next non-space
        row, at = decoder.raw_decode(text, start.start())
        rows.append(row)
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + '\n')


def load_excerpts() -> dict[str, dict]:
    return {e['id']: e for path in EXCERPT_FILES for e in load_jsonl(path)}


def load_gold() -> dict[str, dict]:
    return {g['id']: g for path in GOLD_FILES for g in load_jsonl(path)}


def conversation_of(excerpt: dict) -> str:
    source = excerpt['source']
    return source.get('meeting') or source['conversation']


def load_split() -> dict[str, str]:
    """Conversation (AMI meeting or hu-XX) -> 'dev' or 'eval'."""
    split = json.loads(SPLIT_FILE.read_text(encoding='utf-8'))
    sides = {conversation: side for side in ('dev', 'eval') for conversation in split[side]}
    overlap = set(split['dev']) & set(split['eval'])
    if overlap:
        raise ValueError(f'on both sides of the split: {overlap}')
    return sides


def excerpt_text(excerpt: dict) -> str:
    """The excerpt as the systems see it: one line per turn with its id and speaker."""
    lines = []
    for turn in excerpt['turns']:
        who = turn['speaker'] + (f" ({turn['role']})" if turn.get('role') else '') + (f" ({turn['name']})" if turn.get('name') else '')
        lines.append(f"[{turn['da_id']}] {who}: {turn['text']}")
    return '\n'.join(lines)


# Cheap gate in front of the expensive recogniser: an excerpt without any of these is not sent on.
# Deliberately broad; its loss (positive excerpts it drops) is measured by evaluate.py.
PREFILTER = {
    'en': re.compile(
        r"\b(i'll|i will|i'm going to|i'm gonna|i can|let me|we'll|we will|we're gonna|you'll|you will|you're gonna|"
        r"you're going to|supposed to|could you|can you|would you|will you|you could|everyone|each|"
        r"next (meeting|time|week)|by (monday|tuesday|wednesday|thursday|friday|tomorrow)|deadline|action)\b",
        re.IGNORECASE),
    'hu': re.compile(
        r"(vállal|majd|megcsinál|elkészít|megír|megnéz|átnéz|elküld|átküld|feltölt|elvisz|elintéz|ránéz|utánanéz|"
        r"mindenki|valaki|\w+(nád|néd)\b|\w+ig\b|holnap|hétfő|kedd|szerd|csütörtök|péntek|szombat|vasárnap|jövő hét)",
        re.IGNORECASE),
}


def passes_prefilter(excerpt: dict) -> bool:
    pattern = PREFILTER[excerpt['language']]
    return any(pattern.search(turn['text']) for turn in excerpt['turns'])
