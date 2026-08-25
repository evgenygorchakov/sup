#!/usr/bin/env python3
"""A fake interactive CLI with scripted, predictable output.

test/selftest.json and test/selftest-negative.json drive this instead of `sup`, so the
assertion engine in drive.py can be checked in a second without touching Ollama.
"""
import json
import sys
from pathlib import Path


def emit(text):
    sys.stdout.write(text)
    sys.stdout.flush()


def write_journal():
    run = Path('.sup/runs/20260101-000000')
    run.mkdir(parents=True, exist_ok=True)
    with (run / 'journal.jsonl').open('a', encoding='utf8') as handle:
        for event in ({'type': 'run_start', 'cwd': str(Path.cwd())},
                      {'type': 'user', 'message': {'role': 'user', 'content': 'hi'}}):
            handle.write(json.dumps({'ts': '2026-01-01T00:00:00.000Z', **event}) + '\n')


emit('echo-bot ready\n')
while True:
    emit('\n> ')
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()

    if line == '/exit':
        emit('bye\n')
        break
    if line == 'journal':
        write_journal()
        emit('journal written\n')
    elif line == 'tool':
        emit('● edit_file(path: "calc.js")\n')
    elif line.startswith('write '):
        _, path, text = line.split(' ', 2)
        Path(path).write_text(text + '\n', encoding='utf8')
        emit(f'wrote {path}\n')
    else:
        emit(f'you said: {line}\n')
