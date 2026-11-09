"""Looks for keys, tokens and personal identifiers that should not leave this machine (see docs/SENSITIVE_DATA.md).

Matches are printed masked, never in full. Exit code 1 if anything at error level is found, so it can run
as a pre-commit hook; warnings (e-mail addresses, phone numbers, ...) only need a look.

Usage (from the repository root):
    python3 -I scripts/check_secrets.py              # the staged files, before a commit
    python3 -I scripts/check_secrets.py --all        # every tracked file
    python3 -I scripts/check_secrets.py --history    # every version of every file in the git history
"""

import base64
import json
import re
import subprocess
import sys

ERROR, WARNING = 'error', 'warning'

# (name, level, pattern). Error: a credential. Warning: personal data or a likely secret that needs a look.
CONTENT_PATTERNS = [
    # The look-behinds keep words like "task-description-…" from counting as a key
    ('Anthropic API key', ERROR, r'(?<![\w-])sk-ant-[A-Za-z0-9_-]{20,}'),
    ('OpenAI API key', ERROR, r'(?<![\w-])sk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}'),
    ('Google / Gemini API key', ERROR, r'(?<![\w-])AIza[0-9A-Za-z_-]{35}'),
    ('GitHub token', ERROR, r'(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})'),
    ('Supabase secret key', ERROR, r'sb_secret_[A-Za-z0-9_-]{20,}'),
    ('AWS access key', ERROR, r'AKIA[0-9A-Z]{16}'),
    ('Stripe live key', ERROR, r'[sr]k_live_[A-Za-z0-9]{20,}'),
    ('Slack token', ERROR, r'xox[baprs]-[A-Za-z0-9-]{10,}'),
    ('private key', ERROR, r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----'),
    ('database URL with password', ERROR, r'postgres(?:ql)?://[^:/\s<]+:[^@\s<]+@'),  # not <user>:<password>@
    ('JWT', None, r'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),  # level from its role
    ('secret assigned in code', WARNING,
     r'(?i)\b(?:password|passwd|jelszo|secret|api_?key|access_?token|auth_?token|jwt_secret|client_secret)\b'
     r'\s*[:=]\s*["\'][^"\'\s]{8,}["\']'),
    ('Neptun code', WARNING, r'(?i:neptun)[\w-]*\W{1,20}[A-Z0-9]{6}\b'),
    ('Hungarian phone number', WARNING, r'(?<![\w.])(?:\+36|06)[ /-]?(?:1|[2-9]\d)[ /-]?\d{3}[ -]?\d{3,4}\b'),
    ('e-mail address', WARNING, r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
]
COMPILED = [(name, level, re.compile(pattern)) for name, level, pattern in CONTENT_PATTERNS]

# Files that hold credentials by their nature, whatever is in them
FILE_PATTERNS = [
    ('environment file', re.compile(r'(?:^|/)\.env(?:\.(?!example$|sample$|template$)[^/]+)?$')),
    ('key or certificate file', re.compile(r'\.(?:pem|key|p12|pfx|jks|keystore)$|(?:^|/)id_(?:rsa|ed25519|ecdsa)$')),
    ('cloud credentials file', re.compile(r'(?:^|/)(?:service[-_]?account|credentials?)[^/]*\.json$')),
]

# Addresses that are public on purpose
SAFE_EMAILS = re.compile(r'(?i)noreply@|no-reply@|@example\.(?:com|org)|@users\.noreply\.github\.com|@anthropic\.com$')
SKIPPED_PATHS = re.compile(r'(?:^|/)(?:node_modules|\.venv|dist|\.angular)/|package-lock\.json$')


def jwt_role(token: str) -> str | None:
    """Supabase keys are JWTs: 'anon' may be in the client (with RLS), 'service_role' never."""
    try:
        payload = token.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('role')
    except (ValueError, IndexError, AttributeError):
        return None


def mask(text: str) -> str:
    return text[:6] + '…' + f'({len(text)} chars)' if len(text) > 10 else '…'


def scan_text(path: str, text: str) -> list[tuple[str, str, int, str]]:
    findings = []
    for number, line in enumerate(text.splitlines(), 1):
        for name, level, pattern in COMPILED:
            for match in pattern.finditer(line):
                found = match.group(0)
                if name == 'e-mail address' and SAFE_EMAILS.search(found):
                    continue
                if name == 'JWT':
                    role = jwt_role(found)
                    level = ERROR if role in (None, 'service_role', 'supabase_admin') else WARNING
                    name = f'JWT (role: {role})' if role else 'JWT'
                findings.append((level, name, number, mask(found)))
    return findings


def scan_path_name(path: str) -> list[tuple[str, str, int, str]]:
    return [(ERROR, name, 0, '') for name, pattern in FILE_PATTERNS if pattern.search(path)]


def git(*args: str) -> str:
    return subprocess.run(['git', *args], capture_output=True, text=True, check=True, errors='replace').stdout


def staged_or_tracked(all_files: bool) -> dict[str, list]:
    paths = git('ls-files') if all_files else git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
    results = {}
    for path in filter(None, paths.splitlines()):
        if SKIPPED_PATHS.search(path):
            continue
        content = subprocess.run(['git', 'show', f':{path}'], capture_output=True).stdout  # the staged version
        findings = scan_path_name(path)
        if b'\0' not in content[:8000]:  # not a binary file
            findings += scan_text(path, content.decode('utf-8', errors='replace'))
        if findings:
            results[path] = findings
    return results


def history() -> dict[str, list]:
    """Every line ever added, per file and the commit that added it."""
    results, commit, path, number = {}, '', '', 0
    log = git('log', '--all', '-p', '--no-color', '--no-ext-diff', '-U0', '--format=commit %h %ad', '--date=short')
    for line in log.splitlines():
        if line.startswith('commit '):
            commit = line[7:]
        elif line.startswith('+++ '):
            path = line[6:] if line.startswith('+++ b/') else ''
            if path and not SKIPPED_PATHS.search(path):
                for finding in scan_path_name(path):
                    results.setdefault(f'{path} @ {commit}', []).append(finding)
        elif line.startswith('@@'):
            hunk = re.search(r'\+(\d+)', line)
            number = int(hunk.group(1)) if hunk else 0
        elif line.startswith('+') and path and not SKIPPED_PATHS.search(path):
            for level, name, _, masked in scan_text(path, line[1:]):
                results.setdefault(f'{path} @ {commit}', []).append((level, name, number, masked))
            number += 1
    return results


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    results = history() if mode == '--history' else staged_or_tracked(mode == '--all')
    errors = 0
    for where, findings in sorted(results.items()):
        print(where)
        for level, name, number, masked in findings:
            errors += level == ERROR
            line = f' line {number}' if number else ''
            print(f'  {level.upper():8}{name}{line} {masked}'.rstrip())
    scope = {'--history': 'the git history', '--all': 'the tracked files'}.get(mode, 'the staged files')
    print(f'\n{errors} error(s) in {scope}.' if results else f'Nothing found in {scope}.')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
