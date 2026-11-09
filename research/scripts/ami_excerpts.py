"""Cuts short, source-traceable excerpts out of the AMI Meeting Corpus manual annotations.

For each chosen meeting it takes action items from the human abstractive summary ("actions"),
follows the summary links to the dialogue acts they were written from, and cuts a window of
dialogue acts around them. It also cuts one control window per meeting that no action or
decision summary sentence points to, so the sample contains excerpts without a commitment.

The natural (non-scenario) meetings have summaries but no summary links, and most have no
dialogue acts either. There the excerpt is cut from speaker segments, around the place whose
words overlap most with the summary sentence; such excerpts are marked and must be checked.

The AMI action sentences are kept only as a reference for the annotator: the owner, deadline
and acceptance fields are not in AMI and have to be checked and filled in by hand.

Usage (from the research folder):
    python3 -I scripts/ami_excerpts.py data/raw/ami/extracted data/en_excerpts.jsonl
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NITE = '{http://nite.sourceforge.net/}'

# Meetings and how many action items to take from each. Natural meetings first: only these
# four AMI non-scenario meetings have abstractive summaries.
MEETINGS = {
    'IB4003': 3,
    'IB4005': 2,
    'IB4010': 1,
    'IB4011': 2,
    'ES2002a': 2,
    'ES2008b': 2,
    'ES2004c': 2,
    'IS1003b': 2,
    'IS1008b': 2,
    'TS3005c': 2,
    'TS3009b': 2,
}

BEFORE = 5  # dialogue acts shown before the first linked one
AFTER = 3  # and after it
CONTROL_LENGTH = BEFORE + AFTER + 1


def words_of(meeting_dir: Path, meeting: str, speaker: str) -> tuple[list[str], dict[str, int], list[dict]]:
    """Word ids in order, their positions, and the word records of one speaker's channel."""
    path = meeting_dir / 'words' / f'{meeting}.{speaker}.words.xml'
    ids, records = [], []
    for element in ET.parse(path).getroot():
        word_id = element.get(f'{NITE}id')
        ids.append(word_id)
        records.append({
            'text': element.text or '',
            'start': element.get('starttime'),
            'punc': element.get('punc') == 'true',
            'tag': element.tag,
        })
    return ids, {word_id: i for i, word_id in enumerate(ids)}, records


def join_words(records: list[dict]) -> str:
    text = ''
    for record in records:
        if record['tag'] != 'w':
            continue  # vocal sounds, gaps, ...
        token = record['text']
        text += token if record['punc'] or not text else f' {token}'
    return text.strip()


STOPWORDS = set('''a an the and or of to in on for with by at from will would be is are was were it its they
them their this that these those one some other group team members member about whether if as can
could should what which who into out up down there here have has had do does did meeting meet next'''.split())


def stems(text: str) -> set[str]:
    words = re.findall(r"[a-z]+", text.lower())
    return {re.sub(r'(ing|ed|es|s)$', '', w) for w in words if len(w) > 3 and w not in STOPWORDS}


def units(root: Path, meeting: str, roles: dict[str, str]) -> tuple[str, list[dict]]:
    """Dialogue acts of a meeting if annotated, else speaker segments; in time order, with text."""
    kind = 'dialogue act' if list((root / 'dialogueActs').glob(f'{meeting}.?.dialog-act.xml')) else 'segment'
    folder, pattern = ('dialogueActs', f'{meeting}.?.dialog-act.xml') if kind == 'dialogue act' \
        else ('segments', f'{meeting}.?.segments.xml')
    acts = []
    for path in sorted((root / folder).glob(pattern)):
        speaker = path.name.split('.')[1]
        ids, position, records = words_of(root, meeting, speaker)
        for act in ET.parse(path).getroot():
            child = act.find(f'{NITE}child')
            if child is None:
                continue
            span = re.findall(r'id\(([^)]+)\)', child.get('href'))
            first, last = position[span[0]], position[span[-1]]
            chunk = records[first:last + 1]
            starts = [float(r['start']) for r in chunk if r['start'] is not None]
            if not starts:
                continue
            acts.append({
                'da_id': act.get(f'{NITE}id'),
                'speaker': speaker,
                'role': roles.get(speaker),
                'start': round(min(starts), 2),
                'text': join_words(chunk),
            })
    acts = [act for act in acts if act['text']]
    acts.sort(key=lambda act: act['start'])
    return kind, acts


def summary_links(root: Path, meeting: str) -> dict[str, list[str]]:
    """Abstractive summary sentence id -> linked dialogue act ids; empty if the meeting has none."""
    links: dict[str, list[str]] = {}
    path = root / 'extractive' / f'{meeting}.summlink.xml'
    if not path.exists():
        return links
    for link in ET.parse(path).getroot():
        pointers = {p.get('role'): p.get('href') for p in link.findall(f'{NITE}pointer')}
        dialogue_act = re.search(r'id\(([^)]+)\)', pointers['extractive']).group(1)
        sentence = re.search(r'id\(([^)]+)\)', pointers['abstractive']).group(1)
        links.setdefault(sentence, []).append(dialogue_act)
    return links


def summary_sections(root: Path, meeting: str) -> dict[str, list[tuple[str, str]]]:
    """Section name (abstract, actions, decisions, problems) -> [(sentence id, text)]."""
    sections: dict[str, list[tuple[str, str]]] = {}
    for section in ET.parse(root / 'abstractive' / f'{meeting}.abssumm.xml').getroot():
        sentences = [(s.get(f'{NITE}id'), ' '.join((s.text or '').split())) for s in section.iter('sentence')]
        sections.setdefault(section.tag, []).extend(sentences)
    return sections


def meeting_info(root: Path) -> dict[str, dict]:
    info = {}
    for meeting in ET.parse(root / 'corpusResources' / 'meetings.xml').getroot():
        roles = {speaker.get('nxt_agent'): speaker.get('role') for speaker in meeting if speaker.get('role')}
        info[meeting.get('observation')] = {'type': meeting.get('type'), 'roles': roles}
    return info


def excerpt_turns(acts: list[dict], start: int, end: int) -> list[dict]:
    return [dict(act) for act in acts[max(0, start):min(len(acts), end)]]


def best_overlap(acts: list[dict], sentence: str, used: set[int]) -> tuple[int | None, int]:
    """Position of the unit (with the two after it) sharing the most words with the sentence."""
    wanted = stems(sentence)
    best, best_score = None, 0
    for i in range(len(acts)):
        if i in used:
            continue
        score = len(wanted & set().union(*(stems(act['text']) for act in acts[i:i + 3])))
        if score > best_score:
            best, best_score = i, score
    return best, best_score


def cut(root: Path) -> list[dict]:
    info = meeting_info(root)
    excerpts = []
    for meeting, wanted in MEETINGS.items():
        meta = info[meeting]
        origin = 'scenario (role-play)' if meta['type'] == 'scenario' else 'natural (non-scenario)'
        unit_kind, acts = units(root, meeting, meta['roles'])
        index = {act['da_id']: i for i, act in enumerate(acts)}
        links = summary_links(root, meeting)
        sections = summary_sections(root, meeting)

        linked_to_summary = {da for sid, das in links.items()
                             for name in ('actions', 'decisions') for s, _ in sections.get(name, [])
                             if s == sid for da in das}

        taken = 0
        used: set[int] = set()
        for sentence_id, sentence in sections.get('actions', []):
            if taken == wanted:
                break
            if links:
                positions = sorted(index[da] for da in links.get(sentence_id, []) if da in index)
                if not positions:
                    continue
                anchor = positions[0]
                selection = 'linked to an action item of the human summary'
                located = {'linked_units': [acts[p]['da_id'] for p in positions]}
            else:
                anchor, score = best_overlap(acts, sentence, used)
                if anchor is None or score < 3:
                    continue
                selection = ('located by word overlap with an action item of the human summary '
                             '(this meeting has no summary links): check that it is the right place')
                located = {'overlap_anchor_unit': acts[anchor]['da_id'], 'overlap_words': score}
            window = range(anchor - BEFORE, anchor + AFTER + 1)
            if any(p in used for p in window):
                continue  # excerpts of a meeting must not overlap
            used.update(window)
            taken += 1
            excerpts.append({
                'id': f'ami-{meeting}-a{taken}',
                'language': 'en',
                'origin': origin,
                'selection': selection,
                'source': {
                    'corpus': 'AMI Meeting Corpus, manual annotations 1.6.2 (CC BY 4.0)',
                    'meeting': meeting,
                    'unit': unit_kind,
                    'summary_sentence_id': sentence_id,
                    'summary_action': sentence,
                    **located,
                },
                'turns': excerpt_turns(acts, anchor - BEFORE, anchor + AFTER + 1),
            })

        # Control window: as far as possible from anything an action or decision points to
        # (without summary links: from the excerpts taken above)
        linked_positions = sorted(index[da] for da in linked_to_summary if da in index) or sorted(used)
        best_start, best_distance = None, -1
        for start in range(0, len(acts) - CONTROL_LENGTH, 7):
            window = range(start, start + CONTROL_LENGTH)
            if any(p in used for p in window):
                continue
            distance = min((min(abs(p - q) for q in window) for p in linked_positions), default=len(acts))
            substantive = sum(len(acts[p]['text'].split()) >= 4 for p in window)
            if substantive >= 5 and distance > best_distance:
                best_start, best_distance = start, distance
        if best_start is not None:
            excerpts.append({
                'id': f'ami-{meeting}-c1',
                'language': 'en',
                'origin': origin,
                'selection': 'control: no action or decision summary sentence points here',
                'source': {
                    'corpus': 'AMI Meeting Corpus, manual annotations 1.6.2 (CC BY 4.0)',
                    'meeting': meeting,
                    'unit': unit_kind,
                    'distance_to_nearest_summary_place': best_distance,
                },
                'turns': excerpt_turns(acts, best_start, best_start + CONTROL_LENGTH),
            })
    return excerpts


def main() -> None:
    root, out = Path(sys.argv[1]), Path(sys.argv[2])
    excerpts = cut(root)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('w', encoding='utf-8') as file:
        for excerpt in excerpts:
            file.write(json.dumps(excerpt, ensure_ascii=False) + '\n')
    print(f'{len(excerpts)} excerpts from {len(MEETINGS)} meetings -> {out}')


if __name__ == '__main__':
    main()
