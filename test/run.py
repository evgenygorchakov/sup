#!/usr/bin/env python3
"""Run the live scenario suite against the real `sup` binary and the Ollama host from .env.

    python3 test/run.py                  # everything under test/live, in path order
    python3 test/run.py plan             # only scenarios whose slug contains one of these
    python3 test/run.py sticky 08        # several filters
    python3 test/run.py --list           # what is there
    python3 test/run.py --quiet          # summary only, no pty output

A scenario is named by its path under test/live: test/live/plan/07-sticky.json is `plan/07-sticky`.
They run one after another because they share test/sandbox, and _selftest goes first because '_'
sorts ahead of the feature directories. Planning on a 27B model takes minutes, so the full suite is
a coffee break, not a pre-commit hook. Node-level checks are a separate runner: node test/run.ts.
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from drive import LIVE_ROOT, REPO, run_scenario, slug_for, verdict_of  # noqa: E402

SCENARIOS = sorted(LIVE_ROOT.rglob('*.json'))

GREEN, RED, YELLOW, GRAY, RESET = '\033[32m', '\033[31m', '\033[33m', '\033[90m', '\033[0m'


def model_in_use():
    """What the scenarios will actually load: MODEL from the environment wins over .env, and an
    empty value means sup auto-picks the most recently pulled model. Worth printing — a suite run
    is only comparable to another one on the same model."""
    if os.environ.get('MODEL'):
        return os.environ['MODEL']
    dotenv = REPO / '.env'
    if dotenv.is_file():
        found = re.search(r'^\s*(?:export\s+)?MODEL\s*=\s*"?([^"\n#]*)', dotenv.read_text(encoding='utf8'), re.M)
        if found and found.group(1).strip():
            return f'{found.group(1).strip()}  (from .env)'
    return 'auto-picked by sup'


VERDICT_COLORS = {'PASS': GREEN, 'XFAIL': YELLOW, 'FAIL': RED, 'XPASS': RED}


def verdict(result):
    mark = verdict_of(result)
    return f'{VERDICT_COLORS[mark]}{mark}{RESET}'


def main():
    args = [arg for arg in sys.argv[1:] if not arg.startswith('--')]
    flags = {arg for arg in sys.argv[1:] if arg.startswith('--')}

    chosen = [path for path in SCENARIOS if not args or any(arg in slug_for(path) for arg in args)]

    if '--list' in flags:
        for path in SCENARIOS:
            spec = json.loads(path.read_text(encoding='utf8'))
            mark = f' {YELLOW}[xfail: {spec["xfail"]}]{RESET}' if spec.get('xfail') else ''
            print(f'  {slug_for(path):24} {spec.get("description", "")}{mark}')
        return 0

    if not chosen:
        print(f'No scenario matches {args}. Try --list.')
        return 1

    print(f'{GRAY}model: {model_in_use()}{RESET}')

    results = []
    for path in chosen:
        print(f'\n{GRAY}{"─" * 78}{RESET}\n▶  {slug_for(path)}\n')
        result = run_scenario(path, echo='--quiet' not in flags)
        results.append(result)
        print(f'\n{verdict(result)}  {result["name"]} ({result["seconds"]}s)', file=sys.stderr)
        for failure in result['failures']:
            print(f'    {failure}', file=sys.stderr)

    print(f'\n{GRAY}{"─" * 78}{RESET}\n=== SUMMARY ===')
    for result in results:
        reason = f'  {GRAY}({result["xfail"]}){RESET}' if result['xfail'] else ''
        print(f'  {verdict(result):>18}  {result["name"]:24} {result["seconds"]:>4}s  {GRAY}{result["log"]}{RESET}{reason}')
        if not result['ok']:
            for failure in result['failures']:
                print(f'      {RED}·{RESET} {failure}')

    broken = [result for result in results if not result['ok']]
    print(f'\n{len(results) - len(broken)}/{len(results)} ok')
    return 1 if broken else 0


if __name__ == '__main__':
    sys.exit(main())
