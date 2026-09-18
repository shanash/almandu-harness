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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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
  assert.match(read(r.dir, '.githooks/pre-commit'), /almandu-module-gate --staged/);
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

test('훅이 부르는 bin 은 package.json 에 있고 옛 이름은 같은 파일을 가리킨다', (t) => {
  const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
  const r = newRepo(t);
  init(r.dir);
  const bin = read(r.dir, '.githooks/pre-commit').match(/npx --no-install (\S+)/)[1];
  assert.ok(pkg.bin[bin], `훅이 없는 bin 을 부른다: ${bin}`);
  for (const [old, now] of [['module-gate', 'almandu-module-gate'],
    ['module-harness-init', 'almandu-harness-init'], ['module-loop', 'almandu-module-loop']])
    assert.equal(pkg.bin[old], pkg.bin[now], `별칭 ${old} 이 ${now} 와 다른 파일을 가리킨다`);
});
