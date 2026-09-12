#!/usr/bin/env node
// module-gate.mjs — MODULE.md 계약 게이트 (스키마 v1)
// 사용: node .harness/module-gate.mjs            (작업 트리 vs HEAD)
//       node .harness/module-gate.mjs --staged   (pre-commit)
//       node .harness/module-gate.mjs --base origin/main   (CI)
//       node .harness/module-gate.mjs --fix      (R12 근거 경로를 리포 루트 기준으로 자동 정정)
// 종료 코드: FAIL 1개 이상이면 1
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const args = process.argv.slice(2);
const staged = args.includes('--staged');
const fix = args.includes('--fix');
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args[baseIdx + 1] : 'HEAD';
const MAX_LINES = 80;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'Library', 'Temp', 'obj', 'Logs', 'builds']);
// R1/R2 가 "코드 변경"으로 보는 확장자. 모듈별로 frontmatter `watch: .cs,.shader` 로 덮어쓸 수 있다
const DEFAULT_WATCH = ['.cs', '.asmdef', '.py', '.sh', '.mjs', '.js', '.ts'];
const CONTRACT_SECTIONS = ['책임', '진입점', '의존', '불변식'];

const root = execSync('git rev-parse --show-toplevel').toString().trim();
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const toPosix = (p) => p.split('\\').join('/');

// ---------- MODULE.md 수집 ----------
function findModules(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) findModules(full, out);
    else if (name === 'MODULE.md') out.push(toPosix(relative(root, full)));
  }
  return out;
}

function parseModule(relPath, text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'); // BOM·CRLF 정규화
  const fm = {};
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (m) fm[m[1]] = m[2];
  }
  const section = (name) => {
    const m = text.match(new RegExp(`\\n## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`));
    return m ? m[1] : '';
  };
  const links = (s) => [...s.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
  const depsIn = section('의존').match(/### in[\s\S]*?(?=### out|$)/)?.[0] ?? '';
  const depsOut = section('의존').match(/### out[\s\S]*$/)?.[0] ?? '';
  return {
    file: relPath,
    dir: toPosix(dirname(relPath)) === '.' ? '' : toPosix(dirname(relPath)),
    fm,
    watch: fm.watch ? fm.watch.split(',').map((s) => s.trim()) : DEFAULT_WATCH,
    contract: CONTRACT_SECTIONS.map((s) => section(s).trim()).join('\n---\n'),
    lines: text.split('\n').length,
    in: links(depsIn),
    out: links(depsOut),
    invariants: section('불변식').split('\n').filter((l) => /^- I\d+\./.test(l)),
    pending: section('미결'),
    history: section('이력').split('\n').filter((l) => /^- /.test(l)),
  };
}

const modules = findModules(root).map((p) => parseModule(p, readFileSync(join(root, p), 'utf8')));
const bySlug = new Map(modules.map((m) => [m.fm.module, m]));

// ---------- 변경 파일 ----------
const diffCmd = staged ? 'git diff --cached --name-only' : `git diff --name-only ${base}`;
const untrackedAll = sh('git ls-files --others --exclude-standard');
// --staged 에서도 untracked MODULE.md 는 "변경됨" 으로 센다. findModules 는 파일시스템을 걷는데
// diff 만 인덱스를 보면, 방금 쓴 계약서를 R1 이 "미변경" 이라고 답하고 R2 는 아예 돌지 않는다.
// untracked 파일은 커밋에 아직 없으니 내용 전체가 변경이다. 소스는 그대로 제외 — staged 가
// 아닌 .cs 는 실제로 커밋에 안 들어간다
const untracked = staged ? untrackedAll.split('\n').filter((f) => f.endsWith('MODULE.md')).join('\n') : untrackedAll;
const changed = [...new Set((sh(diffCmd) + '\n' + untracked).split('\n').filter(Boolean).map(toPosix))];
const changedSet = new Set(changed);

// 변경 파일을 가장 깊은 모듈에 귀속
const ownerOf = (file) => {
  let best = null;
  for (const m of modules) {
    const inside = m.dir === '' || file === m.dir || file.startsWith(m.dir + '/');
    if (inside && (best === null || m.dir.length > best.dir.length)) best = m;
  }
  return best;
};

const baseText = (file) => {
  try { return sh(`git show ${staged ? 'HEAD' : base}:${file}`); } catch { return null; }
};

// a 가 m 의 조상 모듈인가 (루트 모듈은 모든 모듈의 조상)
const isAncestor = (a, m) => a !== m && (a.dir === '' || m.dir.startsWith(a.dir + '/'));

// m 의 미결이 slug 를 이미 모듈 후보로 적어 뒀는가 — R3 "MODULE.md 없음" 경고의 침묵 조건.
// 줄이 "모듈" 을 말하면서 그 경로를 적고 있어야 한다. 미결 표기(`.harness/`, `Assets/Scripts/Data`)와
// 슬러그(harness, data)가 다르므로 경로의 마지막 조각만 벗겨 대조한다.
const namedAsCandidate = (m, slug) =>
  m.pending.split('\n').some((line) =>
    /^- /.test(line) && line.includes('모듈') &&
    [...line.matchAll(/[\w.\-]+(?:\/[\w.\-]+)*\/?/g)].some(
      ([t]) => t.replace(/\/+$/, '').split('/').pop().replace(/^\.+/, '').toLowerCase() === slug));

// 근거에 적힌 경로를 리포 상대 경로로 해석: 그대로 → m.dir 기준 → 조상 디렉토리 기준 순으로 존재하는 첫 후보
const resolveEvidencePath = (m, p) => {
  const bases = [''];
  const parts = m.dir ? m.dir.split('/') : [];
  for (let i = parts.length; i > 0; i--) bases.push(parts.slice(0, i).join('/'));
  for (const b of bases) {
    const cand = b ? `${b}/${p}` : p;
    if (existsSync(join(root, cand))) return cand;
  }
  return null;
};

// 근거 문자열에서 파일:라인 토큰 추출 → [{file, line}] (file 은 리포 상대)
// 라인은 76, 76-81, 76,81 형태를 모두 받는다. 범위는 시작 라인을 키로 쓴다.
const evidenceRefs = (m, evidence) =>
  [...evidence.matchAll(/([\w.\-\/]+\.[A-Za-z]+):(\d+)(?:[-,]\d+)*/g)]
    .map(([, f, l]) => ({ file: resolveEvidencePath(m, f), line: l }))
    .filter((r) => r.file);

// ---------- 규칙 ----------
const results = [];
const report = (level, mod, rule, msg) => results.push({ level, mod, rule, msg });
const strict = (m) => m.fm.status === 'active'; // draft 는 WARN 으로 강등
const lvl = (m) => (strict(m) ? 'FAIL' : 'WARN');
const evidenceIndex = new Map(); // "file:line" → { mod, id }  (R8)
const fixQueue = new Map();      // MODULE.md → [정정할 경로]   (R12 --fix)

for (const m of modules) {
  const slug = m.fm.module ?? m.file;

  // R7 미결의 "분할 후보: X" 가 가리키는 곳에 이미 MODULE.md 가 있으면 미결 정리 필요
  for (const line of m.pending.split('\n')) {
    const mm = line.match(/분할 후보:\s*(.+)/);
    if (!mm) continue;
    for (const p of mm[1].split(/[,，]\s*/).map((s) => s.trim()).filter(Boolean)) {
      const target = m.dir ? `${m.dir}/${p}` : p;
      const child = modules.find((x) => x.dir === target || x.dir === p);
      if (child) report(lvl(m), slug, 'R7', `분할 후보 ${p} 에 이미 [[${child.fm.module}]] 있음 — 미결에서 제거하고 중복 불변식 이관`);
    }
  }

  // R0 frontmatter
  if (!m.fm.module || m.fm.path === undefined) report('FAIL', slug, 'R0', 'frontmatter 에 module/path 필요');
  else if (m.fm.path !== m.dir && !(m.fm.path === '.' && m.dir === ''))
    report('FAIL', slug, 'R0', `path(${m.fm.path}) 와 실제 위치(${m.dir || '.'}) 불일치`);

  // R1 소스 diff ⇒ MODULE.md diff (데이터·에셋 변경은 무시)
  const codeChanged = changed.filter(
    (f) => ownerOf(f) === m && m.watch.some((ext) => f.endsWith(ext)));
  const docChanged = changedSet.has(m.file);
  if (codeChanged.length && !docChanged)
    report(lvl(m), slug, 'R1', `소스 ${codeChanged.length}개 변경, MODULE.md 미변경 — 계약 확인 필요 (예: ${codeChanged[0]})`);

  // R2 계약 섹션(책임·진입점·의존·불변식) 변경 ⇒ 이력 항목 추가. 미결·이력만 고친 건 제외
  if (docChanged) {
    const prev = baseText(m.file);
    const pm = prev ? parseModule(m.file, prev) : null;
    const contractChanged = !pm || pm.contract !== m.contract;
    if (contractChanged && m.history.length <= (pm?.history.length ?? 0))
      report(lvl(m), slug, 'R2', '계약 섹션이 바뀌었는데 이력 항목이 추가되지 않음');
  }

  // R3 의존 대칭 + 모듈 후보
  for (const [dir, deps] of [['out', m.out], ['in', m.in]]) {
    for (const dep of deps) {
      const other = bySlug.get(dep);
      // 상대에 MODULE.md 가 없으면 모듈 후보다. 미결이 이미 그렇게 적어 뒀으면 침묵한다 —
      // 순환 의존을 양쪽에 적으면 조용해지는 것과 같은 원리로, 아는 사실을 두 번 말하게 하지 않는다
      if (!other) {
        if (!namedAsCandidate(m, dep)) report('WARN', slug, 'R3', `${dir} [[${dep}]] 에 MODULE.md 없음 — 모듈 후보`);
        continue;
      }
      const back = dir === 'out' ? other.in : other.out;
      if (!back.includes(slug))
        report(lvl(m), slug, 'R3', `${dir} [[${dep}]] 이지만 ${dep}.${dir === 'out' ? 'in' : 'out'} 에 [[${slug}]] 없음`);
    }
  }

  // R4 길이
  if (m.lines > MAX_LINES) report(lvl(m), slug, 'R4', `${m.lines}줄 > ${MAX_LINES} — 분할 후보`);

  // R9 CLAUDE.md 어댑터 (어댑터는 재귀하지 않으므로 모듈마다 필요)
  const adapter = m.dir ? `${m.dir}/CLAUDE.md` : 'CLAUDE.md';
  if (!existsSync(join(root, adapter)))
    report(lvl(m), slug, 'R9', `${adapter} 없음 — MODULE.md 가 로드되지 않는다`);
  else if (!/@MODULE\.md/.test(readFileSync(join(root, adapter), 'utf8')))
    report(lvl(m), slug, 'R9', `${adapter} 에 @MODULE.md import 없음`);

  // R10 미결 항목은 v1 의 3상태만 허용: 질문 / "결정: … (예정)" / (완료는 존재하지 않음)
  // 완료 표기는 승격(줄 삭제 + 불변식 신설) 실패 신호다.
  for (const line of m.pending.split('\n')) {
    if (!/^- /.test(line)) continue;
    const isDecision = /^- 결정[:\s]/.test(line);
    if (!isDecision) continue;              // 질문 줄은 자유 형식
    if (/\(예정\)/.test(line)) continue;     // 결정됨·미구현 — 정상
    report(lvl(m), slug, 'R10', `결정 줄에 (예정) 없음 — 구현됐다면 줄을 삭제하고 불변식으로 승격: ${line.slice(2, 42)}…`);
  }

  // R5 불변식 근거·검증 수단
  for (const inv of m.invariants) {
    const id = inv.match(/^- (I\d+)\./)[1];
    // 폐기 항목은 규칙이 아니라 ID 를 재사용하지 않기 위한 묘비 — 근거·검증 수단을 요구하지 않는다
    if (/\(폐기/.test(inv)) continue;
    if (!/근거:/.test(inv)) report(lvl(m), slug, 'R5', `${id} 근거 없음`);
    if (!/\[(테스트|grep|리뷰)\]/.test(inv)) report(lvl(m), slug, 'R5', `${id} 검증 수단 태그 없음`);
    const evidence = inv.match(/근거:\s*([^)]*)\)/)?.[1] ?? '';
    // R12 근거 경로는 리포 루트 기준으로 적는다 (v1 규칙). 상대 경로는 해석은 되지만 기준이 흔들린다
    for (const [, p] of evidence.matchAll(/([\w.\-\/]+\.[A-Za-z]+):\d+/g)) {
      const resolved = resolveEvidencePath(m, p);
      // 해석 실패는 "기준이 다름" 과 다른 사고다 — 정정할 대상이 없고, evidenceRefs 가 버리므로
      // R6·R8·R11 도 그 인용을 못 본다. 침묵하면 틀린 경로가 계약서에 눌러앉는다
      if (!resolved)
        report('WARN', slug, 'R12', `${id} 근거 경로 "${p}" 가 어디로도 해석되지 않음 — 파일이 없거나 경로가 틀렸다. R11 도 이 파일을 추적하지 못한다`);
      else if (resolved !== p) {
        if (fix) fixQueue.set(m.file, [...(fixQueue.get(m.file) ?? []), p]);
        else report('WARN', slug, 'R12', `${id} 근거 경로 "${p}" 가 리포 루트 기준이 아님 → "${resolved}"`);
      }
    }
    // R6 검증 근거가 다른 모듈에 있으면 그 모듈이 out 에 있어야 함. 자기 자신과 조상(공용 테스트 보관처)은 제외
    for (const ref of evidenceRefs(m, evidence)) {
      const owner = ownerOf(ref.file);
      if (!owner || owner === m || isAncestor(owner, m)) continue;
      // 부모-자식은 스키마가 in/out 링크를 금하므로 조상 면제는 양방향이다.
      // 방향(in/out)이 맞는지는 R3 이 보므로 여기서는 둘 중 하나에 있기만 하면 된다
      if (!isAncestor(m, owner) && !m.out.includes(owner.fm.module) && !m.in.includes(owner.fm.module))
        report('WARN', slug, 'R6', `${id} 근거 ${ref.file} 가 [[${owner.fm.module}]] 소유이지만 의존에 없음`);
      // R8 같은 파일:라인을 두 모듈이 불변식 근거로 인용 — 중복 계약
      const key = `${ref.file}:${ref.line}`;
      const seen = evidenceIndex.get(key);
      if (seen && seen.mod !== m) report('WARN', slug, 'R8', `${id} 근거 ${key} 가 [[${seen.mod.fm.module}]] ${seen.id} 와 중복 — 깊은 소유자에 남기고 폐기 표시`);
      else if (!seen) evidenceIndex.set(key, { mod: m, id });
    }
  }
}

// ---------- R11 근거 파일 역추적 ----------
// 불변식이 근거로 인용한 파일이 변경됐는데 그 모듈의 MODULE.md 가 안 바뀌었으면 경고.
// 소유 관계와 무관 — 검증 수단이 모듈 밖(공용 테스트 디렉토리)에 있을 때 R1 의 사각지대를 덮는다.
for (const m of modules) {
  if (changedSet.has(m.file)) continue;
  const slug = m.fm.module ?? m.file;
  const hit = new Map(); // file → [id]
  for (const inv of m.invariants) {
    if (/\(폐기/.test(inv)) continue;
    const id = inv.match(/^- (I\d+)\./)[1];
    const evidence = inv.match(/근거:\s*([^)]*)\)/)?.[1] ?? '';
    for (const ref of evidenceRefs(m, evidence)) {
      if (!changedSet.has(ref.file)) continue;
      if (ownerOf(ref.file) === m) continue; // 그건 R1 이 이미 본다
      hit.set(ref.file, [...(hit.get(ref.file) ?? []), id]);
    }
  }
  for (const [file, ids] of hit)
    report(lvl(m), slug, 'R11', `${ids.join('·')} 근거 ${file} 변경됨, MODULE.md 미변경 — 계약이 약화됐는지 확인`);
}

// ---------- R12 --fix 적용 ----------
// 판정과 수리가 같은 정보(resolveEvidencePath)를 쓰므로 자동 정정한다.
// 근거 경로만 바꾼다 — 계약 문장은 건드리지 않는다.
if (fix && fixQueue.size) {
  for (const [file, paths] of fixQueue) {
    const m = modules.find((x) => x.file === file);
    let text = readFileSync(join(root, file), 'utf8');
    let n = 0;
    // 긴 경로부터 치환해야 짧은 경로가 긴 경로의 일부를 먼저 먹지 않는다
    for (const p of [...new Set(paths)].sort((a, b) => b.length - a.length)) {
      const resolved = resolveEvidencePath(m, p);
      if (!resolved || resolved === p) continue;
      // "근거:" 가 있는 줄에서, 뒤에 :숫자 가 오는 경우만 치환
      text = text.split('\n').map((line) => {
        if (!/근거:/.test(line)) return line;
        const before = line;
        line = line.split(`${p}:`).join(`${resolved}:`);
        if (line !== before) n++;
        return line;
      }).join('\n');
    }
    writeFileSync(join(root, file), text);
    console.log(`FIX  ${file}  근거 경로 ${n}곳 정정`);
  }
  console.log('\n정정 후 이력에 한 줄 추가하고 다시 실행하세요 (계약 문장은 바뀌지 않았습니다).');
}

// ---------- 출력 ----------
if (!results.length) { console.log(`module-gate: OK (${modules.length} modules, ${changed.length} changed files)`); process.exit(0); }
for (const r of results) console.log(`${r.level.padEnd(4)} ${r.mod.padEnd(24)} ${r.rule}  ${r.msg}`);
const fails = results.filter((r) => r.level === 'FAIL').length;
console.log(`\nmodule-gate: ${fails} FAIL, ${results.length - fails} WARN`);
process.exit(fails ? 1 : 0);
