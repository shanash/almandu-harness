#!/usr/bin/env node
// module-gate.test.mjs — 게이트 자신의 회귀 테스트
// 사용: node --test .harness/module-gate.test.mjs
//
// 임시 git 저장소에 fixture 모듈을 세우고 규칙별로 우는지·조용한지 본다.
// 이 리포의 계약서를 판정하지 않는다 — 계약서가 바뀌어도 이 테스트는 그대로여야 하고,
// .harness/ 가 별도 저장소로 나갈 때 이 파일이 게이트를 따라간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'module-gate.mjs');

// ---------- fixture ----------

// 최소 계약서. 기본값은 어느 규칙도 울리지 않는 상태이고, 테스트가 한 곳만 어긋나게 만든다
function moduleDoc({
  slug, path, status = 'draft', watch,
  inDeps = ['- 없음'], outDeps = ['- 없음'],
  invariants = ['- I1. 아무것도 약속하지 않는다 (근거: 없음) [리뷰]'],
  pending = [], history = ['- 2026-01-01 최초 작성'],
}) {
  return [
    '---',
    `module: ${slug}`,
    `path: ${path}`,
    'schema: 1',
    `status: ${status}`,
    ...(watch ? [`watch: ${watch}`] : []),
    '---',
    '',
    '## 책임',
    `${slug} 를 소유한다.`,
    '',
    '## 진입점',
    '- 없음',
    '',
    '## 의존',
    '### in (이 모듈이 쓰는 것)',
    ...inDeps,
    '### out (이 모듈을 쓰는 것)',
    ...outDeps,
    '',
    '## 불변식',
    ...invariants,
    '',
    '## 미결',
    ...pending,
    '',
    '## 이력',
    ...history,
    '',
  ].join('\n');
}

function write(dir, rel, text) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

// 모듈 하나 = MODULE.md + 어댑터. 어댑터가 없으면 R9 가 울어 다른 규칙의 판정이 묻힌다.
// at 은 파일을 실제로 놓을 자리 — frontmatter 의 path 와 어긋나게 둘 때만 쓴다 (R0)
function putModule(dir, opts, at = opts.path) {
  const where = at === '.' ? '' : at;
  write(dir, join(where, 'MODULE.md'), moduleDoc(opts));
  write(dir, join(where, 'CLAUDE.md'), '@MODULE.md\n');
}

function newRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'module-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'ignore' });
  git('init -q');
  git('config user.email gate@test');
  git('config user.name gate');
  git('config commit.gpgsign false');
  return { dir, git, commit: () => { git('add -A'); git('commit -q -m fixture'); } };
}

function gate(dir, ...args) {
  try {
    return { code: 0, out: execFileSync('node', [GATE, ...args], { cwd: dir, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

// "WARN alpha R3" 같은 줄이 있는지
const has = (out, level, slug, rule) =>
  out.split('\n').some((l) => l.startsWith(level) && l.includes(` ${slug} `) && l.includes(` ${rule}  `));

// alpha 와 beta 를 서로 올바르게 물린 상태로 세운다
function twoModules(t, { alphaStatus = 'draft' } = {}) {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', status: alphaStatus, outDeps: ['- [[beta]] — beta 가 alpha 를 쓴다'] });
  putModule(r.dir, { slug: 'beta', path: 'beta', inDeps: ['- [[alpha]] — alpha 를 쓴다'] });
  write(r.dir, 'alpha/a.cs', 'class A {}\n');
  write(r.dir, 'beta/b.cs', 'class B {}\n');
  r.commit();
  return r;
}

// ---------- 테스트 ----------

test('깨끗한 트리는 OK 를 찍고 0 으로 끝난다', (t) => {
  const r = twoModules(t);
  const { code, out } = gate(r.dir);
  assert.equal(code, 0);
  assert.match(out, /module-gate: OK/);
});

test('R0 path 가 실제 위치와 다르면 draft 여도 FAIL', (t) => {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'elsewhere' }, 'alpha');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 1);
  assert.ok(has(out, 'FAIL', 'alpha', 'R0'), out);
});

test('R1 소스만 고치면 운다 — active 는 FAIL, draft 는 WARN', (t) => {
  for (const [status, level, code] of [['active', 'FAIL', 1], ['draft', 'WARN', 0]]) {
    const r = twoModules(t, { alphaStatus: status });
    write(r.dir, 'alpha/a.cs', 'class A { int x; }\n');
    const got = gate(r.dir);
    assert.equal(got.code, code, `${status}: ${got.out}`);
    assert.ok(has(got.out, level, 'alpha', 'R1'), `${status}: ${got.out}`);
  }
});

test('R1 은 계약서를 같은 변경에 넣으면 조용해진다', (t) => {
  const r = twoModules(t, { alphaStatus: 'active' });
  write(r.dir, 'alpha/a.cs', 'class A { int x; }\n');
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha', status: 'active',
    outDeps: ['- [[beta]] — beta 가 alpha 를 쓴다'],
    history: ['- 2026-01-01 최초 작성', '- 2026-01-02 x 를 더한다'],
  });
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(!has(out, 'FAIL', 'alpha', 'R1'), out);
});

test('R2 계약 섹션을 고치고 이력을 안 늘리면 운다', (t) => {
  const r = twoModules(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    outDeps: ['- [[beta]] — beta 가 alpha 를 쓴다'],
    invariants: ['- I1. 새 약속을 한다 (근거: 없음) [리뷰]'],
  });
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R2'), out);
});

test('R3 한쪽에만 적은 의존은 대칭 경고', (t) => {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', outDeps: ['- [[beta]] — 한쪽만 적었다'] });
  putModule(r.dir, { slug: 'beta', path: 'beta' });
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R3'), out);
  assert.match(out, /beta\.in 에 \[\[alpha\]\] 없음/);
});

test('R3 모듈 후보 — 미결이 이미 적어 뒀으면 침묵, 아니면 경고', (t) => {
  // 미결에 없음 → 운다
  const bare = newRepo(t);
  putModule(bare.dir, { slug: 'alpha', path: 'alpha', inDeps: ['- [[ghost]] — MODULE.md 가 없는 곳'] });
  bare.commit();
  const before = gate(bare.dir).out;
  assert.ok(has(before, 'WARN', 'alpha', 'R3'), before);

  // 미결이 경로로 적어 뒀으면 침묵 — 표기(`ghost/`)와 슬러그(ghost)가 달라도 마지막 조각으로 만난다
  const named = newRepo(t);
  putModule(named.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[ghost]] — MODULE.md 가 없는 곳'],
    pending: ['- 모듈 후보: `sub/ghost/` (MODULE.md 없음)'],
  });
  named.commit();
  const after = gate(named.dir);
  assert.equal(after.code, 0, after.out);
  assert.match(after.out, /module-gate: OK/);
});

test('R3 침묵은 "모듈" 을 말하는 줄에만 적용된다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[ghost]] — MODULE.md 가 없는 곳'],
    // 경로는 있지만 모듈 후보로 적은 줄이 아니다
    pending: ['- 불변식 후보: `sub/ghost/` 의 산출물을 아무도 검증하지 않는다'],
  });
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R3'), out);
});

test('R6 근거가 다른 모듈 소유이면 in 쪽에 적혀 있어도 조용하다', (t) => {
  // in 에 있음 → 침묵 (방향이 맞는지는 R3 이 본다)
  const ok = newRepo(t);
  putModule(ok.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[beta]] — beta 를 쓴다'],
    invariants: ['- I1. beta 의 모양에 기댄다 (근거: beta/b.cs:1) [grep]'],
  });
  putModule(ok.dir, { slug: 'beta', path: 'beta', outDeps: ['- [[alpha]] — alpha 가 쓴다'] });
  write(ok.dir, 'beta/b.cs', 'class B {}\n');
  ok.commit();
  const silent = gate(ok.dir);
  assert.equal(silent.code, 0, silent.out);
  assert.ok(!has(silent.out, 'WARN', 'alpha', 'R6'), silent.out);

  // 어느 쪽에도 없음 → 운다
  const bad = newRepo(t);
  putModule(bad.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. beta 의 모양에 기댄다 (근거: beta/b.cs:1) [grep]'],
  });
  putModule(bad.dir, { slug: 'beta', path: 'beta' });
  write(bad.dir, 'beta/b.cs', 'class B {}\n');
  bad.commit();
  const loud = gate(bad.dir).out;
  assert.ok(has(loud, 'WARN', 'alpha', 'R6'), loud);
});

test('R6 부모-자식은 양방향으로 면제된다', (t) => {
  // 스키마가 부모-자식 in/out 링크를 금하므로, 면제가 한 방향이면 조용해질 길이 없다
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'parent', path: 'proj',
    invariants: ['- I1. 자식 파일에 기댄다 (근거: proj/child/c.cs:1) [grep]'],
  });
  putModule(r.dir, {
    slug: 'child', path: 'proj/child',
    invariants: ['- I1. 부모 파일에 기댄다 (근거: proj/p.cs:1) [grep]'],
  });
  write(r.dir, 'proj/p.cs', 'class P {}\n');
  write(r.dir, 'proj/child/c.cs', 'class C {}\n');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(!/R6/.test(out), out);
});

test('R11 근거 파일이 바뀌면 그 파일을 소유하지 않은 모듈도 운다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[beta]] — beta 를 쓴다'],
    invariants: ['- I1. beta 의 모양에 기댄다 (근거: beta/b.cs:1) [grep]'],
  });
  putModule(r.dir, { slug: 'beta', path: 'beta', outDeps: ['- [[alpha]] — alpha 가 쓴다'] });
  write(r.dir, 'beta/b.cs', 'class B {}\n');
  r.commit();
  write(r.dir, 'beta/b.cs', 'class B { int y; }\n');
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R11'), out);   // 소유 밖 — R1 이 못 보는 자리
  assert.ok(has(out, 'WARN', 'beta', 'R1'), out);     // 소유 안 — R1 이 보는 자리
});

test('--staged 는 인덱스만 본다', (t) => {
  const r = twoModules(t, { alphaStatus: 'active' });
  write(r.dir, 'alpha/a.cs', 'class A { int x; }\n');
  assert.equal(gate(r.dir).code, 1);                  // 작업 트리 모드는 본다
  assert.equal(gate(r.dir, '--staged').code, 0);      // 스테이지 전이면 커밋에 안 들어간다
  r.git('add alpha/a.cs');
  assert.equal(gate(r.dir, '--staged').code, 1);      // 스테이지하면 본다
});

test('R12 는 어디로도 해석되지 않는 근거 경로를 경고한다', (t) => {
  // 해석 실패는 "리포 루트 기준이 아님" 과 다른 사고다 — 정정할 곳이 없고, 그 파일을
  // R11 도 추적하지 못한다. 침묵하면 틀린 경로가 계약서에 그대로 눌러앉는다
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. 없는 파일에 기댄다 (근거: nowhere/missing.cs:12) [grep]'],
  });
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R12'), out);
  assert.match(out, /해석되지 않/);
});

test('R12 는 해석되지만 기준이 다른 경로와 해석 실패를 구분해 말한다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. 제 파일에 기댄다 (근거: a.cs:1) [grep]'],   // alpha/a.cs 로 해석된다
  });
  write(r.dir, 'alpha/a.cs', 'class A {}\n');
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R12'), out);
  assert.match(out, /리포 루트 기준이 아님/);
  assert.ok(!/해석되지 않/.test(out), out);
});

test('줄번호 없는 인용도 근거다 — R6 이 본다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. beta 전체에 기댄다 (근거: beta/b.cs) [grep]'],   // 줄번호 없음
  });
  putModule(r.dir, { slug: 'beta', path: 'beta' });
  write(r.dir, 'beta/b.cs', 'class B {}\n');
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R6'), out);
});

test('pytest 노드 ID(`파일.py::테스트명`) 인용도 R11 이 추적한다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[beta]] — beta 를 쓴다'],
    invariants: ['- I1. 그 테스트가 지킨다 (근거: beta/t_b.py::test_b) [테스트]'],
  });
  putModule(r.dir, { slug: 'beta', path: 'beta', outDeps: ['- [[alpha]] — alpha 가 쓴다'] });
  write(r.dir, 'beta/t_b.py', 'def test_b(): pass\n');
  r.commit();
  write(r.dir, 'beta/t_b.py', 'def test_b(): assert True\n');
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R11'), out);
});

test('심볼의 점 표기는 근거 파일로 오인되지 않는다', (t) => {
  // 줄번호를 요구하지 않게 넓히면 `LeAction.MakerDictionaryInit` 같은 멤버 표기가
  // 파일처럼 보인다. 그것까지 주우면 R12 해석 실패 경고가 문장마다 뜬다
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. `LeAction.MakerDictionaryInit` 과 `actionStruct.fullOuterArgument` 를 쓴다 (근거: alpha/a.cs:1) [grep]'],
  });
  write(r.dir, 'alpha/a.cs', 'class A {}\n');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(!/R12/.test(out), out);
});

test('R3 은 한 간선의 양쪽이 같은 파일을 다른 줄로 인용하면 운다', (t) => {
  // 순환 쌍의 in/out 은 같은 사실을 두 번 적는다. 한쪽 줄번호만 따라 밀면
  // 슬러그 대칭은 그대로라 지금까지 조용했다
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', inDeps: ['- [[beta]] — beta 를 쓴다 (beta/b.cs:3)'] });
  putModule(r.dir, { slug: 'beta', path: 'beta', outDeps: ['- [[alpha]] — alpha 가 쓴다 (beta/b.cs:9)'] });
  write(r.dir, 'beta/b.cs', 'class B {}\n'.repeat(10));
  r.commit();
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R3'), out);
  assert.match(out, /beta\/b\.cs/);
});

test('R3 간선 근거 — 줄이 같으면 조용하고, 한쪽만 인용한 파일은 묻지 않는다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    inDeps: ['- [[beta]] — beta 를 쓴다 (beta/b.cs:3, beta/extra.cs:1)'],
  });
  putModule(r.dir, { slug: 'beta', path: 'beta', outDeps: ['- [[alpha]] — alpha 가 쓴다 (beta/b.cs:3)'] });
  write(r.dir, 'beta/b.cs', 'class B {}\n'.repeat(10));
  write(r.dir, 'beta/extra.cs', 'class E {}\n');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(!/R3/.test(out), out);
});

test('R3 간선 근거는 한쪽이 active 면 FAIL 이다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', inDeps: ['- [[beta]] — beta 를 쓴다 (beta/b.cs:3)'] });
  putModule(r.dir, {
    slug: 'beta', path: 'beta', status: 'active',
    outDeps: ['- [[alpha]] — alpha 가 쓴다 (beta/b.cs:9)'],
  });
  write(r.dir, 'beta/b.cs', 'class B {}\n'.repeat(10));
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 1, out);
  assert.ok(has(out, 'FAIL', 'alpha', 'R3'), out);
});

test('watch 는 확장자 없는 파일도 받는다 — 게이트를 부르는 훅 자신이 그 자리다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', watch: '.sh,git-hooks/pre-commit' });
  write(r.dir, 'alpha/git-hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  r.commit();
  write(r.dir, 'alpha/git-hooks/pre-commit', '#!/bin/sh\nexit 1\n');
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R1'), out);
});

test('watch 의 파일명은 경로 조각 경계에서만 맞는다', (t) => {
  // endsWith 로만 보면 `pre-commit` 이 `my-pre-commit` 까지 먹는다
  const r = newRepo(t);
  putModule(r.dir, { slug: 'alpha', path: 'alpha', watch: 'pre-commit' });
  write(r.dir, 'alpha/my-pre-commit', 'old\n');
  r.commit();
  write(r.dir, 'alpha/my-pre-commit', 'new\n');
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(!/R1/.test(out), out);
});

test('R12 는 active 에서 FAIL 이다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha', status: 'active',
    invariants: ['- I1. 없는 파일에 기댄다 (근거: nowhere/missing.cs:12) [grep]'],
  });
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 1, out);
  assert.ok(has(out, 'FAIL', 'alpha', 'R12'), out);
});

test('R6 은 active 에서 FAIL 이다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha', status: 'active',
    invariants: ['- I1. beta 의 모양에 기댄다 (근거: beta/b.cs:1) [grep]'],
  });
  putModule(r.dir, { slug: 'beta', path: 'beta' });
  write(r.dir, 'beta/b.cs', 'class B {}\n');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 1, out);
  assert.ok(has(out, 'FAIL', 'alpha', 'R6'), out);
});

test('R8 은 active 에서 FAIL 이다', (t) => {
  // 둘 다 gamma 를 의존에 적어 R6 은 조용하고 R8 만 남는다. 어느 쪽이 두 번째로
  // 인용하는지는 순회 순서에 달렸으므로 둘 다 active 로 두고 FAIL 여부만 본다
  const r = newRepo(t);
  for (const slug of ['alpha', 'beta']) {
    putModule(r.dir, {
      slug, path: slug, status: 'active',
      inDeps: ['- [[gamma]] — gamma 를 쓴다'],
      invariants: ['- I1. gamma 의 모양에 기댄다 (근거: gamma/g.cs:1) [grep]'],
    });
  }
  putModule(r.dir, {
    slug: 'gamma', path: 'gamma',
    outDeps: ['- [[alpha]] — alpha 가 쓴다', '- [[beta]] — beta 가 쓴다'],
  });
  write(r.dir, 'gamma/g.cs', 'class G {}\n');
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 1, out);
  assert.ok(out.split('\n').some((l) => l.startsWith('FAIL') && l.includes(' R8  ')), out);
});

test('R3 모듈 후보 경고는 active 에서도 WARN 이다', (t) => {
  // 상대가 아직 모듈이 아니라는 안내이지 계약의 결함이 아니다 — 미결에 적으면 침묵하는
  // 승인 경로도 이미 있다. 이것까지 FAIL 이면 인용만으로 커밋이 막힌다
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha', status: 'active',
    inDeps: ['- [[ghost]] — MODULE.md 가 없는 곳'],
  });
  r.commit();
  const { code, out } = gate(r.dir);
  assert.equal(code, 0, out);
  assert.ok(has(out, 'WARN', 'alpha', 'R3'), out);
});

test('R11 은 인용 줄 위쪽이 밀리면 운다 — MODULE.md 가 다른 이유로 바뀌어도', (t) => {
  // 1번 세션에서 실제로 난 사고: 근거 파일 중간이 밀렸는데 같은 커밋에서 계약서가
  // 다른 불변식 때문에 바뀌어 R11 이 통째로 건너뛰었다. 사람이 눈으로 잡았다
  const r = newRepo(t);
  const inv = ['- I1. 5번째 줄에 기댄다 (근거: alpha/a.cs:5) [grep]'];
  putModule(r.dir, { slug: 'alpha', path: 'alpha', invariants: inv });
  const body = [1, 2, 3, 4, 5, 6].map((i) => `  int x${i};`).join('\n');
  write(r.dir, 'alpha/a.cs', `class A {\n${body}\n`);
  r.commit();
  // 근거 파일의 인용 줄 위쪽에 두 줄이 들어간다
  write(r.dir, 'alpha/a.cs', `class A {\n  int head1;\n  int head2;\n${body}\n`);
  // 그리고 계약서는 *다른 이유로* 바뀐다 — 인용 줄은 그대로다
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: [...inv, '- I2. 새 약속을 한다 (근거: 없음) [리뷰]'],
    history: ['- 2026-01-01 최초 작성', '- 2026-01-02 I2 신설'],
  });
  const { out } = gate(r.dir);
  assert.ok(has(out, 'WARN', 'alpha', 'R11'), out);
  assert.match(out, /5→7/);
});

test('R11 은 인용 줄 아래쪽 변경을 줄 밀림으로 보지 않는다', (t) => {
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. 2번째 줄에 기댄다 (근거: alpha/a.cs:2) [grep]'],
  });
  write(r.dir, 'alpha/a.cs', 'a\nb\nc\n');
  r.commit();
  write(r.dir, 'alpha/a.cs', 'a\nb\nc\nd\ne\n');   // 인용 줄 아래에만 붙는다
  const { out } = gate(r.dir);
  assert.ok(!/인용 줄 위쪽/.test(out), out);
});

test('R11 은 이번에 같이 고친 인용은 밀림으로 묻지 않는다', (t) => {
  // 줄이 밀린 것을 보고 사람이 인용을 고쳤다면 그게 정답이다. 다시 물으면 고칠 길이 없다
  const r = newRepo(t);
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. 그 줄에 기댄다 (근거: alpha/a.cs:2) [grep]'],
  });
  write(r.dir, 'alpha/a.cs', 'a\nb\nc\n');
  r.commit();
  write(r.dir, 'alpha/a.cs', 'head\na\nb\nc\n');
  putModule(r.dir, {
    slug: 'alpha', path: 'alpha',
    invariants: ['- I1. 그 줄에 기댄다 (근거: alpha/a.cs:3) [grep]'],   // 밀린 만큼 따라 옮겼다
    history: ['- 2026-01-01 최초 작성', '- 2026-01-02 I1 근거를 옮긴다'],
  });
  const { out } = gate(r.dir);
  assert.ok(!/인용 줄 위쪽/.test(out), out);
});
