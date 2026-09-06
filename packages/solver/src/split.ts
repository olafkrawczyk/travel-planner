import type { Place } from "@app/domain";
import { parseHHMM } from "@app/domain";
import { type Problem } from "./matrix";

export interface SplitResult {
  /** One segment (ordered place ids, possibly empty) per day, in day order. */
  segments: string[][];
  /**
   * Total DP cost of this split: the sum, across all days, of each day's
   * segment cost (travel + dwell + return-to-base, plus the heavy but finite
   * penalties for time-budget overruns and appointment violations). Lower is
   * better; callers compare `cost` across tour rotations/reversals to pick
   * the best split (see `solve.ts`).
   */
  cost: number;
}

const APPT_PENALTY = 1e9;
const OVERRUN_PENALTY = 1e7;

/**
 * Prins split DP: cut the giant tour into |days| consecutive segments.
 * Segment cost = baseStart -> segment -> baseEnd incl. dwell and travel.
 * Time-budget overruns and appointment violations are heavily penalised (but
 * finite) so the DP always yields a full partition; violations are later
 * reported as unscheduled by day sequencing.
 */
export function split(problem: Problem, tour: string[]): SplitResult {
  const days = problem.dayList;
  const D = days.length;
  const N = tour.length;

  const placeOf = new Map<string, Place>();
  for (const p of problem.places) placeOf.set(p.id, p);

  // segCost[d][i][j] = cost of day d taking tour[i..j-1].
  const segCost: number[][][] = [];
  for (let d = 0; d < D; d++) {
    const day = days[d]!;
    const dayStart = parseHHMM(day.start);
    const dayEnd = parseHHMM(day.end);
    const startNode = day.startLocation === "base" ? day.baseStartId : day.startLocation;
    const endNode = day.endLocation === "base" ? day.baseEndId : day.endLocation;

    const grid: number[][] = [];
    for (let i = 0; i <= N; i++) {
      grid.push(new Array(N + 1).fill(Number.POSITIVE_INFINITY));
      let travel = 0;
      let dwell = 0;
      let prev = startNode;
      let t = dayStart;
      let apptMissed = false;
      let wrongDayAppts = 0;
      for (let j = i; j <= N; j++) {
        if (j > i) {
          const p = placeOf.get(tour[j - 1]!)!;
          const m = problem.matrix.minutes(prev, tour[j - 1]!);
          travel += m;
          t += m;
          if (p.appointment) {
            if (p.appointment.dayId !== day.id) {
              wrongDayAppts++;
            } else {
              const appt = parseHHMM(p.appointment.start);
              if (t > appt) apptMissed = true; // window violated; later arrivals only worsen
              else if (t < appt) t = appt; // wait until the window
            }
          }
          dwell += p.dwellMin;
          t += p.dwellMin;
          prev = tour[j - 1]!;
          const back = problem.matrix.minutes(prev, endNode);
          const endMin = t + back;
          const overrun = Math.max(0, endMin - dayEnd);
          grid[i]![j] =
            travel +
            dwell +
            back +
            overrun * OVERRUN_PENALTY +
            (apptMissed ? APPT_PENALTY : 0) +
            wrongDayAppts * APPT_PENALTY;
        } else {
          grid[i]![j] = 0; // empty segment
        }
      }
    }
    segCost.push(grid);
  }

  // DP: dp[d][j] = min cost of covering tour[0..j-1] with days 0..d-1.
  const dp: number[][] = [];
  const back: number[][] = [];
  for (let d = 0; d <= D; d++) {
    dp.push(new Array(N + 1).fill(Number.POSITIVE_INFINITY));
    back.push(new Array(N + 1).fill(-1));
  }
  dp[0]![0] = 0;
  for (let d = 0; d < D; d++) {
    for (let j = 0; j <= N; j++) {
      if (!Number.isFinite(dp[d]![j]!)) continue;
      // Day d empty (k = j) or takes tour[j..k-1].
      for (let k = j; k <= N; k++) {
        const cost = segCost[d]![j]![k]!;
        if (!Number.isFinite(cost)) continue;
        const total = dp[d]![j]! + cost;
        // `<=` so ties favour the largest j (earlier days fill first) — keeps
        // the initial assignment balanced instead of dumping everything on
        // the last day.
        if (total <= dp[d + 1]![k]!) {
          dp[d + 1]![k] = total;
          back[d + 1]![k] = j;
        }
      }
    }
  }

  // Reconstruct cut points (always complete: every segment cost is finite).
  const cuts: number[] = new Array(D + 1);
  let pos = N;
  for (let d = D; d >= 1; d--) {
    cuts[d] = pos;
    pos = back[d]![pos]!;
    if (pos < 0) pos = 0; // defensive; unreachable with finite segCost
  }
  cuts[0] = 0;

  const segments: string[][] = [];
  for (let d = 0; d < D; d++) {
    segments.push(tour.slice(cuts[d]!, cuts[d + 1]!));
  }
  return { segments, cost: dp[D]![N]! };
}
