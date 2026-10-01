import type { Cell, Clue } from "./types.ts";
import { BLACK, UNKNOWN, WHITE } from "./types.ts";
import { minLineLength } from "./validate.ts";

/** 排列数上的封顶：超过此值一律按 CAP 计，仅用于提示中的“至少/很多”表述。 */
const CAP = 1_000_000_000;

function addCap(a: number, b: number): number {
  const s = a + b;
  return s > CAP ? CAP : s;
}

export interface LineAnalysis {
  /** 该线在给定已知格下是否存在至少一种合法摆放。 */
  feasible: boolean;
  /** 合法摆放总数（封顶 CAP）。 */
  total: number;
  /** 推断后的线状态（长度等于线长），仅在能确定时改为黑/白。 */
  resolved: Cell[];
  /** 本次新确定的格子在线上的位置及确定值。 */
  forced: { pos: number; v: Cell; blackWays: number; whiteWays: number }[];
}

/**
 * 对单条线（行或列）做“线性求解”：
 * 枚举所有满足线索且与已知格相容的摆放，逐格判断该格能否为黑/白。
 *
 * 算法是块放置 DP（前缀/后缀可行性 + 计数），时间 O(k * n)，
 * 不依赖任何外部数织或通用约束求解库。
 */
export function analyzeLine(clue: Clue, line: readonly Cell[]): LineAnalysis {
  const n = line.length;
  const k = clue.length;
  const resolved: Cell[] = line.slice() as Cell[];

  // 空线索：唯一合法情况是整线全白。
  if (k === 0) {
    const feasible = line.every((c) => c !== BLACK);
    const forced: LineAnalysis["forced"] = [];
    if (feasible) {
      for (let p = 0; p < n; p++) {
        if (line[p] === UNKNOWN) {
          resolved[p] = WHITE;
          forced.push({ pos: p, v: WHITE, blackWays: 0, whiteWays: 1 });
        }
      }
    }
    return { feasible, total: feasible ? 1 : 0, resolved, forced };
  }

  if (minLineLength(clue) > n) {
    return { feasible: false, total: 0, resolved, forced: [] };
  }

  // canBlack[p] / canWhite[p]：已知格是否允许在 p 为黑/白。
  const canBlack = new Uint8Array(n);
  const canWhite = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    canBlack[p] = line[p] !== WHITE ? 1 : 0;
    canWhite[p] = line[p] !== BLACK ? 1 : 0;
  }

  const seg = clue;

  /*
   * pref[i][q]：仅使用前 i+1 个块（0..i），第 i 块占据 [q, q+len-1]，
   * 且前缀 [0, q-1] 全部合法（块 0..i-1 已放好、块前为白）的摆放数（封顶）。
   */
  const pref: number[][] = Array.from({ length: k }, () => new Array<number>(n).fill(0));
  for (let q = 0; q <= n - seg[0]!; q++) {
    let ok = true;
    for (let p = 0; p < q; p++) if (!canWhite[p]) { ok = false; break; }
    if (ok) {
      for (let p = q; p < q + seg[0]!; p++) if (!canBlack[p]) { ok = false; break; }
    }
    if (ok) pref[0]![q] = 1;
  }
  for (let i = 1; i < k; i++) {
    for (let q = 0; q <= n - seg[i]!; q++) {
      // 块占据 [q, q+len-1]
      let blockOk = true;
      for (let p = q; p < q + seg[i]!; p++) if (!canBlack[p]) { blockOk = false; break; }
      if (!blockOk) continue;
      let ways = 0;
      // 前一块 i-1 必须结束于 <= q-2，即起点 t 满足 t + seg[i-1] - 1 <= q-2。
      const maxT = q - seg[i - 1]! - 1;
      for (let t = 0; t <= maxT; t++) {
        if (pref[i - 1]![t] === 0) continue;
        // 间隔 [t+prevLen, q-1] 必须全白（含强制分隔位 q-1）。
        let gapOk = true;
        for (let p = t + seg[i - 1]!; p < q; p++) {
          if (!canWhite[p]) { gapOk = false; break; }
        }
        if (gapOk) ways = addCap(ways, pref[i - 1]![t]!);
      }
      pref[i]![q] = ways;
    }
  }

  /*
   * suff[i][q]：第 i 块占据 [q, q+len-1]，其后的所有块（i+1..k-1）能在
   * 后缀 [q+len, n-1] 中合法摆放（含分隔与末尾全白）的摆放数（封顶）。
   */
  const suff: number[][] = Array.from({ length: k }, () => new Array<number>(n).fill(0));
  for (let q = 0; q <= n - seg[k - 1]!; q++) {
    let ok = true;
    for (let p = q; p < q + seg[k - 1]!; p++) if (!canBlack[p]) { ok = false; break; }
    if (!ok) continue;
    for (let p = q + seg[k - 1]!; p < n; p++) if (!canWhite[p]) { ok = false; break; }
    if (ok) suff[k - 1]![q] = 1;
  }
  for (let i = k - 2; i >= 0; i--) {
    for (let q = 0; q <= n - seg[i]!; q++) {
      let blockOk = true;
      for (let p = q; p < q + seg[i]!; p++) if (!canBlack[p]) { blockOk = false; break; }
      if (!blockOk) continue;
      let ways = 0;
      const minT = q + seg[i]! + 1;
      for (let t = minT; t <= n - seg[i + 1]!; t++) {
        if (suff[i + 1]![t] === 0) continue;
        let gapOk = true;
        for (let p = q + seg[i]!; p < t; p++) {
          if (!canWhite[p]) { gapOk = false; break; }
        }
        if (gapOk) ways = addCap(ways, suff[i + 1]![t]!);
      }
      suff[i]![q] = ways;
    }
  }

  // 末块起点 q 已在 suff 计算中保证末尾全白；pref 末层即合法摆放。
  let total = 0;
  for (let q = 0; q < n; q++) {
    if (pref[k - 1]![q]! > 0 && suff[k - 1]![q]! > 0) {
      total = addCap(total, pref[k - 1]![q]!);
    }
  }

  if (total === 0) {
    return { feasible: false, total: 0, resolved, forced: [] };
  }

  // 逐格判断：
  // blackWays[p] = 覆盖位置 p 的合法摆放数（某块包含 p）。
  // whiteWays[p] = 不覆盖 p 的合法摆放数。
  const blackWays = new Array<number>(n).fill(0);
  for (let i = 0; i < k; i++) {
    for (let q = 0; q < n; q++) {
      const pv = pref[i]![q]!;
      const sv = suff[i]![q]!;
      if (pv === 0 || sv === 0) continue;
      const ways = mulCap(pv, sv);
      for (let p = q; p < q + seg[i]!; p++) {
        blackWays[p] = addCap(blackWays[p]!, ways);
      }
    }
  }

  const forced: LineAnalysis["forced"] = [];
  for (let p = 0; p < n; p++) {
    const bw = blackWays[p]!;
    // 白格摆放数无法简单用 total-bw（封顶），因此单独判定可行性：
    // 存在不覆盖 p 的摆放，当且仅当某个块起点方案使 p 落在块外，
    // 用“把 p 强制设为白后是否仍可行”的可行性（非计数）判断更稳妥。
    const whiteFeasible = existsArrangementAvoiding(seg, canBlack, canWhite, p);
    const blackFeasible = bw > 0;
    if (line[p] !== UNKNOWN) continue;
    if (blackFeasible && !whiteFeasible) {
      resolved[p] = BLACK;
      forced.push({ pos: p, v: BLACK, blackWays: bw, whiteWays: 0 });
    } else if (!blackFeasible && whiteFeasible) {
      resolved[p] = WHITE;
      forced.push({ pos: p, v: WHITE, blackWays: 0, whiteWays: CAP });
    }
  }

  return { feasible: true, total, resolved, forced };
}

function mulCap(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  if (a >= CAP || b >= CAP) return CAP;
  const p = a * b;
  return p > CAP ? CAP : p;
}

/** 是否存在一种合法摆放，使位置 avoid 落在黑段之外（即为白）。 */
function existsArrangementAvoiding(
  seg: number[],
  canBlack: Uint8Array,
  canWhite: Uint8Array,
  avoid: number,
): boolean {
  const n = canBlack.length;
  const k = seg.length;
  // dp[i][q]：第 i 块起点 q 时，是否存在前缀合法摆放，且不占用 avoid。
  const dp: Uint8Array[] = Array.from({ length: k }, () => new Uint8Array(n));
  for (let q = 0; q <= n - seg[0]!; q++) {
    if (q <= avoid && avoid < q + seg[0]!) continue; // 占用 avoid，非法
    let ok = true;
    for (let p = 0; p < q; p++) if (!canWhite[p]) { ok = false; break; }
    if (ok) for (let p = q; p < q + seg[0]!; p++) if (!canBlack[p]) { ok = false; break; }
    if (ok) dp[0]![q] = 1;
  }
  for (let i = 1; i < k; i++) {
    for (let q = 0; q <= n - seg[i]!; q++) {
      if (q <= avoid && avoid < q + seg[i]!) continue;
      let blockOk = true;
      for (let p = q; p < q + seg[i]!; p++) if (!canBlack[p]) { blockOk = false; break; }
      if (!blockOk) continue;
      const maxT = q - seg[i - 1]! - 1;
      for (let t = 0; t <= maxT; t++) {
        if (!dp[i - 1]![t]) continue;
        let gapOk = true;
        for (let p = t + seg[i - 1]!; p < q; p++) {
          if (!canWhite[p]) { gapOk = false; break; }
        }
        if (gapOk) { dp[i]![q] = 1; break; }
      }
    }
  }
  for (let q = 0; q < n; q++) {
    if (!dp[k - 1]![q]) continue;
    let tailOk = true;
    for (let p = q + seg[k - 1]!; p < n; p++) {
      if (p === avoid) continue; // avoid 必须为白，canWhite[avoid] 本应为 true
      if (!canWhite[p]) { tailOk = false; break; }
    }
    if (tailOk && canWhite[avoid]) return true;
  }
  return false;
}
