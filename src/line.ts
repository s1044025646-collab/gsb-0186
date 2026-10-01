import { BLACK, WHITE, Clues } from "./types";

/**
 * 生成一行的所有候选黑格位掩码(BigInt, bit i 表示位置 i 为黑)。
 * 空线索 [] 表示整行无黑格, 只有 1 个候选(全白)。
 */
export function generateCandidates(length: number, clues: Clues, cap: number): bigint[] {
  if (clues.length === 0) return [0n];
  const k = clues.length;
  const sum = clues.reduce((a, b) => a + b, 0);
  const minLen = sum + (k - 1);
  if (minLen > length) return [];
  const out: bigint[] = [];
  const starts = new Array<number>(k);
  const rec = (idx: number, pos: number) => {
    if (out.length >= cap) return;
    if (idx === k) {
      let mask = 0n;
      for (let j = 0; j < k; j++) {
        for (let t = 0; t < clues[j]; t++) mask |= 1n << BigInt(starts[j] + t);
      }
      out.push(mask);
      return;
    }
    // 剩余段的最小占用
    let restMin = 0;
    for (let j = idx; j < k; j++) restMin += clues[j];
    restMin += k - idx - 1;
    const maxStart = length - restMin;
    for (let s = pos; s <= maxStart; s++) {
      starts[idx] = s;
      rec(idx + 1, s + clues[idx] + 1);
      if (out.length >= cap) return;
    }
  };
  rec(0, 0);
  return out;
}

/**
 * 用已知格过滤候选。knownBlack/knownWhite 为该线的位掩码。
 */
export function filterCandidates(cands: bigint[], knownBlack: bigint, knownWhite: bigint): bigint[] {
  return cands.filter((m) => (m & knownBlack) === knownBlack && (m & knownWhite) === 0n);
}

/** 所有候选的按位与: 必然为黑的格 */
export function candidatesAnd(cands: bigint[]): bigint {
  let acc = cands[0];
  for (let i = 1; i < cands.length; i++) acc &= cands[i];
  return acc;
}

/** 所有候选的按位或: 可能为黑的格; 不在其中则必然为白 */
export function candidatesOr(cands: bigint[]): bigint {
  let acc = 0n;
  for (const m of cands) acc |= m;
  return acc;
}

export function cellToBit(value: number): bigint {
  return value === BLACK ? 1n : 0n;
}

export { BLACK, WHITE };
