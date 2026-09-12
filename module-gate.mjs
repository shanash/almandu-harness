#!/usr/bin/env node
// module-gate.mjs — MODULE.md 계약 게이트 (스키마 v1)
// 사용: npx module-gate            (작업 트리 vs HEAD)
//       npx module-gate --staged   (pre-commit)
//       npx module-gate --base origin/main   (CI)
//       npx module-gate --fix      (R12 근거 경로를 리포 루트 기준으로 자동 정정)
//       npx module-gate --audit    (diff 무관: 인용 줄이 실물을 가리키는지 전수 대조)
//       npx module-gate --json     (같은 판정을 기계 판독 형태로 — 종료 코드는 그대로다)
//       npx module-gate --scope <경로>...  (판정하지 않는다: 그 경로를 고치려면 읽어야 할 계약)
//       npx module-gate --review   (판정하지 않는다: 이 diff 를 리뷰할 때 봐야 할 불변식과 그 태그)
// 종료 코드: FAIL 1개 이상이면 1
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const staged = args.includes('--staged');
const fix = args.includes('--fix');
const audit = args.includes('--audit');
const review = args.includes('--review');
const json = args.includes('--json');
// `--scope` 는 가변 인자다. 다음 플래그를 만나면 멈춘다 — 멈추지 않으면 `--scope a --base main`
// 에서 `main` 을 경로로 주워 간다
const scopeArgs = (() => {
  const i = args.indexOf('--scope');
  if (i < 0) return null;
  const out = [];
  for (let k = i + 1; k < args.length && !args[k].startsWith('--'); k++) out.push(args[k]);
  return out;
})();
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args[baseIdx + 1] : 'HEAD';
const mode = scopeArgs ? 'scope' : review ? 'review' : audit ? 'audit' : staged ? 'staged' : baseIdx >= 0 ? 'base' : 'worktree';
const MAX_LINES = 80;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'Library', 'Temp', 'obj', 'Logs', 'builds']);
// R1 이 "코드 변경"으로 보는 것. 모듈별로 frontmatter `watch: .cs,.shader` 로 덮어쓸 수 있다
const DEFAULT_WATCH = ['.cs', '.asmdef', '.py', '.sh', '.mjs', '.js', '.ts'];
// watch 항목은 확장자(`.cs`) 또는 파일명·경로 꼬리(`git-hooks/pre-commit`)다. 후자를 endsWith 로만
// 보면 `pre-commit` 이 `my-pre-commit` 까지 먹으므로 경로 조각 경계에서만 맞춘다
const watched = (m, f) => m.watch.some((w) =>
  w.startsWith('.') ? f.endsWith(w) : f === w || f.endsWith(`/${w}`));
const CONTRACT_SECTIONS = ['책임', '진입점', '의존', '불변식'];
// R13 건수 주장. `재현: [<범위> 에서 ]`<고정 문자열>` <N>건` 을 적은 불변식만 검사한다 —
// 옵트인이 아니면 기존 [grep] 불변식 전부가 한꺼번에 검사 대상이 된다
const COUNT_RE = /재현:\s*(?:([\w.\-\/]+)\s*에서\s*)?`([^`]+)`\s*(\d+)건/g;
// 커밋마다 도는 grep 의 상한. 비용은 건수가 아니라 범위 폭이다 — 2026-09-12 실측으로
// 모듈 디렉토리 범위는 25회 0.19s, `restored-project/Assets` 트리 범위는 25회 3.2s 다.
// 그래서 상한은 넉넉히 두고 비용 통제는 "범위는 경로 하나" 규칙이 맡는다
const MAX_COUNT_CLAIMS = 64;

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
  // slug → 그 링크가 적힌 줄. R3 이 간선 양쪽의 인용을 대조하는 데 쓴다
  const linkLines = (s) => new Map(s.split('\n')
    .filter((l) => /^- /.test(l) && /\[\[[^\]]+\]\]/.test(l))
    .map((l) => [l.match(/\[\[([^\]]+)\]\]/)[1], l]));
  const depsIn = section('의존').match(/### in[\s\S]*?(?=### out|$)/)?.[0] ?? '';
  const depsOut = section('의존').match(/### out[\s\S]*$/)?.[0] ?? '';
  // R4 가 세는 줄. 미결과 이력은 빠진다 — 둘은 줄 수가 줄지 않는 칸이라(이력은 append-only,
  // 미결은 답이 나올 때까지 남는다) 함께 세면 R2 가 늘린 줄을 R4 가 벌하고, 오래된 계약서는
  // 변경할 때마다 책임·불변식을 깎게 된다. R4 가 묻는 것은 "이 디렉토리의 계약이 큰가" 다
  let inExcluded = false;
  const countedLines = text.split('\n').filter((l) => {
    const h = l.match(/^## (.+?)\s*$/);
    if (h) inExcluded = h[1] === '미결' || h[1] === '이력';
    return !inExcluded;
  }).length;
  return {
    file: relPath,
    dir: toPosix(dirname(relPath)) === '.' ? '' : toPosix(dirname(relPath)),
    fm,
    watch: fm.watch ? fm.watch.split(',').map((s) => s.trim()) : DEFAULT_WATCH,
    contract: CONTRACT_SECTIONS.map((s) => section(s).trim()).join('\n---\n'),
    lines: text.split('\n').length,
    countedLines,
    in: links(depsIn),
    out: links(depsOut),
    inLines: linkLines(depsIn),
    outLines: linkLines(depsOut),
    invariants: section('불변식').split('\n').filter((l) => /^- I\d+\./.test(l)),
    pending: section('미결'),
    history: section('이력').split('\n').filter((l) => /^- /.test(l)),
  };
}

const modules = findModules(root).map((p) => parseModule(p, readFileSync(join(root, p), 'utf8')));
const bySlug = new Map(modules.map((m) => [m.fm.module, m]));

// 파일이 이 모듈의 소유 범위 안인가. ownerOf 와 --scope 가 같은 답을 내야 하므로 한 곳에 둔다
const inside = (m, file) => m.dir === '' || file === m.dir || file.startsWith(m.dir + '/');

// ---------- --scope: 이 경로를 고치려면 무엇을 읽어야 하는가 ----------
// 판정하지 않는다 — ownerOf 를 CLI 표면으로 한 번 더 내는 것이고 종료 코드는 언제나 0 이다.
// 소유 계약과 그 조상을 깊은 것부터 낸다. 하나만 낼지 조상까지 낼지는 아직 안 정했고
// (DESIGN.md 4절), 체인을 통째로 내면 부르는 쪽이 앞에서 잘라 쓸 수 있어 어느 쪽도 막지 않는다.
// 경로가 실재하지 않아도 답한다 — 아직 없는 파일의 소유도 디렉토리 접두사가 정한다
if (scopeArgs) {
  const entries = scopeArgs.map((p) => {
    const rel = toPosix(relative(root, resolve(process.cwd(), p)));
    // 리포 밖 경로에는 소유자가 없다. 오류로 다루지 않는다 — 이 모드는 판정하지 않는다
    const chain = rel.startsWith('../') ? []
      : modules.filter((m) => inside(m, rel)).sort((a, b) => b.dir.length - a.dir.length);
    return { path: rel, owner: chain[0]?.fm.module ?? null, contracts: chain.map((m) => m.file) };
  });
  const byFile = new Map(modules.map((m) => [m.file, m]));
  const union = [...new Set(entries.flatMap((e) => e.contracts))]
    .sort((a, b) => byFile.get(b).dir.length - byFile.get(a).dir.length);
  if (json) {
    process.stdout.write(JSON.stringify({ schema: 1, mode, paths: entries, contracts: union }) + '\n');
    process.exit(0);
  }
  for (const e of entries) {
    console.log(`scope ${e.path} → ${e.owner ? `[[${e.owner}]]` : '소유 모듈 없음'}`);
    for (const c of e.contracts) console.log(`  ${c}`);
  }
  console.log(`\nmodule-gate --scope: 계약 ${union.length}개 — Read 로 열어야 어댑터가 함께 실린다`);
  process.exit(0);
}

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
  for (const m of modules) if (inside(m, file) && (best === null || m.dir.length > best.dir.length)) best = m;
  return best;
};

const baseText = (file) => {
  try { return sh(`git show ${staged ? 'HEAD' : base}:${file}`); } catch { return null; }
};

// 근거 파일의 diff hunk 헤더 → [{a, b, d}] (a,b 는 base 쪽 시작·줄수, d 는 변경 후 줄수).
// 계약서가 안 바뀐 인용의 줄번호는 base 좌표이므로 판정은 base 쪽 범위로 한다
const hunkCache = new Map();
const hunksOf = (file) => {
  if (!hunkCache.has(file)) {
    let out = '';
    try { out = sh(`git diff -U0 ${staged ? '--cached' : base} -- "${file}"`); } catch { /* 삭제·신규 */ }
    hunkCache.set(file, [...out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)]
      .map((m) => ({ a: +m[1], b: m[2] === undefined ? 1 : +m[2], d: m[4] === undefined ? 1 : +m[4] })));
  }
  return hunkCache.get(file);
};

// 인용 줄보다 위에서 늘거나 준 줄 수의 합. 0 이 아니면 그 줄은 다른 곳을 가리킨다.
// b === 0 은 순수 삽입이라 base 쪽 범위가 비어 있다 — a 번째 줄 뒤에 들어간 것으로 센다
const shiftAbove = (file, line) => hunksOf(file).reduce((acc, h) => {
  const end = h.b === 0 ? h.a : h.a + h.b - 1;
  return end < line ? acc + h.d - h.b : acc;
}, 0);

// 범위 안에서 고정 문자열이 몇 번 나오는지. 패턴에 셸 메타문자가 들어오므로 execFileSync 를 쓴다.
// MODULE.md 는 제외한다 — 패턴이 계약서 안에 문자열로 적혀 있어 모든 주장이 제 발에 걸린다
const countMatches = (pattern, scope) => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-I', '-F', '-o', ...(staged ? ['--cached'] : ['--untracked']),
      '-e', pattern, '--', scope], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (e.status !== 1) throw e;   // 1 = 한 건도 없음
  }
  return out.split('\n').filter((l) => l && !/(^|\/)MODULE\.md:/.test(l)).length;
};

// R14 외부 모듈. `in` 쪽 의존 줄에 `외부: <패키지명>` 을 적으면 그 슬러그는 이 리포 밖에 산다 —
// 하네스가 npm 패키지로 설치되면서 생긴 자리다. `out` 쪽에는 적을 수 없다: 패키지는 자기를 쓰는
// 리포를 셀 수 없고, 셀 수 있다고 적는 순간 그 줄은 거짓이 된다. 쓰는 쪽이 자기 `in` 에 적는다
const EXTERNAL_RE = /외부:\s*(@?[\w.\-]+(?:\/[\w.\-]+)?)/;
const pkgDeps = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return new Set(['dependencies', 'devDependencies', 'optionalDependencies']
      .flatMap((k) => Object.keys(pkg[k] ?? {})));
  } catch { return null; } // package.json 이 없는 리포에는 외부 인용도 없다
})();

// a 가 m 의 조상 모듈인가 (루트 모듈은 모든 모듈의 조상)
const isAncestor = (a, m) => a !== m && (a.dir === '' || m.dir.startsWith(a.dir + '/'));

// m 의 미결이 slug 를 이미 모듈 후보로 적어 뒀는가 — R3 "MODULE.md 없음" 경고의 침묵 조건.
// 줄이 "모듈" 을 말하면서 그 경로를 적고 있어야 한다. 미결 표기(`Assets/Scripts/Data`)와 슬러그(data)가
// 다르므로 경로의 마지막 조각만 벗겨 대조한다. 끝 슬래시와 숨은 디렉토리 표기의 앞 점도 함께 벗긴다.
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

// 근거 인용 토큰. 줄번호는 선택이다 — `파일.cs` 단독과 `파일.py::테스트명` 도 인용이고,
// 줄번호를 요구하면 그런 인용이 R6·R8·R11·R12 전부에 보이지 않는다.
// 확장자를 소문자로 묶어 `LeAction.MakerDictionaryInit` 같은 멤버 표기와 가른다 —
// 그것까지 파일로 주우면 해석 실패 경고가 문장마다 뜬다.
const EVIDENCE_RE = /([\w.\-\/]+\.[a-z][a-z0-9]{1,6})(?![\w.\-])(?::(\d+(?:[-,]\d+)*))?/g;

// 확장자 없는 파일도 근거다 (`tools/git-hooks/pre-commit` — 게이트를 부르는 훅 자신이 그 꼴이다).
// 확장자로 가릴 수 없으니 두 조건으로 좁힌다: 경로 조각이 둘 이상이고, 리포 루트 기준으로
// 실재하는 **파일**이다. 디렉토리(`restored-project/Assets/Tests/Editor/`)와 메뉴 경로
// (`KoD/Addressables/Setup Infra`)는 이 필터에서 떨어지고, 해석 실패는 조용하다 —
// 확장자가 없는 토큰은 애초에 파일 인용이라는 표시가 없으므로 R12 로 고발하지 않는다
const PATHLIKE_RE = /((?:[\w.\-]+\/)+[\w.\-]+)(?::(\d+(?:[-,]\d+)*))?/g;
const hasExt = (p) => /\.[a-z][a-z0-9]{1,6}$/.test(p);
const isRootFile = (p) => {
  try { return statSync(join(root, p)).isFile(); } catch { return false; }
};

// 근거 문자열에서 인용 토큰 추출 → [{file, line, spec}] (file 은 리포 상대)
// spec 은 적힌 그대로의 줄 표기(76, 76-81, 76,81)이고 line 은 그 시작 줄 — 키로 쓴다.
// 줄번호 없는 인용은 line·spec 이 null 이다.
const evidenceRefs = (m, evidence) => {
  const out = new Map();                       // `file:spec` → ref (두 정규식이 같은 토큰을 물면 하나로)
  const add = (file, spec) => {
    if (!file) return;
    const key = `${file}:${spec ?? ''}`;
    if (!out.has(key)) out.set(key, { file, line: spec ? spec.match(/^\d+/)[0] : null, spec: spec ?? null });
  };
  for (const [, f, spec] of evidence.matchAll(EVIDENCE_RE)) add(resolveEvidencePath(m, f), spec);
  for (const [, f, spec] of evidence.matchAll(PATHLIKE_RE)) if (!hasExt(f) && isRootFile(f)) add(f, spec);
  return [...out.values()];
};

// 의존 한 줄이 인용한 것 → Map(file → Set(줄 표기)). 줄번호 없는 인용은 담지 않는다 —
// 그것은 줄에 대해 아무 주장도 하지 않으므로 반대쪽과 어긋날 수 없다
const depEvidence = (mod, line) => {
  const map = new Map();
  for (const ref of evidenceRefs(mod, line)) {
    if (!ref.spec) continue;
    if (!map.has(ref.file)) map.set(ref.file, new Set());
    map.get(ref.file).add(ref.spec);
  }
  return map;
};

// ---------- 규칙 ----------
const results = [];
const report = (level, mod, rule, msg) => results.push({ level, mod, rule, msg });
const strict = (m) => m.fm.status === 'active'; // draft 는 WARN 으로 강등
const lvl = (m) => (strict(m) ? 'FAIL' : 'WARN');
const evidenceIndex = new Map(); // "file:line" → { mod, id }  (R8)
const fixQueue = new Map();      // MODULE.md → [정정할 경로]   (R12 --fix)
let countClaims = 0;             // R13 한 실행의 grep 예산

// ---------- --audit: 인용 줄 전수 감사 ----------
// R11(b) 는 한 diff 안의 hunk 만 본다 — 여러 커밋에 걸쳐 조금씩 밀린 인용은 각 커밋에서 0 줄이라
// 조용하고, 인용을 고치지 않은 채 계약서를 다시 손대면 base 판본과 대조할 근거가 사라진다.
// 이 모드는 diff 를 아예 보지 않고 "지금 그 줄에 무엇이 있나" 만 묻는다: 파일 끝을 넘었거나
// 인용 범위가 통째로 빈 줄·중괄호뿐이면 그 인용은 아무것도 주장하지 못한다.
// 주석 줄은 내용이다 — 여러 계약서가 "HARD INVARIANT" 주석을 근거로 인용한다.
if (audit) {
  const NOTHING = /^[\s{}()\[\];,]*$/;
  const findings = [];
  const lineCache = new Map();
  const linesOf = (f) => {
    if (!lineCache.has(f)) {
      try { lineCache.set(f, readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n').split('\n')); }
      catch { lineCache.set(f, null); }
    }
    return lineCache.get(f);
  };
  for (const m of modules) {
    const slug = m.fm.module ?? m.file;
    for (const inv of m.invariants) {
      if (/\(폐기/.test(inv)) continue;
      const id = inv.match(/^- (I\d+)\./)?.[1] ?? '?';
      const evidence = inv.match(/근거:\s*([^)]*)\)/)?.[1] ?? '';
      for (const ref of evidenceRefs(m, evidence)) {
        if (!ref.spec) continue;              // 줄에 대해 아무 주장도 하지 않는 인용
        const lines = linesOf(ref.file);
        if (!lines) continue;                 // 읽히지 않는 파일은 R12 가 본다
        for (const part of ref.spec.split(',')) {
          const [a, b] = part.includes('-') ? part.split('-').map(Number) : [Number(part), Number(part)];
          if (a > lines.length)
            findings.push({ slug, id, at: `${ref.file}:${part}`, why: `파일은 ${lines.length}줄뿐이다` });
          else if (lines.slice(a - 1, b).every((l) => NOTHING.test(l)))
            findings.push({ slug, id, at: `${ref.file}:${part}`, why: '빈 줄·중괄호뿐이라 아무것도 주장하지 못한다' });
        }
      }
    }
  }
  // 감사 소견은 status 와 무관하게 실행을 실패시키므로 JSON 에서는 FAIL 로 낸다 —
  // `fail > 0` 과 종료 코드 1 이 어느 모드에서나 같은 뜻이어야 부르는 쪽이 둘 중 하나만 봐도 된다.
  // rule 은 모드 이름 하나다: 감사는 어느 규칙의 판정도 아니고, 불변식 ID 는 message 에 남는다
  if (json) {
    process.stdout.write(JSON.stringify({
      schema: 1, mode, modules: modules.length, changed: changed.length,
      results: findings.map((f) => ({ level: 'FAIL', module: f.slug, rule: 'AUDIT', message: `${f.id} ${f.at} — ${f.why}` })),
      fail: findings.length, warn: 0,
    }) + '\n');
    process.exit(findings.length ? 1 : 0);
  }
  if (!findings.length) {
    console.log(`module-gate --audit: OK (${modules.length} modules, 인용 줄 전수 대조)`);
    process.exit(0);
  }
  for (const f of findings) console.log(`AUDIT  ${f.slug.padEnd(16)} ${f.id.padEnd(4)} ${f.at} — ${f.why}`);
  console.log(`\nmodule-gate --audit: ${findings.length}건 — 문장과 대조해 밀린 줄번호를 옮겨라 (계약 문장은 대개 그대로다)`);
  process.exit(1);
}

// ---------- --review: 이 diff 를 리뷰할 때 봐야 할 불변식 ----------
// 판정하지 않는다 — `--scope` 와 같은 자리이고 종료 코드는 언제나 0 이다.
// 리뷰 범위를 정하는 것은 diff 가 아니라 "diff 가 건드린 파일에 대해 계약서가 무엇을 약속했나" 이고,
// 그 목록은 R11 이 이미 걷는다. 여기서는 판정 없이 같은 목록을 태그와 함께 낸다 (DESIGN.md 6절).
// 태그가 리뷰어를 정한다: [테스트] 는 테스트를, [grep] 은 `재현:` 명령을 다시 돌리면 되고
// [리뷰] 만 사람·에이전트의 판단이 필요하다 — 계약서가 스스로 "판정 수단이 없다" 고 적은 자리다
if (review) {
  const TAG_RE = /\[(테스트|grep|리뷰)\]/;
  const alive = (m) => m.invariants.filter((inv) => !/\(폐기/.test(inv));
  const items = [];
  for (const m of modules) {
    const slug = m.fm.module ?? m.file;
    for (const inv of alive(m)) {
      const id = inv.match(/^- (I\d+)\./)?.[1] ?? '?';
      const evidence = inv.match(/근거:\s*([^)]*)\)/)?.[1] ?? '';
      const touched = evidenceRefs(m, evidence).filter((r) => changedSet.has(r.file));
      if (!touched.length) continue;
      items.push({
        module: slug, contract: m.file, id,
        tag: inv.match(TAG_RE)?.[1] ?? null,
        text: inv.replace(/^- I\d+\.\s*/, '').replace(/\s*\(근거:.*$/, ''),
        evidence: touched.map((r) => (r.spec ? `${r.file}:${r.spec}` : r.file)),
        // [grep] 리뷰어가 다시 돌릴 것. R13 은 커밋 경로라 예산에 걸려 멈추지만 리뷰는 안 걸린다
        repro: [...inv.matchAll(COUNT_RE)].map(([, s, pattern, expect]) => ({ scope: s ?? m.dir, pattern, expect: Number(expect) })),
      });
    }
  }
  // 불변식이 둘 이상인데 전부 [리뷰] 인 계약서 — 스스로 판정 수단이 없다고 적은 계약서다.
  // 규칙으로 만들지 않고 여기서만 센다 (DESIGN.md 6절 미결의 답): 계약이 빈약한 것은
  // 고칠 일이지 커밋을 막을 일이 아니고, 규칙으로 만들면 이미 통과하던 계약서가 FAIL 이 된다
  const unjudgeable = modules
    .filter((m) => alive(m).length >= 2 && alive(m).every((inv) => inv.match(TAG_RE)?.[1] === '리뷰'))
    .map((m) => m.fm.module ?? m.file);
  const byTag = { 테스트: 0, grep: 0, 리뷰: 0, 없음: 0 };
  for (const it of items) byTag[it.tag ?? '없음']++;

  if (json) {
    process.stdout.write(JSON.stringify({
      schema: 1, mode, modules: modules.length, changed: changed.length,
      invariants: items, byTag, unjudgeable,
    }) + '\n');
    process.exit(0);
  }
  console.log(`module-gate --review: ${changed.length}개 파일 변경 → 그 파일을 근거로 인용하는 불변식 ${items.length}개`);
  for (const [tag, what] of [['테스트', '그 불변식을 검증하는 테스트를 돌린다. 통과가 증거다'],
                             ['grep', '근거의 `재현:` 명령을 다시 돌린다'],
                             ['리뷰', '판정 수단이 없다고 계약서가 스스로 적은 것. 여기만 판단이 필요하다'],
                             ['없음', '태그가 없다 — R5 가 이미 울고 있을 것이다']]) {
    const group = items.filter((it) => (it.tag ?? '없음') === tag);
    if (!group.length) continue;
    console.log(`\n[${tag}] ${group.length}건 — ${what}`);
    for (const it of group) {
      console.log(`  ${it.module.padEnd(16)} ${it.id.padEnd(4)} ${it.evidence.join(' ')}`);
      console.log(`    ${it.text}`);
      for (const r of it.repro) console.log(`    재현: ${r.scope} 에서 \`${r.pattern}\` ${r.expect}건`);
    }
  }
  if (unjudgeable.length)
    console.log(`\n판정 수단이 없는 계약서: ${unjudgeable.join(', ')} — 불변식이 둘 이상인데 전부 [리뷰] 다.\n  게이트는 이것으로 막지 않는다. 계약을 고칠 일이지 커밋을 막을 일이 아니다.`);
  console.log('\n지적은 불변식 ID 를 인용한다. 인용할 불변식이 없는 지적은 계약이 비었다는 뜻이거나(→ 계약을 고친다) 취향이다(→ 버린다).');
  process.exit(0);
}

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
  const codeChanged = changed.filter((f) => ownerOf(f) === m && watched(m, f));
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
      // 외부 표지가 붙은 간선은 리포 경계를 넘는다 — 대칭도 모듈 후보 경고도 물을 상대가 없다.
      // 대신 그 패키지가 실제로 설치 목록에 있는지를 묻는다. 그것이 이 줄의 유일한 검증 수단이다
      const ext = ((dir === 'in' ? m.inLines : m.outLines).get(dep) ?? '').match(EXTERNAL_RE)?.[1];
      if (ext) {
        if (dir === 'out')
          report(lvl(m), slug, 'R14', `out [[${dep}]] 에 외부 표지 — out 은 리포 경계를 넘지 못한다 (쓰는 쪽이 자기 in 에 적는다)`);
        else if (other)
          report(lvl(m), slug, 'R14', `in [[${dep}]] 이 외부 표지를 달았지만 이 리포에 MODULE.md 가 있다 — ${other.file}`);
        else if (!pkgDeps?.has(ext) && !existsSync(join(root, 'node_modules', ext)))
          report(lvl(m), slug, 'R14', `in [[${dep}]] 의 외부 모듈 "${ext}" 이 package.json 의존에도 node_modules 에도 없다`);
        continue;
      }
      // 상대에 MODULE.md 가 없으면 모듈 후보다. 미결이 이미 그렇게 적어 뒀으면 침묵한다 —
      // 순환 의존을 양쪽에 적으면 조용해지는 것과 같은 원리로, 아는 사실을 두 번 말하게 하지 않는다
      // 이 경고만 `status` 와 무관하게 WARN 이다 — 상대가 아직 모듈이 아니라는 안내이지
      // 이 계약의 결함이 아니고, 미결에 적으면 침묵하는 승인 경로가 이미 있다
      if (!other) {
        if (!namedAsCandidate(m, dep)) report('WARN', slug, 'R3', `${dir} [[${dep}]] 에 MODULE.md 없음 — 모듈 후보`);
        continue;
      }
      const back = dir === 'out' ? other.in : other.out;
      if (!back.includes(slug)) {
        report(lvl(m), slug, 'R3', `${dir} [[${dep}]] 이지만 ${dep}.${dir === 'out' ? 'in' : 'out'} 에 [[${slug}]] 없음`);
        continue;
      }
      // 간선 하나를 양쪽이 각자 적으므로 인용도 두 벌이다. 한쪽 줄번호만 따라 밀면
      // 슬러그 대칭은 그대로라 조용하다. in 쪽에서 한 번만 대조한다 — 같은 간선을 두 번 말하지 않는다.
      // 양 끝의 status 가 다를 수 있으므로 엄한 쪽 수준으로 운다
      if (dir !== 'in') continue;
      const mine = depEvidence(m, m.inLines.get(dep) ?? '');
      const theirs = depEvidence(other, other.outLines.get(slug) ?? '');
      for (const [file, specs] of mine) {
        const back2 = theirs.get(file);
        // 한쪽만 인용한 파일은 묻지 않는다 — 두 문장은 같은 간선을 다른 각도에서 적는다.
        // 줄번호 없는 인용도 묻지 않는다 (depEvidence 가 이미 버린다): 줄에 대해 아무 주장도 하지 않는다
        if (!back2) continue;
        const a = [...specs].sort().join('·');
        const b = [...back2].sort().join('·');
        if (a !== b)
          report(strict(m) || strict(other) ? 'FAIL' : 'WARN', slug, 'R3',
            `in [[${dep}]] 과 ${dep}.out [[${slug}]] 이 ${file} 을 다른 줄로 인용 — ${a} vs ${b}`);
      }
    }
  }

  // R4 길이 (미결·이력 제외)
  if (m.countedLines > MAX_LINES)
    report(lvl(m), slug, 'R4', `계약 ${m.countedLines}줄 > ${MAX_LINES} — 분할 후보 (미결·이력 제외, 파일 ${m.lines}줄)`);

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
    for (const [, p] of evidence.matchAll(EVIDENCE_RE)) {
      const resolved = resolveEvidencePath(m, p);
      // 해석 실패는 "기준이 다름" 과 다른 사고다 — 정정할 대상이 없고, evidenceRefs 가 버리므로
      // R6·R8·R11 도 그 인용을 못 본다. 침묵하면 틀린 경로가 계약서에 눌러앉는다
      // 설치된 패키지 안의 파일은 근거가 되지 못한다 — node_modules 는 gitignore 되어 R11 의
      // diff 에 영원히 나타나지 않으므로, 그 인용은 밀려도 썩어도 아무도 묻지 않는다
      if (p.startsWith('node_modules/')) {
        report(lvl(m), slug, 'R14', `${id} 근거 "${p}" 가 외부 모듈 안을 가리킨다 — 그쪽 계약의 불변식 ID 로 말한다`);
        continue;
      }
      if (!resolved)
        report(lvl(m), slug, 'R12', `${id} 근거 경로 "${p}" 가 어디로도 해석되지 않음 — 파일이 없거나 경로가 틀렸다. R11 도 이 파일을 추적하지 못한다`);
      else if (resolved !== p) {
        if (fix) fixQueue.set(m.file, [...(fixQueue.get(m.file) ?? []), p]);
        else report(lvl(m), slug, 'R12', `${id} 근거 경로 "${p}" 가 리포 루트 기준이 아님 → "${resolved}"`);
      }
    }
    // R13 건수 주장을 게이트가 다시 센다. 태그가 있는지만 보고 grep 을 돌리지 않으면
    // 건수는 조용히 거짓이 된다 — actions I1 이 40 에서 42 로 틀어졌을 때 사람이 세서 고쳤다
    for (const [, scopeRaw, pattern, expect] of inv.matchAll(COUNT_RE)) {
      if (countClaims >= MAX_COUNT_CLAIMS) {
        report('WARN', slug, 'R13', `건수 주장이 ${MAX_COUNT_CLAIMS}개를 넘었다 — ${id} 부터 세지 않았다`);
        break;
      }
      countClaims++;
      const scope = scopeRaw ?? m.dir;
      if (!scope || !existsSync(join(root, scope))) {
        report(lvl(m), slug, 'R13', `${id} 재현 범위 "${scope || '(모듈 디렉토리 없음)'}" 가 해석되지 않음 — 리포 루트 기준 경로를 적는다`);
        continue;
      }
      const n = countMatches(pattern, scope);
      if (n !== Number(expect))
        report(lvl(m), slug, 'R13', `${id} 재현 \`${pattern}\` 이 ${scope} 에서 ${n}건 — 계약은 ${expect}건이라고 적는다`);
    }
    // R6 검증 근거가 다른 모듈에 있으면 그 모듈이 out 에 있어야 함. 자기 자신과 조상(공용 테스트 보관처)은 제외
    for (const ref of evidenceRefs(m, evidence)) {
      const owner = ownerOf(ref.file);
      if (!owner || owner === m || isAncestor(owner, m)) continue;
      // 부모-자식은 스키마가 in/out 링크를 금하므로 조상 면제는 양방향이다.
      // 방향(in/out)이 맞는지는 R3 이 보므로 여기서는 둘 중 하나에 있기만 하면 된다
      if (!isAncestor(m, owner) && !m.out.includes(owner.fm.module) && !m.in.includes(owner.fm.module))
        report(lvl(m), slug, 'R6', `${id} 근거 ${ref.file} 가 [[${owner.fm.module}]] 소유이지만 의존에 없음`);
      // R8 같은 파일:라인을 두 모듈이 불변식 근거로 인용 — 중복 계약
      const key = `${ref.file}:${ref.line ?? ''}`;   // 줄번호 없는 인용은 파일 전체가 하나의 인용 지점이다
      const seen = evidenceIndex.get(key);
      if (seen && seen.mod !== m) report(lvl(m), slug, 'R8', `${id} 근거 ${key} 가 [[${seen.mod.fm.module}]] ${seen.id} 와 중복 — 깊은 소유자에 남기고 폐기 표시`);
      else if (!seen) evidenceIndex.set(key, { mod: m, id });
    }
  }
}

// ---------- R11 근거 파일 역추적 ----------
// 두 질문을 묻는다.
//  (1) 인용 줄 위쪽에 hunk 가 있나 — 인용이 다른 곳을 가리키게 됐다. MODULE.md 가 바뀌었든
//      말든 물어야 한다. 1번 세션에서 근거 파일이 밀리는 동안 같은 커밋이 다른 불변식 때문에
//      계약서를 건드렸고, 아래 (2) 의 조건 때문에 검사가 통째로 건너뛰어졌다
//  (2) 근거 파일이 변경됐는데 계약서가 그대로인가 — 소유 관계와 무관하게, 검증 수단이 모듈
//      밖(공용 테스트 디렉토리)에 있을 때 R1 의 사각지대를 덮는다
for (const m of modules) {
  const slug = m.fm.module ?? m.file;
  const docChanged = changedSet.has(m.file);
  // 계약서를 이번에 고쳤다면 base 판본의 인용과 대조한다. 인용 줄을 같이 옮겼으면 사람이
  // 이미 밀림을 본 것이므로 (1) 을 묻지 않는다 — 물어도 고칠 길이 없다
  let baseSpecs = null;   // null = 계약서 미변경, 모든 인용이 base 좌표다
  if (docChanged) {
    const prev = baseText(m.file);
    if (!prev) continue;  // 새 계약서 — 대조할 판본이 없고 인용은 현재 좌표다
    const pm = parseModule(m.file, prev);
    baseSpecs = new Set();
    for (const inv of pm.invariants) {
      if (/\(폐기/.test(inv)) continue;
      const id = inv.match(/^- (I\d+)\./)[1];
      const evidence = inv.match(/근거:\s*([^)]*)\)/)?.[1] ?? '';
      for (const ref of evidenceRefs(pm, evidence)) baseSpecs.add(`${id}|${ref.file}|${ref.spec}`);
    }
  }
  const hit = new Map(); // file → [id]
  for (const inv of m.invariants) {
    if (/\(폐기/.test(inv)) continue;
    const id = inv.match(/^- (I\d+)\./)[1];
    const evidence = inv.match(/근거:\s*([^)]*)\)/)?.[1] ?? '';
    for (const ref of evidenceRefs(m, evidence)) {
      if (!changedSet.has(ref.file)) continue;
      // (1) 줄 밀림. 줄번호 없는 인용은 줄에 대해 아무 주장도 하지 않으므로 제외한다
      if (ref.spec && (baseSpecs === null || baseSpecs.has(`${id}|${ref.file}|${ref.spec}`))) {
        const moved = ref.spec.match(/\d+/g).map(Number)
          .map((n) => [n, shiftAbove(ref.file, n)]).filter(([, s]) => s !== 0);
        if (moved.length)
          report(lvl(m), slug, 'R11', `${id} 근거 ${ref.file}:${ref.spec} 의 인용 줄 위쪽이 바뀌었다 — ${moved.map(([n, s]) => `${n}→${n + s}`).join(', ')} 인지 확인`);
      }
      // (2) 계약서 미변경 + 소유 밖
      if (docChanged || ownerOf(ref.file) === m) continue; // 소유 안은 R1 이 이미 본다
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
      // "근거:" 가 있는 줄에서 경로 토큰 하나를 통째로 치환. 앞뒤 경계를 막지 않으면
      // 짧은 경로가 이미 정정된 긴 경로의 꼬리를 다시 먹는다 (p 는 resolved 의 접미사다)
      const token = new RegExp(`(^|[^\\w.\\-/])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.\\-/])`, 'g');
      text = text.split('\n').map((line) => {
        if (!/근거:/.test(line)) return line;
        const before = line;
        line = line.replace(token, (_, pre) => `${pre}${resolved}`);
        if (line !== before) n++;
        return line;
      }).join('\n');
    }
    writeFileSync(join(root, file), text);
    // --json 과 함께 쓰면 stdout 은 JSON 만 담아야 한다. 정정 알림은 판정이 아니므로 stderr 로 보낸다
    (json ? console.error : console.log)(`FIX  ${file}  근거 경로 ${n}곳 정정`);
  }
  (json ? console.error : console.log)('\n정정 후 이력에 한 줄 추가하고 다시 실행하세요 (계약 문장은 바뀌지 않았습니다).');
}

// ---------- 출력 ----------
// --json 은 같은 판정을 다른 표면으로 낼 뿐이다. 종료 코드가 유일한 차단 수단이라는 I2 도,
// 판단을 파일에 쓰지 않는다는 I5 도 그대로다 — stdout 전용이고 `--out` 같은 옵션은 두지 않는다.
// message 는 사람에게 가는 한국어 문장이고 계속 바뀐다: 부르는 쪽은 rule·module 로만 분기한다
const fails = results.filter((r) => r.level === 'FAIL').length;
if (json) {
  process.stdout.write(JSON.stringify({
    schema: 1, mode, modules: modules.length, changed: changed.length,
    results: results.map((r) => ({ level: r.level, module: r.mod, rule: r.rule, message: r.msg })),
    fail: fails, warn: results.length - fails,
  }) + '\n');
  process.exit(fails ? 1 : 0);
}
if (!results.length) { console.log(`module-gate: OK (${modules.length} modules, ${changed.length} changed files)`); process.exit(0); }
for (const r of results) console.log(`${r.level.padEnd(4)} ${r.mod.padEnd(24)} ${r.rule}  ${r.msg}`);
console.log(`\nmodule-gate: ${fails} FAIL, ${results.length - fails} WARN`);
process.exit(fails ? 1 : 0);
