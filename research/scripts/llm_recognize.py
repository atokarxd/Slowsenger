"""Runs an existing language model (Gemini, Claude or GPT, through their APIs) on the same excerpts as the baseline.

Each excerpt goes out in one request; the answer is constrained to a JSON schema with the same
fields as the gold labels. Answers are appended to results/<system>.jsonl, and excerpts already
there are skipped, so an interrupted run can be continued without paying twice. The provider
follows from the model name: gemini-* goes to Google, claude-* to Anthropic, everything else to OpenAI.

Setup:
    pip install -r requirements.txt
    API keys in research/.env (git ignores it) or exported in the shell:
        GEMINI_API_KEY=...      (Google AI Studio: https://aistudio.google.com/apikey)
        ANTHROPIC_API_KEY=...   (Claude Console: https://platform.claude.com/settings/keys, or `ant auth login`)
        OPENAI_API_KEY=...      (https://platform.openai.com/api-keys)

Usage (from the research folder):
    python3 -I scripts/llm_recognize.py --split dev --limit 5      # try a few first
    python3 -I scripts/llm_recognize.py                            # everything (39 excerpts), Claude Haiku
    python3 -I scripts/llm_recognize.py --model gemini-3.6-flash   # the same with Gemini (free tier)
    python3 -I scripts/llm_recognize.py --model gpt-6.1-sol        # the same with OpenAI
    python3 -I scripts/llm_recognize.py --prefilter                # only what the keyword gate lets through
    python3 -I scripts/evaluate.py baseline llm-claude-haiku-5-5 llm-claude-haiku-5-5-prefiltered
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Callable, NamedTuple

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run with python3 -I, which leaves this out
from common import ROOT, RESULTS, conversation_of, excerpt_text, load_excerpts, load_jsonl, load_split, passes_prefilter

# USD per million tokens (input, output; reasoning counts as output), paid tier, November 2026, for the
# cost estimate printed at the end. The Gemini Flash models are also on Google's free tier.
PRICES = {
    'gemini-3.8-flash': (0.75, 3.75), 'gemini-3.6-flash': (0.75, 3.75), 'gemini-3.5-flash-lite': (0.30, 2.50),
    'gemini-4-argon': (2.00, 10.00),
    'claude-opus-5-5': (4.0, 20.0), 'claude-sonnet-5-5': (2.0, 10.0), 'claude-haiku-5-5': (0.10, 0.50),
    'gpt-6-astra': (10.0, 50.0), 'gpt-6.1-sol': (2.0, 10.0), 'gpt-6.1-terra': (1.0, 5.0), 'gpt-6-luna': (0.10, 0.50),
}
TIMEOUT_S = 120  # per request; a hung request counts as a server error
SKIPS_IN_A_ROW = 3  # the model is probably overloaded: stop instead of waiting on every excerpt

SYSTEM = """You read short excerpts of team meetings or group chats and find the commitments in them, for a \
system that keeps a register of who agreed to do what and by when. The system only makes suggestions: the \
person concerned confirms each one in the app. So your job is to say what the conversation actually shows, \
never more.

Each turn starts with its id in brackets and the speaker's letter (with a role or name if known).

For every task-like utterance, give an item:
- kind: "commitment" (someone takes a task on: volunteers, accepts a request, or is assigned one without \
refusing), "request" (someone is asked, no acceptance yet), "offer" (conditional: "if you need it, I can..."), \
"modification" (an existing commitment's task or deadline changes), "withdrawal" (someone gives a commitment \
back), "group_plan" (the group plans or decides something without a concrete task owner, e.g. a meeting date).
- task: what is to be done, short, in the language of the conversation.
- owner: the speaker letters of who will do it; ["all"] only if explicitly everyone ("each of you", \
"mindenki"); [] if the conversation does not say who. Never guess an owner.
- deadline: the deadline as it was said ("by Friday", "péntekig", "after the meeting"), or null if none was \
said. Never infer a date; "majd" or "later" is not a deadline.
- agreement: "self", "accepted", "assigned", "conditional", "none" or "refused".
- evidence: the ids of the turns it is based on.

Not tasks: things done right now during the meeting ("I will present...", "go to the next slide", "I'm \
sending the link now"), reports of things already done, jokes and hypotheticals.

expected_action for the whole excerpt:
- "suggest": there is at least one commitment with a clear owner (letters or "all");
- "clarify": there is a task, but its owner is missing or uncertain, or it is only a conditional offer or an \
unanswered request;
- "none": nothing that could become a commitment.

uncertainty: one short sentence on what is unclear, or an empty string."""

SCHEMA = {
    'type': 'object',
    'properties': {
        'items': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'kind': {'type': 'string', 'enum': ['commitment', 'request', 'offer', 'modification', 'withdrawal', 'group_plan']},
                    'task': {'type': 'string'},
                    'owner': {'type': 'array', 'items': {'type': 'string'}},
                    'deadline': {'anyOf': [{'type': 'string'}, {'type': 'null'}]},
                    'agreement': {'type': 'string', 'enum': ['self', 'accepted', 'assigned', 'conditional', 'none', 'refused']},
                    'evidence': {'type': 'array', 'items': {'type': 'string'}},
                },
                'required': ['kind', 'task', 'owner', 'deadline', 'agreement', 'evidence'],
                'additionalProperties': False,
            },
        },
        'expected_action': {'type': 'string', 'enum': ['suggest', 'clarify', 'none']},
        'uncertainty': {'type': 'string'},
    },
    'required': ['items', 'expected_action', 'uncertainty'],
    'additionalProperties': False,
}


class Stop(Exception):
    """Nothing more should be sent (bad key, bad model, quota, network); the message says what to do."""


class Skip(Exception):
    """This excerpt failed for a passing reason; it stays out of the results, so the next run retries it."""


class Reply(NamedTuple):
    text: str | None  # the JSON answer
    error: str | None  # why there is no answer (refused, blocked, cut off); kept in the results
    tokens_in: int
    tokens_out: int
    served_by: str | None


def ask_gemini(model: str, effort: str) -> Callable[[str], Reply]:
    import httpx
    from google import genai
    from google.genai import errors, types

    try:
        # The per-minute limit (429) and server errors are retried with growing waits before giving up
        client = genai.Client(http_options=types.HttpOptions(
            timeout=TIMEOUT_S * 1000, retry_options=types.HttpRetryOptions(attempts=4)))
    except ValueError:
        raise Stop('No API key: set GEMINI_API_KEY (https://aistudio.google.com/apikey).')
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM,
        response_mime_type='application/json',
        response_json_schema=SCHEMA,
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel[effort.upper()]),
    )

    def ask(text: str) -> Reply:
        try:
            response = client.models.generate_content(model=model, contents=text, config=config)
        except errors.ClientError as error:
            if error.code == 429:
                raise Stop(f'Quota used up ({error.message}); run the same command again later, finished excerpts are kept.')
            if error.code in (401, 403) or 'API key' in (error.message or ''):
                raise Stop(f'No valid API key: check GEMINI_API_KEY ({error.message}).')
            raise Stop(f'Bad request (fix the script or the model name, nothing more will be sent): {error.code} {error.message}')
        except errors.ServerError as error:
            raise Skip(f'API error {error.code} ({error.message})')
        except httpx.TimeoutException:
            raise Skip(f'no reply in {TIMEOUT_S}s')
        except httpx.TransportError:
            raise Stop('Network error; run the same command again, finished excerpts are kept.')

        usage = response.usage_metadata
        tokens = (usage.prompt_token_count or 0, (usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0)) if usage else (0, 0)
        if response.prompt_feedback and response.prompt_feedback.block_reason:
            return Reply(None, f'blocked ({response.prompt_feedback.block_reason.name})', *tokens, response.model_version)
        finish = response.candidates[0].finish_reason if response.candidates else None
        if finish == types.FinishReason.MAX_TOKENS:
            return Reply(None, 'max_tokens', *tokens, response.model_version)
        if finish != types.FinishReason.STOP or not response.text:
            return Reply(None, f'no answer ({finish.name if finish else "no candidate"})', *tokens, response.model_version)
        return Reply(response.text, None, *tokens, response.model_version)

    return ask


def ask_claude(model: str, effort: str) -> Callable[[str], Reply]:
    import anthropic

    # Rate limits and server errors are retried with growing waits before giving up
    client = anthropic.Anthropic(timeout=TIMEOUT_S, max_retries=4)
    # A declined request is re-run on the model Anthropic recommends for that kind of decline; Haiku has none
    fallback = {} if 'haiku' in model else {'betas': ['server-side-fallback-2026-07-01'], 'fallbacks': 'default'}

    def ask(text: str) -> Reply:
        try:
            response = client.beta.messages.create(
                model=model,
                max_tokens=16000,
                system=SYSTEM,
                messages=[{'role': 'user', 'content': text}],
                output_config={'effort': effort, 'format': {'type': 'json_schema', 'schema': SCHEMA}},
                **fallback,
            )
        except anthropic.AuthenticationError:
            raise Stop('No valid API key: check ANTHROPIC_API_KEY.')
        except anthropic.RateLimitError as error:
            raise Stop(f'Rate or spend limit ({error.message}); run the same command again later, finished excerpts are kept.')
        except (anthropic.BadRequestError, anthropic.PermissionDeniedError, anthropic.NotFoundError) as error:
            raise Stop(f'Bad request (fix the script or the model name, nothing more will be sent): {error.status_code} {error.message}')
        except anthropic.APITimeoutError:
            raise Skip(f'no reply in {TIMEOUT_S}s')
        except anthropic.APIConnectionError:
            raise Stop('Network error; run the same command again, finished excerpts are kept.')
        except anthropic.APIStatusError as error:
            raise Skip(f'API error {error.status_code}')
        except TypeError as error:
            if 'authentication method' not in str(error):
                raise
            raise Stop('No API key: set ANTHROPIC_API_KEY (https://platform.claude.com/settings/keys) or run `ant auth login`.')

        tokens = (response.usage.input_tokens, response.usage.output_tokens)
        if response.stop_reason == 'refusal':
            category = response.stop_details.category if response.stop_details else None
            return Reply(None, f'refusal ({category})', *tokens, response.model)
        if response.stop_reason == 'max_tokens':
            return Reply(None, 'max_tokens', *tokens, response.model)
        text = next((block.text for block in response.content if block.type == 'text'), None)
        if not text:
            return Reply(None, f'no answer ({response.stop_reason})', *tokens, response.model)
        return Reply(text, None, *tokens, response.model)

    return ask


def ask_openai(model: str, effort: str) -> Callable[[str], Reply]:
    import openai

    if not os.environ.get('OPENAI_API_KEY'):
        raise Stop('No API key: set OPENAI_API_KEY (https://platform.openai.com/api-keys).')
    # Rate limits and server errors are retried with growing waits before giving up
    client = openai.OpenAI(timeout=TIMEOUT_S, max_retries=4)

    def ask(text: str) -> Reply:
        try:
            response = client.responses.create(
                model=model,
                instructions=SYSTEM,
                input=text,
                text={'format': {'type': 'json_schema', 'name': 'commitments', 'schema': SCHEMA, 'strict': True}},
                reasoning={'effort': effort},
                store=False,  # the conversation excerpts are not kept on OpenAI's side
            )
        except openai.AuthenticationError:
            raise Stop('No valid API key: check OPENAI_API_KEY.')
        except openai.RateLimitError as error:
            if error.type == 'insufficient_quota':
                raise Stop('The OpenAI account has no credits: add some at https://platform.openai.com/settings/organization/billing/.')
            raise Stop(f'Rate limit ({error.message}); run the same command again later, finished excerpts are kept.')
        except (openai.BadRequestError, openai.PermissionDeniedError, openai.NotFoundError) as error:
            raise Stop(f'Bad request (fix the script or the model name, nothing more will be sent): {error.status_code} {error.message}')
        except openai.APITimeoutError:
            raise Skip(f'no reply in {TIMEOUT_S}s')
        except openai.APIConnectionError:
            raise Stop('Network error; run the same command again, finished excerpts are kept.')
        except openai.APIStatusError as error:
            raise Skip(f'API error {error.status_code}')

        tokens = (response.usage.input_tokens, response.usage.output_tokens) if response.usage else (0, 0)
        refused = any(part.type == 'refusal' for item in response.output if item.type == 'message' for part in item.content)
        if refused:
            return Reply(None, 'refusal', *tokens, response.model)
        if response.status == 'incomplete':
            reason = response.incomplete_details.reason if response.incomplete_details else None
            return Reply(None, 'max_tokens' if reason == 'max_output_tokens' else f'incomplete ({reason})', *tokens, response.model)
        if not response.output_text:
            return Reply(None, f'no answer ({response.status})', *tokens, response.model)
        return Reply(response.output_text, None, *tokens, response.model)

    return ask


def owner_value(owners: list[str]):
    """The gold label's owner format: null, "all", one letter, or a list of letters."""
    if not owners:
        return None
    if 'all' in owners:
        return 'all'
    return owners[0] if len(owners) == 1 else sorted(owners)


def recognise(ask: Callable[[str], Reply], excerpt: dict) -> tuple[dict, Reply]:
    reply = ask(f"Language: {excerpt['language']}\n\n{excerpt_text(excerpt)}")
    if reply.error:
        return {'id': excerpt['id'], 'expected_action': 'none', 'items': [], 'error': reply.error}, reply
    try:
        answer = json.loads(reply.text)
    except json.JSONDecodeError:
        raise Skip('the answer was not valid JSON')
    for item in answer['items']:
        item['owner'] = owner_value(item['owner'])
    return {'id': excerpt['id'], 'expected_action': answer['expected_action'], 'items': answer['items'],
            'has_commitment': answer['expected_action'] == 'suggest', 'uncertainty': answer['uncertainty'],
            'served_by': reply.served_by}, reply


def load_env_file() -> None:
    """KEY=value lines from research/.env, for keys not already set in the shell."""
    path = ROOT / '.env'
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        key, sep, value = line.partition('=')
        if sep and not key.strip().startswith('#'):
            os.environ.setdefault(key.strip(), value.strip().strip('"\''))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # Haiku: about 40x cheaper per token than Opus, with the same decisions on the dev excerpts tried
    parser.add_argument('--model', default='claude-haiku-5-5', help=f'one of {", ".join(PRICES)} (or any other id)')
    # low saves output tokens, but Haiku then turned a "none" excerpt into "clarify"
    parser.add_argument('--effort', default='medium', choices=['low', 'medium', 'high'],
                        help='how much the model thinks first (Gemini thinking level, Claude effort, OpenAI reasoning effort)')
    parser.add_argument('--split', default='all', choices=['dev', 'eval', 'all'])
    parser.add_argument('--limit', type=int, default=None, help='send at most this many excerpts (cost cap)')
    parser.add_argument('--prefilter', action='store_true',
                        help='send only excerpts that pass the keyword pre-filter; the rest count as "none"')
    args = parser.parse_args()

    system = f'llm-{args.model}' + ('-prefiltered' if args.prefilter else '')
    out = RESULTS / f'{system}.jsonl'
    done = {row['id'] for row in load_jsonl(out)} if out.exists() else set()
    split = load_split()
    todo = [e for e in load_excerpts().values()
            if e['id'] not in done and (args.split == 'all' or split[conversation_of(e)] == args.split)]
    if args.limit is not None:
        todo = todo[:args.limit]

    load_env_file()
    try:
        provider = ask_gemini if args.model.startswith('gemini') else ask_claude if args.model.startswith('claude') else ask_openai
        ask = provider(args.model, args.effort)
    except Stop as reason:
        sys.exit(str(reason))
    tokens_in = tokens_out = sent = 0
    seconds = 0.0
    skips = 0
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('a', encoding='utf-8') as file:
        for n, excerpt in enumerate(todo, 1):
            if args.prefilter and not passes_prefilter(excerpt):
                row = {'id': excerpt['id'], 'expected_action': 'none', 'items': [], 'skipped_by_prefilter': True}
            else:
                started = time.monotonic()
                try:
                    row, reply = recognise(ask, excerpt)
                except Stop as reason:
                    sys.exit(str(reason))
                except Skip as reason:
                    print(f'[{n}/{len(todo)}] {excerpt["id"]}: {reason}, skipped (run again to retry)')
                    skips += 1
                    if skips == SKIPS_IN_A_ROW:
                        sys.exit(f'{skips} failures in a row: the model seems overloaded. Try later or another --model.')
                    continue
                skips = 0
                row['seconds'] = round(time.monotonic() - started, 1)
                seconds += row['seconds']
                sent += 1
                tokens_in += reply.tokens_in
                tokens_out += reply.tokens_out
            file.write(json.dumps(row, ensure_ascii=False) + '\n')
            file.flush()
            took = f' in {row["seconds"]}s' if 'seconds' in row else ''
            print(f'[{n}/{len(todo)}] {excerpt["id"]}: {row["expected_action"]}{took}{" (" + row["error"] + ")" if row.get("error") else ""}')

    price_in, price_out = PRICES.get(args.model, (0, 0))
    cost = tokens_in / 1e6 * price_in + tokens_out / 1e6 * price_out
    average = f', {seconds / sent:.1f}s per excerpt' if sent else ''
    print(f'\n{sent} requests{average}; {tokens_in} input + {tokens_out} output tokens, '
          f'about ${cost:.3f} on the paid tier -> {out}')


if __name__ == '__main__':
    main()
