export type TransferArm = "experience" | "ablated";

export type TransferCase = {
  id: string;
  sourceClass: string;
  targetClass: string;
  goal: string;
};

export type TransferTrial = {
  caseId: string;
  trial: number;
  seed: number;
  arm: TransferArm;
  order: 0 | 1;
};

export type TransferObservation = TransferTrial & {
  success: boolean;
  score: number;
  tokens?: number;
  elapsedMs?: number;
};

export type TransferEffect = {
  pairs: number;
  meanScoreLift: number;
  successRateExperience: number;
  successRateAblated: number;
  successRateLift: number;
  experienceWins: number;
  ablatedWins: number;
  ties: number;
  signTestPValue: number;
  verdict: "positive" | "negative" | "inconclusive" | "invalid";
  warnings: string[];
};

export interface TransferTrialRunner {
  run(testCase: TransferCase, trial: TransferTrial): Promise<Omit<TransferObservation, keyof TransferTrial>>;
}

/**
 * Builds paired trials with deterministic, alternating arm order. Each pair
 * must start from the same external baseline; order is balanced to reduce
 * warm-cache and temporal bias.
 */
export function buildTransferTrials(
  cases: TransferCase[],
  repeats: number,
  seed = 1,
): TransferTrial[] {
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error("repeats must be a positive integer");
  const trials: TransferTrial[] = [];
  for (const testCase of cases) {
    if (testCase.sourceClass === testCase.targetClass) {
      throw new Error(`transfer case ${testCase.id} must cross task classes`);
    }
    for (let trial = 0; trial < repeats; trial++) {
      const experienceFirst = seededBit(`${seed}:${testCase.id}:${trial}`) === 0;
      const first: TransferArm = experienceFirst ? "experience" : "ablated";
      const second: TransferArm = experienceFirst ? "ablated" : "experience";
      trials.push({ caseId: testCase.id, trial, seed: seed + trial, arm: first, order: 0 });
      trials.push({ caseId: testCase.id, trial, seed: seed + trial, arm: second, order: 1 });
    }
  }
  return trials;
}

export async function runTransferExperiment(input: {
  cases: TransferCase[];
  repeats: number;
  seed?: number;
  runner: TransferTrialRunner;
}): Promise<{ observations: TransferObservation[]; effect: TransferEffect }> {
  const byId = new Map(input.cases.map((testCase) => [testCase.id, testCase]));
  const observations: TransferObservation[] = [];
  for (const trial of buildTransferTrials(input.cases, input.repeats, input.seed)) {
    const testCase = byId.get(trial.caseId);
    if (!testCase) throw new Error(`transfer case not found: ${trial.caseId}`);
    const result = await input.runner.run(testCase, trial);
    observations.push({
      ...trial,
      ...result,
      score: clampScore(result.score),
    });
  }
  return { observations, effect: estimateTransferEffect(observations) };
}

/**
 * Paired average treatment effect of recalled experience versus an ablated
 * control. This is causal evidence only when both arms use the same model,
 * task fixture, seed, budgets, and isolated baseline.
 */
export function estimateTransferEffect(observations: TransferObservation[]): TransferEffect {
  const grouped = new Map<string, Partial<Record<TransferArm, TransferObservation>>>();
  for (const observation of observations) {
    const key = `${observation.caseId}:${observation.trial}:${observation.seed}`;
    const pair = grouped.get(key) ?? {};
    pair[observation.arm] = observation;
    grouped.set(key, pair);
  }

  const complete = [...grouped.values()].filter(
    (pair): pair is Record<TransferArm, TransferObservation> => Boolean(pair.experience && pair.ablated),
  );
  const warnings: string[] = [];
  if (complete.length * 2 !== observations.length) warnings.push("incomplete or duplicate pairs excluded");
  if (complete.length < 5) warnings.push("fewer than 5 paired trials");
  if (!complete.length) return emptyEffect(warnings);

  let scoreLift = 0;
  let experienceSuccess = 0;
  let ablatedSuccess = 0;
  let experienceWins = 0;
  let ablatedWins = 0;
  let ties = 0;

  for (const pair of complete) {
    scoreLift += pair.experience.score - pair.ablated.score;
    experienceSuccess += Number(pair.experience.success);
    ablatedSuccess += Number(pair.ablated.success);
    if (pair.experience.score > pair.ablated.score) experienceWins += 1;
    else if (pair.experience.score < pair.ablated.score) ablatedWins += 1;
    else ties += 1;
  }

  const pairs = complete.length;
  const meanScoreLift = scoreLift / pairs;
  const successRateExperience = experienceSuccess / pairs;
  const successRateAblated = ablatedSuccess / pairs;
  const signTestPValue = twoSidedSignTest(experienceWins, ablatedWins);
  let verdict: TransferEffect["verdict"] = "inconclusive";
  if (pairs >= 5 && signTestPValue <= 0.05 && meanScoreLift > 0) verdict = "positive";
  if (pairs >= 5 && signTestPValue <= 0.05 && meanScoreLift < 0) verdict = "negative";

  return {
    pairs,
    meanScoreLift,
    successRateExperience,
    successRateAblated,
    successRateLift: successRateExperience - successRateAblated,
    experienceWins,
    ablatedWins,
    ties,
    signTestPValue,
    verdict,
    warnings,
  };
}

function emptyEffect(warnings: string[]): TransferEffect {
  return {
    pairs: 0,
    meanScoreLift: 0,
    successRateExperience: 0,
    successRateAblated: 0,
    successRateLift: 0,
    experienceWins: 0,
    ablatedWins: 0,
    ties: 0,
    signTestPValue: 1,
    verdict: "invalid",
    warnings,
  };
}

function twoSidedSignTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  const extreme = Math.min(wins, losses);
  let lowerTail = 0;
  for (let k = 0; k <= extreme; k++) lowerTail += binomialCoefficient(n, k) * 0.5 ** n;
  return Math.min(1, 2 * lowerTail);
}

function binomialCoefficient(n: number, k: number): number {
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - k + i)) / i;
  return value;
}

function seededBit(value: string): 0 | 1 {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 as 0 | 1;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) throw new Error("transfer score must be finite");
  return Math.max(0, Math.min(1, score));
}
