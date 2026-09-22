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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INIT = join(HERE, 'module-harness-init.mjs');
const SCHEMA = join(HERE, 'MODULE-schema-v1.md');

function newRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
  git('init -q');
  git('config user.email init@test');
  git('config user.name init');
  return { dir, git, write: (rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); } };
}

function init(dir, ...args) {
  const r = spawnSync('node', [INIT, ...args], { cwd: dir, encoding: 'utf8' });
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
// 기존 여덟은 위에 그대로 있다. I6 이 :50 을 인용하므로 이 파일은 끝에만 는다.
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
