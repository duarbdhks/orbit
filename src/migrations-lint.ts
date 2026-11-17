const RULES: [RegExp, string][] = [
  [/\bDROP\b/i, "DROP 은 구버전 코드를 깨뜨린다"],
  [/\bRENAME\b/i, "RENAME 은 구버전 코드를 깨뜨린다"],
  [/\bALTER\s+(COLUMN\s+\S+\s+)?(SET\s+DATA\s+)?TYPE\b/i, "ALTER TYPE 은 구버전 코드를 깨뜨린다"],
  [/\bCONCURRENTLY\b/i, "CONCURRENTLY 는 트랜잭션 안에서 실행할 수 없다"],
];

/** 마이그레이션이 추가만 하는지, 트랜잭션 하나로 돌 수 있는지 검사한다. 위반 문구 목록을 돌려준다. */
export function lintMigration(sql: string): string[] {
  const code = sql.replace(/--.*$/gm, "");
  const problems = RULES.filter(([pattern]) => pattern.test(code)).map(([, message]) => message);
  for (const add of code.match(/\bADD\s+COLUMN\b[^,;]*/gi) ?? []) {
    if (/\bNOT\s+NULL\b/i.test(add) && !/\bDEFAULT\b/i.test(add))
      problems.push("기본값 없는 ADD COLUMN ... NOT NULL 은 구버전 코드의 INSERT 를 깨뜨린다");
  }
  return problems;
}
