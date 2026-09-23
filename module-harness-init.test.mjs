#!/usr/bin/env node
// module-harness-init.test.mjs — 설치 도구의 회귀 테스트
// 사용: npm test
//
// 게이트 테스트와 같은 방식이다 — 임시 git 저장소에 fixture 를 세운다.
// 이 리포의 계약서를 입력으로 쓰지 않는다. 스키마는 읽는다: 어댑터 문구의 출처가 거기 하나이고,
// 그 사실 자체가 이 도구의 약속이라 픽스처로 대신할 수 없다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INIT = join(HERE, 'module-harness-init.mjs');
const SCHEMA = join(HERE, 'MODULE-schema-v1.md');

// 사용자의 전역 core.hooksPath 가 새어 들어오면 mayConfig() 가 이 머신에서만 다른 답을 낸다 —
// almandu-harness-install.test.mjs 가 이미 같은 이유로 격리한다 (D7)
function isolatedEnv(dir, globalHooksPath) {
  const gitconfig = join(dir, 'gitconfig');
  writeFileSync(gitconfig, globalHooksPath ? `[core]\n\thooksPath = ${globalHooksPath}\n` : '');
  return { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
}

function newRepo(t, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = isolatedEnv(dir, opts.globalHooksPath);
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore', env });
  git('init -q --template=');
  git('config user.email init@test');
  git('config user.name init');
  return { dir, env, git, write: (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); } };
}

function init(dir, ...args) {
  const env = args.length && typeof args[args.length - 1] === 'object' ? args.pop() : isolatedEnv(dir);
  const r = spawnSync('node', [INIT, ...args], { cwd: dir, encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const adapterFromSchema = () =>
  readFileSync(SCHEMA, 'utf8').split('### CLAUDE.md 어댑터')[1].match(/```markdown\n([\s\S]*?)```/)[1];

test('빈 리포에 훅·루트 문단·어댑터 셋을 놓는다', (t) => {
  const r = newRepo(t);
  r.write('alpha/MODULE.md', '---\nmodule: alpha\n---\n');
  const got = init(r.dir);
  assert.equal(got.code, 0, got.out);
  assert.match(read(r.dir, '.githooks/pre-commit'), /^exec node "\$\(git rev-parse --show-toplevel\)\/node_modules\/almandu-harness\/module-gate\.mjs" --staged$/m);
  assert.match(read(r.dir, 'CLAUDE.md'), /가장 깊은 MODULE\.md/);
  assert.equal(read(r.dir, 'alpha/CLAUDE.md'), adapterFromSchema());
  assert.equal(execSync('git config --local --get core.hooksPath', { cwd: r.dir, encoding: 'utf8' }).trim(), '.githooks');
});

test('어댑터 문구의 출처는 스키마 하나다 — init 안에 사본을 두지 않는다', (t) => {
  const r = newRepo(t);
  r.write('alpha/MODULE.md', '---\nmodule: alpha\n---\n');
  init(r.dir);
  const written = read(r.dir, 'alpha/CLAUDE.md');
  assert.equal(written, adapterFromSchema());
  assert.match(written, /^@MODULE\.md\n/);
});

test('--dry-run 은 아무것도 쓰지 않는다', (t) => {
  const r = newRepo(t);
  r.write('alpha/MODULE.md', '---\nmodule: alpha\n---\n');
  const got = init(r.dir, '--dry-run');
  assert.equal(got.code, 0, got.out);
  assert.match(got.out, /아무것도 쓰지 않았다/);
  assert.equal(existsSync(join(r.dir, '.githooks/pre-commit')), false);
  assert.equal(existsSync(join(r.dir, 'alpha/CLAUDE.md')), false);
});

test('이미 있는 CLAUDE.md 는 지우지 않고 어댑터를 앞에 얹는다', (t) => {
  const r = newRepo(t);
  r.write('alpha/MODULE.md', '---\nmodule: alpha\n---\n');
  r.write('alpha/CLAUDE.md', '프로젝트 고유 규칙이 여기 있다.\n');
  init(r.dir);
  const text = read(r.dir, 'alpha/CLAUDE.md');
  assert.match(text, /^@MODULE\.md/);
  assert.match(text, /프로젝트 고유 규칙이 여기 있다\./);
});

test('두 번 돌려도 같은 상태다 — 이미 있는 것은 건드리지 않는다', (t) => {
  const r = newRepo(t);
  r.write('alpha/MODULE.md', '---\nmodule: alpha\n---\n');
  init(r.dir);
  const before = read(r.dir, 'CLAUDE.md') + read(r.dir, 'alpha/CLAUDE.md');
  const got = init(r.dir);
  assert.equal(got.code, 0, got.out);
  assert.match(got.out, /바꿀 것이 없다/);
  assert.equal(read(r.dir, 'CLAUDE.md') + read(r.dir, 'alpha/CLAUDE.md'), before);
});

test('--no-config 는 core.hooksPath 를 건드리지 않는다', (t) => {
  const r = newRepo(t);
  init(r.dir, '--no-config');
  assert.ok(existsSync(join(r.dir, '.githooks/pre-commit')));
  const got = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: r.dir, encoding: 'utf8' });
  assert.notEqual(got.status, 0);
});

test('--hooks-path 에 값이 없으면 거부한다', (t) => {
  const r = newRepo(t);
  const got = init(r.dir, '--hooks-path', '--dry-run');
  assert.equal(got.code, 2);
  assert.match(got.out, /디렉토리가 필요하다/);
});

test('훅이 부르는 파일은 패키지에 실리고 bin 과 같다 — 경로 형태가 사라지면 match 가 던진다', (t) => {
  const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
  const r = newRepo(t);
  init(r.dir);
  const rel = read(r.dir, '.githooks/pre-commit').match(/almandu-harness\/(\S+)" --staged/)[1];
  assert.ok(pkg.files.includes(rel), `훅이 부르는 ${rel} 이 files 에 없다 — 설치된 리포에 그 파일이 없다`);
  assert.equal(pkg.bin['almandu-module-gate'], rel, '훅이 부르는 파일과 bin 이 가리키는 파일이 다르다');
  for (const [old, now] of [['module-gate', 'almandu-module-gate'], ['module-harness-init', 'almandu-harness-init'], ['module-loop', 'almandu-module-loop']])
    assert.equal(pkg.bin[old], pkg.bin[now], `별칭 ${old} 이 ${now} 와 다른 파일을 가리킨다`);
});

// ---------- 4단계(커맨드 배치)의 회귀 테스트 — init-9~init-14 ----------
// 기존 여덟은 위에 그대로 있다. I6 이 :60 을 인용하므로 이 파일은 끝에만 는다.
const COMMANDS = join(HERE, 'commands');
const commandNames = () => readdirSync(COMMANDS).filter((n) => n.endsWith('.md')).sort();

test('커맨드 셋을 .claude/commands 에 놓고, 놓인 것은 원본과 바이트 단위로 같다', (t) => {
  const r = newRepo(t);
  const got = init(r.dir);
  assert.equal(got.code, 0, got.out);
  const names = commandNames();
  assert.ok(names.length >= 3, `commands/ 에 .md 가 ${names.length} 개다`);
  for (const name of names)
    assert.equal(read(r.dir, `.claude/commands/${name}`), readFileSync(join(COMMANDS, name), 'utf8'),
      `${name} 이 원본과 다르다 — 복사가 아니라 생성이면 I7 이 깨진다`);
});

test('이미 있는 커맨드는 덮어쓰지 않는다', (t) => {
  const r = newRepo(t);
  init(r.dir);
  r.write('.claude/commands/module-work.md', '이 리포가 고친 판이다.\n');
  const got = init(r.dir);
  assert.equal(got.code, 0, got.out);
  assert.equal(read(r.dir, '.claude/commands/module-work.md'), '이 리포가 고친 판이다.\n');
  // 파일 이름을 반드시 넣는다 — `이미 있다` 만 보면 CLAUDE.md 의 같은 문구에 걸려 실패할 수가 없다
  assert.match(got.out, /\.claude\/commands\/module-work\.md — 이미 있다/);
  for (const name of commandNames().filter((n) => n !== 'module-work.md'))
    assert.equal(read(r.dir, `.claude/commands/${name}`), readFileSync(join(COMMANDS, name), 'utf8'));
});

test('--no-commands 와 --dry-run 은 .claude 를 만들지 않는다', (t) => {
  const a = newRepo(t);
  const gotA = init(a.dir, '--no-commands');
  assert.equal(gotA.code, 0, gotA.out);
  assert.equal(existsSync(join(a.dir, '.claude')), false);
  assert.equal(gotA.out.includes('.claude/commands'), false);

  const b = newRepo(t);
  const gotB = init(b.dir, '--dry-run');
  assert.equal(gotB.code, 0, gotB.out);
  assert.equal(existsSync(join(b.dir, '.claude')), false);
  // DRY + 전체를 세지 않는다 — 훅·루트 CLAUDE.md 도 같은 접두사를 낸다
  const planned = gotB.out.split('\n').filter((l) => l.startsWith('DRY + .claude/commands/'));
  assert.equal(planned.length, commandNames().length, gotB.out);
});

test('commands/ 가 없는 배치에서도 죽지 않는다 (0.8.0 미만 태그)', (t) => {
  const pkgDir = mkdtempSync(join(tmpdir(), 'harness-nocmd-'));
  t.after(() => rmSync(pkgDir, { recursive: true, force: true }));
  writeFileSync(join(pkgDir, 'module-harness-init.mjs'), readFileSync(INIT, 'utf8'));
  writeFileSync(join(pkgDir, 'MODULE-schema-v1.md'), readFileSync(SCHEMA, 'utf8'));

  const r = newRepo(t);
  const got = spawnSync('node', [join(pkgDir, 'module-harness-init.mjs')], { cwd: r.dir, encoding: 'utf8' });
  const out = `${got.stdout ?? ''}${got.stderr ?? ''}`;
  assert.equal(got.status, 0, out);
  assert.match(out, /commands\/ 가 없다/);
  assert.equal(existsSync(join(r.dir, '.claude')), false);
});

test('실리는 커맨드에 리포 고유 경로가 없다', () => {
  // 하네스를 갓 설치한 임의의 리포에서 거짓이거나 해소되지 않는 경로들이다
  const forbidden = [/node loop\/loop\.mjs/, /\.\.\/module-harness\//, /tools\/git-hooks/, /restored-project\//];
  for (const name of commandNames()) {
    const text = readFileSync(join(COMMANDS, name), 'utf8');
    for (const re of forbidden) assert.equal(re.test(text), false, `${name} 에 ${re} 가 남아 있다`);
    for (const line of text.split('\n'))
      if (line.includes('review/personas/'))
        assert.match(line, /node_modules\/almandu-harness\/review\/personas\//,
          `${name}: 접두사 없는 review/personas/ — ${line}`);
  }
});

test('실리는 module-review 와 이 리포의 사본은 경로 둘 말고는 같다', () => {
  // 치환 목록은 여기 상수로 둔다. 셋째가 생기면 DESIGN "템플릿의 경계" 표와 한 커밋에서 같이 는다
  const SUBS = [
    ['node "$(git rev-parse --show-toplevel)/node_modules/almandu-harness/loop/loop.mjs"', 'node loop/loop.mjs'],
    ['node_modules/almandu-harness/review/personas/', 'review/personas/'],
  ];
  let back = readFileSync(join(COMMANDS, 'module-review.md'), 'utf8');
  for (const [shipped, local] of SUBS) back = back.split(shipped).join(local);
  assert.equal(back, readFileSync(join(HERE, '.claude/commands/module-review.md'), 'utf8'),
    'commands/module-review.md 와 .claude/commands/module-review.md 가 갈라졌다 — 어느 쪽이 앞선 판인지는 고친 사람이 안다');
});

test('소비 리포에 닿는 문서는 npx 로 부르라고 시키지 않는다', () => {
  // 부르는 형태의 출처는 README 설치 절의 경로 형태 표 하나다 — I6·I7 과 같은 부류의 약속인데,
  // 그 표가 npx 를 "쓰지 않는다" 로 정한 뒤에도 문서 스물한 곳이 시키고 있던 것이 2026-09-22 다.
  // 처방이 아닌 자리는 밖이다 — 이력·설계, 그리고 bin 을 세기만 하는 MODULE.md 진입점 칸이 그렇다
  const bins = Object.keys(JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).bin);
  const watched = ['README.md', 'GUIDE.md', 'MODULE-schema-v1.md',
    ...commandNames().map((n) => `commands/${n}`)];
  for (const rel of watched) {
    readFileSync(join(HERE, rel), 'utf8').split('\n').forEach((line, i) => {
      if (!line.includes('npx')) return;
      const hit = bins.find((b) => line.includes(b));
      assert.equal(hit, undefined,
        `${rel}:${i + 1} 이 npx 로 ${hit} 를 부르라고 시킨다 — README 경로 형태 표를 따른다`);
    });
  }
});

// ---------- 5절(훅 배선)의 회귀 테스트 — design.md 6-B 7단계 ----------
test('① 전역 훅이 체인하면 git-common-dir/hooks/pre-commit 을 만들고 설정은 켜지 않는다', (t) => {
  const box = mkdtempSync(join(tmpdir(), 'harness-wire-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const ghooks = join(box, 'ghooks');
  mkdirSync(ghooks, { recursive: true });
  writeFileSync(join(ghooks, 'pre-commit'),
    '#!/bin/sh\nif [ -x "$PWD/.git/hooks/pre-commit" ]; then "$PWD/.git/hooks/pre-commit" || exit $?; fi\n');
  chmodSync(join(ghooks, 'pre-commit'), 0o755);
  const r = newRepo(t, { globalHooksPath: ghooks });

  const got = init(r.dir, r.env);
  assert.equal(got.code, 0, got.out);
  assert.match(read(r.dir, '.git/hooks/pre-commit'), /module-gate/);
  const local = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: r.dir, env: r.env });
  assert.notEqual(local.status, 0, '설정을 켜면 안 된다 — 전역 훅이 체인하는 자리에 이미 얹었다');
});

test('② 남의 .git/hooks/pre-commit — shebang 뒤에 얹고, 두 번 돌려도 한 블록이며, 원래 줄이 남는다', (t) => {
  const r = newRepo(t);
  mkdirSync(join(r.dir, '.git/hooks'), { recursive: true });
  const foreign = '#!/bin/sh\necho foreign-hook\nexit 0\n';
  writeFileSync(join(r.dir, '.git/hooks/pre-commit'), foreign);
  chmodSync(join(r.dir, '.git/hooks/pre-commit'), 0o755);

  const got = init(r.dir, r.env);
  assert.equal(got.code, 0, got.out);
  const text = read(r.dir, '.git/hooks/pre-commit');
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.match(text, /module-gate/);
  assert.match(text, /echo foreign-hook/);
  assert.match(text, /exit 0/);

  const before = text;
  const got2 = init(r.dir, r.env);
  assert.equal(got2.code, 0, got2.out);
  assert.equal(read(r.dir, '.git/hooks/pre-commit'), before, '두 번째 실행에서 블록이 또 붙으면 안 된다');
  assert.equal((before.match(/module-gate/g) || []).length, (read(r.dir, '.git/hooks/pre-commit').match(/module-gate/g) || []).length);
});

test('③ 안 쓰는 경우 — 추적된 남의 훅, 체인하지 않는 전역 훅, local-outside 는 아무것도 쓰지 않는다', (t) => {
  // (a) 추적되는 로컬 hooksPath
  const a = newRepo(t);
  a.write('tools/git-hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  chmodSync(join(a.dir, 'tools/git-hooks/pre-commit'), 0o755);
  execSync('git add -A', { cwd: a.dir, env: a.env });
  execSync('git commit -q -m seed', { cwd: a.dir, env: a.env });
  execSync('git config core.hooksPath tools/git-hooks', { cwd: a.dir, env: a.env });
  const beforeA = read(a.dir, 'tools/git-hooks/pre-commit');
  const gotA = init(a.dir, a.env);
  assert.equal(gotA.code, 0, gotA.out);
  assert.equal(read(a.dir, 'tools/git-hooks/pre-commit'), beforeA);

  // (b) 전역 훅은 있지만 리포 안을 체인하지 않는다
  const box = mkdtempSync(join(tmpdir(), 'harness-wire3b-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const ghooks = join(box, 'ghooks');
  mkdirSync(ghooks, { recursive: true });
  writeFileSync(join(ghooks, 'pre-commit'), '#!/bin/sh\necho no-chain\n');
  chmodSync(join(ghooks, 'pre-commit'), 0o755);
  const b = newRepo(t, { globalHooksPath: ghooks });
  const gotB = init(b.dir, b.env);
  assert.equal(gotB.code, 0, gotB.out);
  assert.equal(existsSync(join(b.dir, '.git/hooks/pre-commit')), false);

  // (c) local-outside — 리포 밖에 디렉토리가 생기면 안 된다
  const c = newRepo(t);
  const outsideDir = mkdtempSync(join(tmpdir(), 'harness-wire3c-outside-'));
  t.after(() => rmSync(outsideDir, { recursive: true, force: true }));
  execSync(`git config core.hooksPath ${outsideDir}`, { cwd: c.dir, env: c.env });
  const gotC = init(c.dir, c.env);
  assert.equal(gotC.code, 0, gotC.out);
  assert.equal(existsSync(join(outsideDir, 'pre-commit')), false, '리포 밖에 파일을 쓰면 안 된다');

  // (d) 추적되는 디렉토리에 pre-commit 만 없다 — 만들면 다음 커밋에 실려 모든 클론으로 간다 (5-B 1-a)
  const d = newRepo(t);
  d.write('tools/git-hooks/commit-msg', '#!/bin/sh\nexit 0\n');
  execSync('git add -A', { cwd: d.dir, env: d.env });
  execSync('git commit -q -m seed', { cwd: d.dir, env: d.env });
  execSync('git config core.hooksPath tools/git-hooks', { cwd: d.dir, env: d.env });
  const gotD = init(d.dir, d.env);
  assert.equal(gotD.code, 0, gotD.out);
  assert.equal(existsSync(join(d.dir, 'tools/git-hooks/pre-commit')), false, gotD.out);
  assert.match(gotD.out, /추적되는 자리/);

  // (e)·(f) 남의 .git/hooks/pre-commit 이 실행 권한이 없거나 sh 계열이 아니다 — 바이트 불변, 이유를 말한다
  for (const [name, body, mode, why] of [
    ['e', '#!/bin/sh\nexit 0\n', 0o644, /실행 권한이 없다/],
    ['f', '#!/usr/bin/env python3\nraise SystemExit(0)\n', 0o755, /shebang 을 모른다/],
  ]) {
    const r = newRepo(t);
    mkdirSync(join(r.dir, '.git/hooks'), { recursive: true });
    writeFileSync(join(r.dir, '.git/hooks/pre-commit'), body);
    chmodSync(join(r.dir, '.git/hooks/pre-commit'), mode);
    // 644 는 git 이 안 도는 훅이라 fresh 로 읽힌다 — --no-config 로 wire() 의 거부 분기까지 가게 한다
    const got = init(r.dir, '--no-config', r.env);
    assert.equal(got.code, 0, got.out);
    assert.equal(read(r.dir, '.git/hooks/pre-commit'), body, `(${name}) 남의 훅을 바꾸면 안 된다`);
    assert.match(got.out, why, got.out);
  }
});

test('④ --override-hooks 는 전역이 있어도 설정을 켠다', (t) => {
  const box = mkdtempSync(join(tmpdir(), 'harness-wire4-'));
  t.after(() => rmSync(box, { recursive: true, force: true }));
  const ghooks = join(box, 'ghooks');
  mkdirSync(ghooks, { recursive: true });
  const r = newRepo(t, { globalHooksPath: ghooks });
  const got = init(r.dir, '--override-hooks', r.env);
  assert.equal(got.code, 0, got.out);
  assert.equal(spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: r.dir, env: r.env, encoding: 'utf8' }).stdout.trim(), '.githooks');
});

test('⑤ --dry-run — (가) fresh 리포는 config 계획을 낸다, (나) 남의 훅이 있으면 바이트가 안 바뀐다', (t) => {
  const a = newRepo(t);
  const gotA = init(a.dir, '--dry-run', a.env);
  assert.equal(gotA.code, 0, gotA.out);
  assert.match(gotA.out, /DRY \+ git config core\.hooksPath \.githooks/);
  assert.doesNotMatch(gotA.out, /\.git\/hooks\/pre-commit/, '설정을 켤 리포에서 .git/hooks 배선까지 계획하면 예행연습이 거짓말을 한다');

  const b = newRepo(t);
  mkdirSync(join(b.dir, '.git/hooks'), { recursive: true });
  const foreign = '#!/bin/sh\nexit 0\n';
  writeFileSync(join(b.dir, '.git/hooks/pre-commit'), foreign);
  chmodSync(join(b.dir, '.git/hooks/pre-commit'), 0o755);
  const gotB = init(b.dir, '--dry-run', b.env);
  assert.equal(gotB.code, 0, gotB.out);
  assert.equal(read(b.dir, '.git/hooks/pre-commit'), foreign, '--dry-run 은 남의 훅을 바꾸면 안 된다');
});

test('⑥ husky v9 — 디스패처는 안 건드리고 .husky/pre-commit 에 배선한다', (t) => {
  const r = newRepo(t);
  r.write('.husky/_/pre-commit', '#!/bin/sh\n. "$(dirname "$0")/husky.sh"\nsh .husky/pre-commit\n');
  chmodSync(join(r.dir, '.husky/_/pre-commit'), 0o755);
  const dispatcherBefore = read(r.dir, '.husky/_/pre-commit');
  execSync('git config core.hooksPath .husky/_', { cwd: r.dir, env: r.env });

  const got = init(r.dir, r.env);
  assert.equal(got.code, 0, got.out);
  assert.equal(read(r.dir, '.husky/_/pre-commit'), dispatcherBefore, '디스패처의 바이트는 안 바뀐다');
  assert.match(read(r.dir, '.husky/pre-commit'), /module-gate/);
});
