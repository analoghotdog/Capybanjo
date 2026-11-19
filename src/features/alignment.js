// Onset alignment (pure logic: no DOM, no Web Audio; standard ES module).

/**
 * Align detected onset times to expected note times.
 *
 * Algorithm: dynamic programming over prefixes of the two sequences.
 * dp[i][j] is the minimal total cost of aligning the first i expected notes
 * with the first j detections. Three transitions are allowed:
 *   - match expected i-1 with detected j-1, cost = |deviationMs| (only if the
 *     deviation is within toleranceMs);
 *   - leave expected i-1 unmatched ("missed"), cost = toleranceMs;
 *   - leave detected j-1 unmatched ("extra"), cost = toleranceMs.
 * Setting the miss/extra penalty equal to the tolerance means any in-tolerance
 * pairing is preferred over dropping both, while out-of-tolerance pairings are
 * forbidden outright. Ties prefer a match over a miss, and a miss over an
 * extra. The DP is monotone (matches never cross) so near-swapped detections
 * resolve to the nearest non-crossing assignment. This is the "DP" option of
 * the build plan rather than nearest-first greedy, because it optimises the
 * whole assignment instead of each pair locally.
 *
 * @param {number[]} detectedTimes onset times in seconds
 * @param {number[]} expectedTimes expected note times in seconds
 * @param {{ toleranceMs?: number }} [options]
 * @returns {{ matches: Array<{expectedIndex: number, detectedIndex: number, deviationMs: number}>,
 *             missed: number[], extra: number[] }}
 *   matches sorted by expectedIndex; deviationMs = (detected - expected) * 1000
 *   (early notes are negative). missed: expected indices with no match;
 *   extra: detected indices with no match.
 */
export function alignOnsets(detectedTimes, expectedTimes, options = {}) {
  const toleranceMs = options.toleranceMs == null ? 250 : options.toleranceMs;
  const det = Array.isArray(detectedTimes) ? detectedTimes : [];
  const exp = Array.isArray(expectedTimes) ? expectedTimes : [];
  const n = exp.length;
  const m = det.length;

  const INF = Number.POSITIVE_INFINITY;
  const missPenalty = toleranceMs;
  const extraPenalty = toleranceMs;

  // dp[i][j] and back[i][j] ('match' | 'miss' | 'extra').
  const dp = [];
  const back = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array(m + 1).fill(INF));
    back.push(new Array(m + 1).fill(null));
  }
  dp[0][0] = 0;

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = INF;
      let from = null;
      if (i > 0 && j > 0) {
        const devMs = (det[j - 1] - exp[i - 1]) * 1000;
        if (Math.abs(devMs) <= toleranceMs) {
          const c = dp[i - 1][j - 1] + Math.abs(devMs);
          if (c < best) {
            best = c;
            from = 'match';
          }
        }
      }
      if (i > 0) {
        const c = dp[i - 1][j] + missPenalty;
        if (c < best) {
          best = c;
          from = 'miss';
        }
      }
      if (j > 0) {
        const c = dp[i][j - 1] + extraPenalty;
        if (c < best) {
          best = c;
          from = 'extra';
        }
      }
      dp[i][j] = best;
      back[i][j] = from;
    }
  }

  const matches = [];
  const missed = [];
  const extra = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = back[i][j];
    if (step === 'match') {
      const devMs = (det[j - 1] - exp[i - 1]) * 1000;
      matches.push({ expectedIndex: i - 1, detectedIndex: j - 1, deviationMs: devMs });
      i -= 1;
      j -= 1;
    } else if (step === 'miss') {
      missed.push(i - 1);
      i -= 1;
    } else {
      extra.push(j - 1);
      j -= 1;
    }
  }

  matches.sort((a, b) => a.expectedIndex - b.expectedIndex);
  missed.sort((a, b) => a - b);
  extra.sort((a, b) => a - b);
  return { matches, missed, extra };
}
