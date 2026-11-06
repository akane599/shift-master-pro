import type { ScheduleConfig, ScheduleResult, Shift, Staff, StaffAssignment } from '@/types/schedule';
import {
  availableDays,
  getMonthDays,
  LONG_SHIFT,
  longShiftCount,
  notTogetherRelation,
  planStaff,
  workShare,
  type MonthContext,
  type StaffPlan,
} from './scheduleRules';
import { evaluateSchedule } from './scheduleStats';

/*
 * How generation works
 *
 * 1. Hours → shift counts. A target of H hours (a multiple of 8) is hit exactly by any shift count n with
 *    ceil(H/24) ≤ n ≤ floor(H/16): use (H − 16n)/8 shifts of 24h and the rest 16h. So each person gets a
 *    window of allowed shift counts (see planStaff), capped by how many shifts their available days allow
 *    under the post-shift rest rule.
 * 2. Days. Simulated annealing decides who works which day. Never violated (moves are rejected):
 *    availability, the rest rule (no two days in a row, including the last day of the previous month via
 *    `workedPreviousDay`), strict "not together", the per-person maximum shift count. Penalised: being under the minimum shift count, days below minStaffPerShift, missing
 *    together partners, soft "not together" pairs, and extra people above the minimum.
 * 3. Durations. Each person's 24h/16h split is fixed by their shift count; which days get the 24h shifts is
 *    chosen to spread 24h shifts evenly across the month.
 * 4. Real workload (see workShare). Days with more people on duty are lighter for each of them, so a second
 *    annealing pass trades days between two people with the same shift length until everyone's real workload
 *    is in proportion to their hours. A trade changes no day's head count or 24h count and nobody's hours, so
 *    steps 1–3 stay intact; it is checked against the same hard rules, and preferences still count. People
 *    with a strict "together" partner are left out, since a trade would split the pair.
 */

export interface GenerateOptions extends MonthContext {
  /** Fixed seed for reproducible output. Without it every run gives a different valid schedule. */
  seed?: number;
}

const WEIGHT = {
  missingShift: 1000, // per shift a person is below the count their hour target needs
  missingStaff: 300, // per missing person on a day below minStaffPerShift
  strictTogether: 60, // per shift where a "%100 Zorunlu" together partner is absent
  softNotTogether: 8, // per shift shared by a soft "not together" pair
  softTogether: 3, // per shift where an "Optimize" together partner is absent
  extraStaff: 1, // × (people above the minimum)² per day: spreads extras evenly, favours fewer/longer shifts
  // Step 4 only: × (hours off a fair share of the real workload)², summed over staff. Outweighs the soft
  // preferences; strict "together" pairs are never traded in step 4 at all.
  workload: 3,
};

const RESTARTS = 3;
const START_TEMPERATURE = 30;
const END_TEMPERATURE = 0.2;
const BALANCE_START_TEMPERATURE = 3;
const BALANCE_END_TEMPERATURE = 0.05;

interface Partner {
  other: number;
  weight: number;
}

/** [staff index, day index, should end up working] */
type Flip = [number, number, boolean];

class Roster {
  readonly on: Uint8Array;
  readonly perDay: Int32Array;
  readonly perStaff: Int32Array;
  cost: number;

  constructor(
    readonly staffCount: number,
    readonly dayCount: number,
    private readonly minPerDay: number,
    private readonly available: Uint8Array,
    readonly plans: StaffPlan[],
    private readonly strictApart: number[][],
    private readonly softApart: number[][],
    /** wants[p]: people p wants on p's shifts */
    private readonly wants: Partner[][],
    /** wantedBy[p]: people who want p on their shifts */
    private readonly wantedBy: Partner[][]
  ) {
    this.on = new Uint8Array(staffCount * dayCount);
    this.perDay = new Int32Array(dayCount);
    this.perStaff = new Int32Array(staffCount);
    // Cost of the empty roster; every toggle updates it incrementally.
    this.cost =
      WEIGHT.missingStaff * minPerDay * dayCount +
      plans.reduce((sum, plan) => sum + WEIGHT.missingShift * plan.minShifts, 0);
  }

  has(p: number, d: number): boolean {
    return d >= 0 && d < this.dayCount && this.on[p * this.dayCount + d] === 1;
  }

  canAdd(p: number, d: number): boolean {
    const i = p * this.dayCount + d;
    if (this.on[i] || !this.available[i]) return false;
    if (this.perStaff[p] >= this.plans[p].maxShifts) return false;
    if (this.has(p, d - 1) || this.has(p, d + 1)) return false;
    for (const q of this.strictApart[p]) if (this.on[q * this.dayCount + d]) return false;
    return true;
  }

  /** Cost change if (p, d) were toggled. */
  delta(p: number, d: number): number {
    const D = this.dayCount;
    const sign = this.on[p * D + d] ? -1 : 1;
    const M = this.minPerDay;
    const before = this.perDay[d];
    const after = before + sign;
    let delta =
      WEIGHT.missingStaff * (Math.max(0, M - after) - Math.max(0, M - before)) +
      WEIGHT.extraStaff * (Math.max(0, after - M) ** 2 - Math.max(0, before - M) ** 2);
    const min = this.plans[p].minShifts;
    const n = this.perStaff[p];
    delta += WEIGHT.missingShift * (Math.max(0, min - (n + sign)) - Math.max(0, min - n));
    for (const q of this.softApart[p]) if (this.on[q * D + d]) delta += sign * WEIGHT.softNotTogether;
    for (const { other, weight } of this.wants[p]) if (!this.on[other * D + d]) delta += sign * weight;
    for (const { other, weight } of this.wantedBy[p]) if (this.on[other * D + d]) delta -= sign * weight;
    return delta;
  }

  toggle(p: number, d: number): void {
    this.cost += this.delta(p, d);
    const i = p * this.dayCount + d;
    const sign = this.on[i] ? -1 : 1;
    this.on[i] = sign > 0 ? 1 : 0;
    this.perDay[d] += sign;
    this.perStaff[p] += sign;
  }

  /**
   * Applies all flips if each is legal, then keeps them per the Metropolis rule. Returns whether kept.
   * `extraCost`: cost change of the move outside the roster's own cost (step 4's workload term).
   */
  tryMove(flips: Flip[], temperature: number, rand: () => number, extraCost = 0): boolean {
    const start = this.cost;
    let applied = 0;
    for (const [p, d, add] of flips) {
      if (add ? !this.canAdd(p, d) : !this.has(p, d)) break;
      this.toggle(p, d);
      applied++;
    }
    if (applied === flips.length) {
      const delta = this.cost - start + extraCost;
      if (delta <= 0 || rand() < Math.exp(-delta / temperature)) return true;
    }
    for (let i = applied - 1; i >= 0; i--) this.toggle(flips[i][0], flips[i][1]);
    return false;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSchedule(staff: Staff[], config: ScheduleConfig, options: GenerateOptions = {}): ScheduleResult {
  const days = getMonthDays(config);
  const S = staff.length;
  const D = days.length;
  const minPerDay = Math.max(0, Math.floor(config.minStaffPerShift || 0));
  const rand = mulberry32(options.seed ?? Math.floor(Math.random() * 2 ** 32));
  const randInt = (n: number) => Math.floor(rand() * n);

  const context: MonthContext = { workedPreviousDay: options.workedPreviousDay };
  const plans = staff.map((s) => planStaff(s, config, days, context));
  const indexById = new Map(staff.map((s, i) => [s.id, i]));

  const available = new Uint8Array(S * D);
  staff.forEach((s, p) => availableDays(s, days, context).forEach((ok, d) => (available[p * D + d] = ok ? 1 : 0)));

  const strictApart: number[][] = staff.map(() => []);
  const softApart: number[][] = staff.map(() => []);
  for (let i = 0; i < S; i++) {
    for (let j = i + 1; j < S; j++) {
      const relation = notTogetherRelation(staff[i], staff[j]);
      const list = relation === 'strict' ? strictApart : relation === 'soft' ? softApart : null;
      list?.[i].push(j);
      list?.[j].push(i);
    }
  }

  const wants: Partner[][] = staff.map(() => []);
  const wantedBy: Partner[][] = staff.map(() => []);
  const strictGroup: Set<number>[] = staff.map(() => new Set());
  staff.forEach((s, p) => {
    for (const id of new Set(s.preferTogether ?? [])) {
      const q = indexById.get(id);
      if (q === undefined || q === p || strictApart[p].includes(q)) continue;
      const weight = s.preferTogetherStrict ? WEIGHT.strictTogether : WEIGHT.softTogether;
      wants[p].push({ other: q, weight });
      wantedBy[q].push({ other: p, weight });
      if (s.preferTogetherStrict) {
        strictGroup[p].add(q);
        strictGroup[q].add(p);
      }
    }
  });
  const groups = strictGroup.map((g) => [...g]);

  const newRoster = () =>
    new Roster(S, D, minPerDay, available, plans, strictApart, softApart, wants, wantedBy);

  const workingDay = (r: Roster, p: number): number => {
    if (!r.perStaff[p]) return -1;
    const start = randInt(D);
    for (let k = 0; k < D; k++) {
      const d = (start + k) % D;
      if (r.has(p, d)) return d;
    }
    return -1;
  };

  /** Greedy start: shift counts from each minimum upwards until days can be covered, least-flexible people first. */
  const seedRoster = (r: Roster) => {
    const counts = plans.map((plan) => plan.minShifts);
    let total = counts.reduce((a, b) => a + b, 0);
    while (total < D * minPerDay) {
      let pick = -1;
      let room = 0;
      counts.forEach((c, p) => {
        if (plans[p].maxShifts - c > room) {
          room = plans[p].maxShifts - c;
          pick = p;
        }
      });
      if (pick < 0) break;
      counts[pick]++;
      total++;
    }
    const order = staff
      .map((_, p) => ({ p, slack: plans[p].capacity - counts[p], tie: rand() }))
      .sort((a, b) => a.slack - b.slack || a.tie - b.tie)
      .map((o) => o.p);
    for (const p of order) {
      for (let k = 0; k < counts[p]; k++) {
        let best = -1;
        let bestScore = Infinity;
        for (let d = 0; d < D; d++) {
          if (!r.canAdd(p, d)) continue;
          const score = r.perDay[d] + rand() * 0.5;
          if (score < bestScore) {
            bestScore = score;
            best = d;
          }
        }
        if (best < 0) break;
        r.toggle(p, best);
      }
    }
  };

  const anneal = (r: Roster): Uint8Array => {
    let best = r.on.slice();
    let bestCost = r.cost;
    const iterations = Math.min(200_000, 20_000 + S * D * 150);
    const cooling = END_TEMPERATURE / START_TEMPERATURE;
    for (let it = 0; it < iterations; it++) {
      const temperature = START_TEMPERATURE * cooling ** (it / iterations);
      const roll = rand();
      const p = randInt(S);
      let flips: Flip[] | null = null;
      if (roll < 0.45) {
        // Move one of p's shifts to another day.
        const d = workingDay(r, p);
        const to = randInt(D);
        if (d >= 0 && to !== d) flips = [[p, d, false], [p, to, true]];
      } else if (roll < 0.6) {
        // Extra shift (only within p's allowed shift-count window).
        flips = [[p, randInt(D), true]];
      } else if (roll < 0.75) {
        // Drop a shift (only while p stays at or above their minimum).
        const d = r.perStaff[p] > plans[p].minShifts ? workingDay(r, p) : -1;
        if (d >= 0) flips = [[p, d, false]];
      } else if (roll < 0.93) {
        // Two people trade a day each.
        const q = randInt(S);
        const d = workingDay(r, p);
        const e = q !== p ? workingDay(r, q) : -1;
        if (d >= 0 && e >= 0 && d !== e) flips = [[p, d, false], [q, e, false], [p, e, true], [q, d, true]];
      } else if (groups[p].length) {
        // Move p together with strict together-partners who share that day.
        const d = workingDay(r, p);
        const to = randInt(D);
        if (d >= 0 && to !== d) {
          const members = [p, ...groups[p].filter((q) => r.has(q, d) && !r.has(q, to))];
          flips = [...members.map((m): Flip => [m, d, false]), ...members.map((m): Flip => [m, to, true])];
        }
      }
      if (flips && r.tryMove(flips, temperature, rand) && r.cost < bestCost) {
        bestCost = r.cost;
        best = r.on.slice();
      }
    }
    return best;
  };

  let bestOn: Uint8Array | null = null;
  let bestCost = Infinity;
  if (S > 0 && D > 0) {
    for (let run = 0; run < RESTARTS; run++) {
      const r = newRoster();
      seedRoster(r);
      const on = anneal(r);
      const final = newRoster();
      on.forEach((v, i) => v && final.toggle(Math.floor(i / D), i % D));
      if (final.cost < bestCost) {
        bestCost = final.cost;
        bestOn = on;
      }
    }
  }

  // Durations: the 24h/16h split per person is fixed by their shift count; spread the 24h shifts across days.
  const duration = new Uint8Array(S * D);
  if (bestOn) {
    const perDay = new Int32Array(D);
    const workDays = staff.map((_, p) => {
      const list: number[] = [];
      for (let d = 0; d < D; d++) if (bestOn[p * D + d]) list.push(d);
      list.forEach((d) => perDay[d]++);
      return list;
    });
    const longCount = workDays.map((list, p) => longShiftCount(plans[p].plannedHours, list.length));
    const hasChoice = (p: number) => longCount[p] > 0 && longCount[p] < workDays[p].length;
    const longPerDay = new Int32Array(D);
    const order = staff
      .map((_, p) => ({ p, key: (hasChoice(p) ? 1 : 0) + rand() * 0.5 }))
      .sort((a, b) => a.key - b.key)
      .map((o) => o.p);
    for (const p of order) {
      const ranked = workDays[p]
        .map((d) => ({ d, key: longPerDay[d] * 100 + perDay[d] + rand() }))
        .sort((a, b) => a.key - b.key);
      ranked.forEach(({ d }, k) => {
        const hours = k < longCount[p] ? 24 : 16;
        duration[p * D + d] = hours;
        if (hours === 24) longPerDay[d]++;
      });
    }
  }

  /** Step 4: trades days between people with the same shift length. Returns the best durations found (0 = off). */
  const balanceWorkload = (on: Uint8Array, start: Uint8Array): Uint8Array => {
    const r = newRoster();
    on.forEach((v, i) => v && r.toggle(Math.floor(i / D), i % D));
    const length = start.slice();
    // Head count and 24h count per day never change in this step, so neither does a shift's share of its day.
    const night = new Int32Array(D);
    for (let i = 0; i < S * D; i++) if (length[i] === LONG_SHIFT) night[i % D]++;
    const shareOn = (hours: number, d: number) => workShare(hours, r.perDay[d], night[d]);
    const hours = new Float64Array(S);
    const load = new Float64Array(S);
    for (let i = 0; i < S * D; i++) {
      if (!length[i]) continue;
      hours[Math.floor(i / D)] += length[i];
      load[Math.floor(i / D)] += shareOn(length[i], i % D);
    }
    const working = hours.filter((h) => h > 0);
    if (working.length < 2) return length;
    const meanHours = working.reduce((a, b) => a + b, 0) / working.length;
    // The month's total work is fixed, so Σ load²/hours is smallest when load/hours is the same for everyone.
    // Scaled by the mean hours, one unit is about one hour² off a fair share.
    const spread = (p: number, l: number) => (hours[p] ? (meanHours * l * l) / hours[p] : 0);

    let cost = r.cost + WEIGHT.workload * Array.from(load, (l, p) => spread(p, l)).reduce((a, b) => a + b, 0);
    let bestCost = cost;
    let best = length.slice();
    const iterations = Math.min(100_000, 10_000 + S * D * 40);
    const cooling = BALANCE_END_TEMPERATURE / BALANCE_START_TEMPERATURE;
    for (let it = 0; it < iterations; it++) {
      const p = randInt(S);
      const q = randInt(S);
      // People with a strict "together" partner keep their days: trading one of them alone splits the pair.
      if (groups[p].length || groups[q].length) continue;
      const d = workingDay(r, p);
      const e = p !== q ? workingDay(r, q) : -1;
      if (d < 0 || e < 0 || d === e || r.has(p, e) || r.has(q, d)) continue;
      const x = length[p * D + d];
      if (length[q * D + e] !== x) continue;
      // p moves from day d to e, q from e to d, both keeping shift length x.
      const change = shareOn(x, e) - shareOn(x, d);
      const extra =
        WEIGHT.workload *
        (spread(p, load[p] + change) - spread(p, load[p]) + spread(q, load[q] - change) - spread(q, load[q]));
      const before = r.cost;
      const temperature = BALANCE_START_TEMPERATURE * cooling ** (it / iterations);
      if (!r.tryMove([[p, d, false], [q, e, false], [p, e, true], [q, d, true]], temperature, rand, extra)) continue;
      cost += r.cost - before + extra;
      load[p] += change;
      load[q] -= change;
      length[p * D + d] = 0;
      length[q * D + e] = 0;
      length[p * D + e] = x;
      length[q * D + d] = x;
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = length.slice();
      }
    }
    return best;
  };

  const finalDuration = bestOn ? balanceWorkload(bestOn, duration) : duration;

  const shifts: Shift[] = [];
  days.forEach((date, d) => {
    const assignments: StaffAssignment[] = [];
    staff.forEach((s, p) => {
      const hours = finalDuration[p * D + d];
      if (hours) assignments.push({ staffId: s.id, duration: hours as 16 | 24 });
    });
    if (assignments.length) shifts.push({ date, assignments });
  });

  return { shifts, ...evaluateSchedule(staff, shifts, config, context) };
}
