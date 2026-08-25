#!/usr/bin/env python3
"""Drive the interactive `sup` CLI through a pty and check a scenario against a live model.

    python3 test/lib/drive.py test/live/plan/07-sticky.json   # one scenario
    python3 test/run.py                                       # the whole suite

The scenario format is documented in test/README.md. Everything here talks to the real
binary and the real Ollama host from .env — there are no stubs, so a scenario asserts what
the harness does (tool headers, notices, files, journal), never how the model words things.
"""
import fcntl
import json
import os
import pty
import re
import select
import shutil
import signal
import struct
import sys
import termios
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TEST_ROOT = REPO / 'test'
LIVE_ROOT = TEST_ROOT / 'live'

ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][B0]|\x1b[=>]|[\x00-\x08\x0b\x0c\x0e-\x1f]')
SPINNER_LINE = re.compile(r'^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] [A-Za-z]+…(?: \d+s)?$')
CONFIRM_PROMPT = re.compile(r'\[y / n / type feedback\]')
MODEL_BANNER = re.compile(r'^Provider: .+ · Model: (.+)$', re.M)


def clean(text):
    return ANSI.sub('', text).replace('\r\n', '\n').replace('\r', '\n')


def readable(text):
    """Drop spinner frames so a log can be read without a sed incantation."""
    return '\n'.join(line for line in text.split('\n') if not SPINNER_LINE.match(line.strip()))


def repo_path(value):
    path = Path(value)
    return path if path.is_absolute() else REPO / path


def slug_for(path):
    """A scenario is named by where it lives: test/live/plan/07-sticky.json -> plan/07-sticky."""
    path = Path(path).resolve()
    try:
        return str(path.relative_to(LIVE_ROOT).with_suffix(''))
    except ValueError:
        return path.stem


def prepare_sandbox(spec, name):
    """Refill the sandbox from its fixture so every run starts from the same state.

    A scenario with no `fixture` inherits whatever the previous one left behind — that is how
    s3b-resume gets the journal that s3-reject wrote.
    """
    cwd = repo_path(spec.get('cwd', 'test/sandbox'))
    fixture = spec.get('fixture')
    if fixture is None:
        cwd.mkdir(parents=True, exist_ok=True)
        return cwd, None

    source = repo_path('test/fixtures') / fixture
    if not source.is_dir():
        raise SystemExit(f'{name}: no fixture directory at {source}')
    if TEST_ROOT not in cwd.parents:
        raise SystemExit(f'{name}: refusing to wipe {cwd} — the sandbox must live under test/')
    if cwd.exists():
        shutil.rmtree(cwd)
    shutil.copytree(source, cwd)
    return cwd, source


def spawn(spec, cwd):
    env = dict(os.environ)
    env.update({key: str(value) for key, value in spec.get('env', {}).items()})
    env.update({'TERM': 'xterm-256color', 'COLUMNS': '100', 'LINES': '40'})

    # The child runs inside the sandbox, so repo-relative tokens (test/fixtures/echo-bot.py)
    # have to be made absolute before the chdir.
    cmd = [str(REPO / token) if (REPO / token).is_file() else token
           for token in spec.get('cmd', ['sup'])] + spec.get('args', [])
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe(cmd[0], cmd, env)
        os._exit(1)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 100, 0, 0))
    return pid, fd


class Session:
    """The pty side: reads output, feeds keystrokes, remembers everything seen."""

    def __init__(self, pid, fd, echo=True):
        self.pid, self.fd, self.echo = pid, fd, echo
        self.buf = ''
        self.alive = True

    def pump(self, deadline):
        while time.time() < deadline:
            ready, _, _ = select.select([self.fd], [], [], 0.3)
            if not ready:
                continue
            try:
                chunk = os.read(self.fd, 65536)
            except OSError:
                self.alive = False
                return
            if not chunk:
                self.alive = False
                return
            piece = clean(chunk.decode('utf8', errors='replace'))
            self.buf += piece
            if self.echo:
                sys.stdout.write(piece)
                sys.stdout.flush()
            return

    def note(self, text):
        if self.echo:
            print(f'\n### {text}\n', file=sys.stderr)

    def send(self, text, enter=True):
        payload = text.encode('utf8').decode('unicode_escape').encode('utf8') if '\\x' in text or '\\u' in text else text.encode('utf8')
        os.write(self.fd, payload + (b'\r' if enter else b''))

    def close(self, drain):
        end = time.time() + drain
        while time.time() < end and self.alive:
            self.pump(end)
        try:
            os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(self.pid, 0)


def verdict_of(result):
    """PASS, FAIL, XFAIL (a known bug still failing, as intended) or XPASS (it started passing --
    the bug is fixed and the `xfail` key has to go). run.py only adds the colour."""
    if result['ok']:
        return 'XFAIL' if result['xfail'] else 'PASS'
    if result['xfail'] and result['passed']:
        return 'XPASS'
    return 'FAIL'


def model_used(output):
    """Which model actually answered, taken from sup's own banner rather than from MODEL -- that
    env var is empty when sup auto-picks, and unset when a scenario drives echo-bot instead."""
    found = MODEL_BANNER.search(output)
    return found.group(1).strip() if found else 'no model banner'


def write_log(path, output, result):
    """A log outlives the run that wrote it, and a run of some other scenario leaves it untouched.
    So it says up front when it ran, on what model and how it ended -- without that a stale log
    from another model reads like a fresh failure."""
    stamp = time.strftime('%Y-%m-%d %H:%M')
    head = f"# {result['name']} · {stamp} · {model_used(output)} · {verdict_of(result)} · {result['seconds']}s"
    lines = [head] + [f'#   · {failure}' for failure in result['failures']]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines) + '\n\n' + readable(output), encoding='utf8')


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def run_steps(spec, session, failures, step_results):
    consumed = 0
    for index, step in enumerate(spec['steps']):
        note = step.get('note', '')
        pattern = step.get('expect')
        window_start = consumed
        matched = True

        if pattern:
            regex = re.compile(pattern, re.M)
            deadline = time.time() + step.get('timeout', 300)
            auto_yes, auto_from = step.get('auto_yes', False), consumed
            matched = False
            while time.time() < deadline:
                found = regex.search(session.buf, consumed)
                if found:
                    consumed = found.end()
                    matched = True
                    break
                if auto_yes:
                    confirm = CONFIRM_PROMPT.search(session.buf, auto_from)
                    if confirm:
                        auto_from = confirm.end()
                        time.sleep(0.4)
                        session.send('y')
                        session.note('auto-approved a tool call')
                        continue
                if not session.alive:
                    break
                session.pump(min(deadline, time.time() + 5))

            if not matched:
                reason = 'process exited' if not session.alive else 'timeout'
                failures.append(f'step {index} ({note}): no match for {pattern!r} — {reason}')
                step_results.append({'step': index, 'note': note, 'ok': False, 'reason': reason})
                session.note(f'STEP {index} FAILED ({note}): no match for {pattern!r}')
                return
            # Everything printed between the previous match and this one is this step's window.
            window = session.buf[window_start:found.start()]
            for forbidden in as_list(step.get('absent')):
                if re.search(forbidden, window, re.M):
                    failures.append(f'step {index} ({note}): {forbidden!r} appeared before {pattern!r}')

        step_results.append({'step': index, 'note': note, 'ok': True})
        session.note(f'STEP {index} matched ({note})')

        send = step.get('send')
        if send is not None:
            time.sleep(step.get('delay', 0.5))
            session.send(send, step.get('enter', True))


def check_files(spec, cwd, fixture, failures):
    for relative, rules in spec.get('files', {}).items():
        target = cwd / relative

        if rules.get('exists') is False:
            if target.exists():
                failures.append(f'file {relative}: expected it to be gone, but it is there')
            continue

        if not target.exists():
            failures.append(f'file {relative}: missing')
            continue

        text = target.read_text(encoding='utf8', errors='replace')

        if rules.get('unchanged'):
            if fixture is None:
                failures.append(f'file {relative}: "unchanged" needs a fixture to compare against')
            elif text != (fixture / relative).read_text(encoding='utf8', errors='replace'):
                failures.append(f'file {relative}: changed, expected it untouched')

        if 'equals' in rules and text != rules['equals']:
            failures.append(f'file {relative}: content differs from the expected literal')

        for needle in as_list(rules.get('contains')):
            if not re.search(needle, text, re.M):
                failures.append(f'file {relative}: expected {needle!r} in it')

        for needle in as_list(rules.get('absent')):
            if re.search(needle, text, re.M):
                failures.append(f'file {relative}: {needle!r} should not be in it')


def check_journal(spec, cwd, failures):
    rules = spec.get('journal')
    if rules is None:
        return

    runs_dir = cwd / '.sup' / 'runs'
    journals = sorted(runs_dir.glob('*/journal.jsonl')) if runs_dir.is_dir() else []

    if 'runs' in rules and len(journals) != rules['runs']:
        failures.append(f'journal: expected {rules["runs"]} run(s), found {len(journals)}')

    if not journals:
        if len(rules) > ('runs' in rules):
            failures.append('journal: no run journal was written')
        return

    raw = journals[-1].read_text(encoding='utf8', errors='replace')
    types = [json.loads(line)['type'] for line in raw.splitlines() if line.strip()]

    if 'types' in rules and types != rules['types']:
        failures.append(f'journal: events are {types}, expected {rules["types"]}')

    for expected in as_list(rules.get('types_present')):
        if expected not in types:
            failures.append(f'journal: no {expected!r} event (got {types})')

    for forbidden in as_list(rules.get('types_absent')):
        if forbidden in types:
            failures.append(f'journal: {forbidden!r} event should not be there (got {types})')

    for needle in as_list(rules.get('contains')):
        if not re.search(needle, raw, re.M):
            failures.append(f'journal: expected {needle!r} in it')

    for needle in as_list(rules.get('absent')):
        if re.search(needle, raw, re.M):
            failures.append(f'journal: {needle!r} should not be in it')


def run_scenario(path, echo=True):
    started = time.time()
    spec = json.loads(Path(path).read_text(encoding='utf8'))
    name = slug_for(path)
    cwd, fixture = prepare_sandbox(spec, name)

    failures, step_results = [], []
    pid, fd = spawn(spec, cwd)
    session = Session(pid, fd, echo=echo)
    try:
        run_steps(spec, session, failures, step_results)
    finally:
        session.close(spec.get('drain', 10))

    for forbidden in as_list(spec.get('forbid')):
        if re.search(forbidden, session.buf, re.M):
            failures.append(f'output: {forbidden!r} should not appear anywhere')

    check_files(spec, cwd, fixture, failures)
    check_journal(spec, cwd, failures)

    # `expect_failures` is how the harness checks itself: the named checks must be the ones
    # that fired, so a scenario cannot pass by failing for some unrelated reason.
    unmet = [needle for needle in as_list(spec.get('expect_failures'))
             if not any(needle in failure for failure in failures)]
    for needle in unmet:
        failures.append(f'self-check: expected a failure mentioning {needle!r}, none did')

    xfail = spec.get('xfail')
    passed = not failures
    if unmet:
        ok = False
    elif xfail:
        # An xfail scenario is "ok" while it still fails; when it starts passing, say so loudly.
        ok = not passed
    else:
        ok = passed

    log_path = repo_path(spec.get('log', f'test/logs/{name}.log'))
    result = {
        'name': name,
        'description': spec.get('description', ''),
        'passed': passed,
        'xfail': xfail,
        'ok': ok,
        'seconds': round(time.time() - started),
        'failures': failures,
        'steps': step_results,
        'log': str(log_path.relative_to(REPO)),
    }
    write_log(log_path, session.buf, result)
    return result


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: drive.py <scenario.json>')
    result = run_scenario(sys.argv[1])
    print('\n\n=== RESULT ===', file=sys.stderr)
    print(json.dumps(result, indent=2, ensure_ascii=False), file=sys.stderr)
    sys.exit(0 if result['ok'] else 1)


if __name__ == '__main__':
    main()
