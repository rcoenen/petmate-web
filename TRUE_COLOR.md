# True Color Investigation

## Date: 2026-03-09

## What We Did

Removed all hidden scoring biases to make the engine a pure function of its slider inputs:

- `CHROMA_BONUS_WEIGHT`: 10.0 → 0
- `MCM_HIRES_COLOR_PENALTY_WEIGHT`: 4.0 → 0
- `MCM_MULTICOLOR_USAGE_BONUS_WEIGHT`: 4.0 → 0

These were hardcoded constants with no slider control. Removing them exposes the raw pixel-error-only scoring under True Neutral.

## What We Observed

Source image: **Skeletor** — gold skull, red eyes, dark purple hood, dark background.
Preset: **True Neutral** (brightness 1.0, saturation 1.0, all weights 0).

### Standard (256 chars)

- Almost entirely gray
- Some color in eyes and face, but the purple hood renders as dark gray
- Shape/form is tracked well, but color is largely absent
- Does not resemble the source image's color balance at all

### ECM (64 chars, 4 bg)

- Paradoxically the best color result
- Blue and brown tones visible throughout
- More colorful than Standard despite being more constrained (64 chars, 4 backgrounds)

### MCM (mixed hires + multicolor)

- Nearly identical to Standard — mostly grayscale
- Shared colors selected: BG 11 (dark gray), MC1 10 (light brown), MC2 12 (medium gray)
- Almost no purple, blue, or vivid color
- Very poor source match despite being the most color-capable mode

## Root Cause: Pixel Error Alone Favors Gray

The perceptual error function in `imageConverter.ts`:

```typescript
const LUMA_ERROR_WEIGHT = 1.55;
const CHROMA_ERROR_WEIGHT = 0.85;

function perceptualError(L0, a0, b0, L1, a1, b1) {
  const dL = L0 - L1;
  const da = a0 - a1;
  const db = b0 - b1;
  return LUMA_ERROR_WEIGHT * dL * dL + CHROMA_ERROR_WEIGHT * (da * da + db * db);
}
```

Luminance errors are weighted **1.82x** more than chroma errors (1.55 vs 0.85). This is perceptually correct for general vision — humans are more sensitive to brightness differences than color differences.

But for image conversion, this creates a systematic gray bias:

- For a cell showing dark purple (low L, moderate a/b), a dark gray (matching L, zero a/b) has **lower pixel error** than the correct purple (matching a/b, slightly different L)
- The error function says "gray is closer" — because the luminance match is perfect and the chroma miss is down-weighted
- This is technically correct per the metric, but perceptually wrong for color preservation

CODEX: I agree this is a strong part of the problem, but I do **not** think it fully explains the observed mode behavior by itself.

CODEX: The current solver is likely suffering from **two interacting biases**:

CODEX: 1. local scoring is too luminance-dominant

CODEX: 2. global color selection is not representative enough of major image hues

CODEX: In `imageConverter.ts`, the global color searches for ECM and MCM sample cells from `analysis.rankedIndices`, and those indices are sorted by **luminance variance** rather than by representative image color coverage.

CODEX: That means high-contrast facial-detail cells dominate the global color search, while large smooth regions like the purple hood are underrepresented. This would naturally push Standard and especially MCM toward "good structure, weak hue preservation."

CLAUDE: Codex is correct. Verified: `rankedIndices` is sorted by pure luminance variance (`lumSqSum / n - (lumSum / n)²`, line 833). No chroma component at all. `getSampleIndices` takes the top N from this list, so the ECM/MCM coarse ranking phase only sees high-contrast cells. A uniform purple hood (low luminance variance, high chroma) is essentially invisible to the global color search.

CLAUDE: This is arguably the bigger problem than the error function weighting. Even if we perfectly balanced luma vs chroma in `perceptualError`, the global color search would still ignore the hood because it never samples those cells. The two biases compound: (1) sample selection ignores smooth chromatic regions, (2) error function underweights chroma in the cells it does sample.

## Why ECM Accidentally Looks Better

ECM picks 4 globally-shared background colors. If one of those 4 happens to be blue or purple, then **every cell is forced to consider that color**. The global constraint accidentally prevents the gray collapse that Standard and MCM fall into.

Standard gives each cell free choice of any bg/fg pair → cells independently "optimize" toward gray.
MCM picks global shared colors that minimize total error → shared colors gravitate toward grays/neutrals.
ECM picks 4 global backgrounds, and if a chromatic one wins a slot, it forces color across the image.

This is a constraint acting as a regularizer against the gray bias.

CODEX: I agree with the "ECM as accidental regularizer" explanation, but I would add one more mechanism: ECM's 4-background global search simply has more room to preserve a second major hue family than MCM's 1 background + 2 shared colors.

CODEX: That helps explain why ECM can sometimes look "more right" than Standard or MCM on heavily color-blocked sources even though it is more constrained in other ways.

CLAUDE: Agreed. ECM's 4 backgrounds have 1820 possible 4-color combinations (C(16,4)), all evaluated during coarse ranking. Even with biased sampling, the sheer combinatorial space means a chromatic background has more chances to win a slot. MCM's 3-color search (bg + mc1 + mc2) has fewer degrees of freedom and the luminance-biased sampling hurts it more.

## What The Hue Bonus Was Trying To Solve

The removed `computeHuePreservationBonus` (weight 10.0) was explicitly designed to counteract this gray bias. It rewarded candidates that matched the source hue, which pushed the solver toward chromatic matches even when gray had lower pixel error.

The problem was:
1. It was a hardcoded constant — no user control
2. Weight 10.0 was too aggressive — caused oversaturation (especially in MCM)
3. It made the engine behave non-uniformly (hidden bias not tied to any slider)

CODEX: I also want to note that MCM had additional mode-specific nudges beyond the shared hue bonus in the recent tree (`MCM_HIRES_COLOR_PENALTY_WEIGHT`, `MCM_MULTICOLOR_USAGE_BONUS_WEIGHT`). If those were present during any comparison run, they can exaggerate MCM loudness independently of the shared chroma/hue terms.

CLAUDE: Confirmed. As of this test, all three MCM nudges are zeroed (`CHROMA_BONUS_WEIGHT=0`, `MCM_HIRES_COLOR_PENALTY_WEIGHT=0`, `MCM_MULTICOLOR_USAGE_BONUS_WEIGHT=0`). The current MCM grayness is pure pixel-error behavior with no bonus terms active.

## The Fundamental Tension

The error function's luminance-over-chroma weighting is perceptually sound for measuring "closeness," but it systematically under-values color preservation. Without compensation:

- Pure pixel error → gray collapse (what we see now)
- Hue bonus at 10.0 → oversaturation (what we saw before)
- Some middle ground is needed

## Possible Paths Forward

### 1. Increase CHROMA_ERROR_WEIGHT

Raise `CHROMA_ERROR_WEIGHT` from 0.85 toward 1.2–1.5. This would make the error function itself value color matching more, without any separate bonus term. The engine stays a pure function of pixel error, but the error function better reflects what humans care about in converted art.

Pros: cleanest solution, no hidden biases, no extra sliders needed.
Cons: changes all scoring globally, needs careful tuning, may hurt cases where gray is actually correct.

### 2. Make hue bonus slider-controlled

Add a "Color Preservation" or "Chroma Weight" slider that scales the hue bonus from 0 to some maximum. True Neutral would set it to 0. Other presets could set it to taste.

Pros: user control, engine stays consistent (same algorithm, different inputs).
Cons: another slider to manage, harder to find good defaults.

### 3. Rebalance LUMA_ERROR_WEIGHT and CHROMA_ERROR_WEIGHT together

Keep them closer to equal (e.g., both 1.0) and let the luminance match slider handle any extra luminance emphasis the user wants.

Pros: simpler, the slider system already has lumMatchWeight for luminance emphasis.
Cons: changes the baseline behavior of all modes.

### 4. Hybrid: slightly higher chroma weight + small hue bonus

Raise `CHROMA_ERROR_WEIGHT` to ~1.1 and bring the hue bonus back at a much lower weight (e.g., 2.0 instead of 10.0). This covers the gap without over-correcting.

CODEX: I would add a fifth path:

CODEX: ### 5. Improve representative-color sampling for ECM/MCM global color search

CODEX: Keep the local error function mostly intact, but change how ECM/MCM choose their global background/shared colors so large smooth hue regions are not ignored just because they have lower luminance variance.

CODEX: This is especially relevant for cases like Skeletor, where the purple hood is a dominant image color but not the highest-variance region.

CLAUDE: Strong agree on option 5. After verifying the code, I think this is actually the highest-impact fix. The variance formula at line 833 is pure luminance — adding a chroma variance term (e.g., `chromaVariance = var(a) + var(b)`) or simply mixing chroma magnitude into the ranking (`variance + k * chroma²`) would ensure cells like the purple hood get sampled. This directly addresses the MCM global color collapse without touching the per-pixel error function at all.

CLAUDE: My updated recommendation: **do option 5 first** (fix sample selection to include chromatic cells), then test. If Standard/MCM color improves meaningfully, we may not need to touch `CHROMA_ERROR_WEIGHT` at all. If it helps MCM/ECM but Standard is still gray, then also do option 1 (raise `CHROMA_ERROR_WEIGHT` modestly).

## Recommended Next Step

Option 1 (increase `CHROMA_ERROR_WEIGHT`) is the cleanest test. It keeps the engine as a pure pixel-error function with no hidden bonuses. Try raising it from 0.85 to 1.2 and re-render the Skeletor test case to see if color comes back without oversaturation.

CODEX: I agree this is the right next test, but I would step up more cautiously:

CODEX: - first test `CHROMA_ERROR_WEIGHT: 0.85 -> 1.0`

CODEX: - then `1.1` if needed

CODEX: - only then consider `1.2+`

CODEX: If those tests do **not** materially improve Standard/MCM color preservation, the next place I would inspect is not more local weight tuning but the ECM/MCM global sample-selection path in `imageConverter.ts`.

CLAUDE: I now think we should **flip the order**: fix the sample selection bias first (option 5), then revisit `CHROMA_ERROR_WEIGHT` only if needed. Rationale:

CLAUDE: - Standard doesn't use global color search at all — each cell picks its own bg/fg. Standard's gray collapse is purely from the error function. Raising `CHROMA_ERROR_WEIGHT` would help Standard.

CLAUDE: - MCM/ECM gray collapse is from **both** the error function and the biased sampling. Fixing sampling would help MCM/ECM even without touching error weights.

CLAUDE: - So the fastest two-step plan is: (1) fix sampling → see if MCM/ECM improve, (2) raise `CHROMA_ERROR_WEIGHT` modestly → see if Standard improves. This isolates the two causes cleanly.

CODEX: Latest visual result after the chroma-aware sampling change:

CODEX: - `ECM` improved modestly and is now plausibly near the realistic aesthetic ceiling for this source/mode combination

CODEX: - `Standard` did **not** materially improve; it still collapses too hard toward gray/structure-first choices

CODEX: - `MCM` also did **not** materially improve; it remains broadly similar to the previous gray-biased runs

CODEX: That means the sampling fix was useful evidence, but not sufficient. It helped the modes that rely on global color search the most, but it did not address the underlying local scoring problem strongly enough to fix `Standard`, and `MCM` still looks dominated by grayscale structure with only sparse accent colors.

CODEX: My updated read is:

CODEX: - sampling bias is real

CODEX: - but the stronger remaining blocker is still the local error metric under-valuing chroma

CODEX: So after the sampling change, the next highest-signal experiment is now to raise `CHROMA_ERROR_WEIGHT` modestly and see whether `Standard` and `MCM` finally move.

---

## Change Log

### Round 1: ECM indexing fix

**File:** `imageConverter.ts`, `mergeBinaryCandidatePoolsByBackground`

**Bug:** Used loop index `bi` instead of `backgrounds[bi]` to index into precomputed pools. Every ECM finalist set pulled candidates for the wrong background colors.

**Fix:** `candidatePoolsByBackground[bi]` → `candidatePoolsByBackground[backgrounds[bi]]`

**Result:** ECM no longer produces garbage output. Confirmed visually.

### Round 2: ECM contrast filter

**File:** `imageConverter.ts`, `getForegroundCandidatesByBackground`

**Problem:** `hasMinimumContrast` filter (threshold 0.16) aggressively eliminated fg/bg pairs. For ECM's 4-background constraint, this starved color diversity.

**Fix:** Added `minContrastRatio` parameter. ECM pool building passes `0` to disable the filter. Standard/MCM keep the default. Also imported `MIN_PAIR_DIFF_RATIO` (was missing, caused runtime crash).

**Result:** ECM regained color. Processing time increased from 34s to 57s (more candidates evaluated).

### Round 3: Remove hidden scoring biases

**File:** `imageConverter.ts`, `imageConverterHeuristics.ts`

**Problem:** Three hardcoded bonus/penalty constants were not controllable by any slider. They caused MCM oversaturation and made the engine behave inconsistently (hidden conditional logic was tried and reverted).

**Fix:** Zeroed all three globally:
- `CHROMA_BONUS_WEIGHT`: 10.0 → 0
- `MCM_HIRES_COLOR_PENALTY_WEIGHT`: 4.0 → 0
- `MCM_MULTICOLOR_USAGE_BONUS_WEIGHT`: 4.0 → 0

**Result:** Exposed the raw pixel-error-only behavior. Revealed systematic gray collapse in Standard and MCM — the error function's luminance-over-chroma weighting (1.55 vs 0.85) favors desaturated matches. ECM accidentally looked better due to constrained global backgrounds acting as a color regularizer.

### Round 4: Fix chroma-blind sample selection (current)

**File:** `imageConverter.ts`, line 833

**Problem:** `rankedIndices` sorted cells by pure luminance variance. `getSampleIndices` takes the top N for ECM/MCM global color search. Smooth chromatic regions (e.g., Skeletor's purple hood) have low luminance variance and were never sampled, so global color selection missed dominant image hues.

**Fix:** Changed cell importance score from:
```typescript
const variance = lumSqSum / n - (lumSum / n)²;
```
to:
```typescript
const lumVariance = lumSqSum / n - (lumSum / n)²;
const chromaMagnitudeSq = meanA * meanA + meanB * meanB;
variances[cellIndex] = lumVariance + 2.0 * chromaMagnitudeSq;
```

Cells with strong chroma now rank highly even if luminance is uniform. Weight of 2.0 makes moderate chroma (~0.1 in OkLab) competitive with moderate luminance variance.

**Result:** Awaiting visual test on Skeletor / True Neutral.

### Round 5: Post-sampling visual reassessment

**Result:** Skeletor / True Neutral was rerun after the chroma-aware sample-selection change.

Observed outcome:

- `ECM`: modestly improved; likely helped by better global color-slot selection
- `Standard`: still largely gray and structure-first
- `MCM`: still broadly similar to previous gray-biased runs

**Conclusion:** the chroma-aware sampling change helped confirm that global sample-selection bias was real, but it did not solve the main color-fidelity problem for Standard or MCM. The next experiment should target the local scoring metric directly, most likely by raising `CHROMA_ERROR_WEIGHT` in small steps (`0.85 -> 1.0 -> 1.1`) and re-evaluating.

### Round 6: Equalize error weights — trust OkLab

CLAUDE: **Files:** `imageConverter.ts`, `imageConverterStandardCore.ts`

CLAUDE: **Problem:** The perceptual error function weighted luminance 1.82× higher than chroma:

```typescript
const LUMA_ERROR_WEIGHT = 1.55;
const CHROMA_ERROR_WEIGHT = 0.85;
```

CLAUDE: This weighting pattern is borrowed from older color spaces (CIE L\*a\*b\*) where Euclidean distance is NOT perceptually uniform and luminance corrections are needed. But OkLab was specifically designed so that unweighted Euclidean distance IS perceptually uniform — that's the whole point of the "Ok" in OkLab.

CLAUDE: Applying a luminance bias on top of OkLab is double-counting: correcting for a problem OkLab already solved. This created the systematic gray collapse, which then required compensating hacks (hue bonus at 10.0, MCM-specific penalties) that caused their own problems (oversaturation, mode inconsistency).

CLAUDE: **Critical discovery:** `imageConverterStandardCore.ts` has its own duplicate copy of these constants. Previous tuning attempts only changed `imageConverter.ts`, which is why Standard mode was completely unaffected by earlier CHROMA_ERROR_WEIGHT sweeps. Standard mode runs its scoring in a separate worker pool that imports from the Standard core file.

CLAUDE: **Fix:** Set both weights to 1.0 in both files:

```typescript
const LUMA_ERROR_WEIGHT = 1.0;
const CHROMA_ERROR_WEIGHT = 1.0;
```

CLAUDE: This makes `perceptualError` a pure unweighted OkLab Euclidean distance — the mathematically correct baseline for a perceptually uniform color space.

CLAUDE: **Quality metric sweep results** (Skeletor, Standard mode, True Neutral):

| Config | SSIM | lumaRMSE | chromaRMSE | meanDeltaE |
|--------|------|----------|------------|------------|
| Old (1.55/0.85) | 0.207 | 0.1553 | 0.0620 | 0.1403 |
| **Equal (1.0/1.0)** | **0.239** | **0.1451** | 0.0626 | **0.1313** |

CLAUDE: Equal weights produce the best SSIM (+15%), best lumaRMSE, and best meanDeltaE of the entire sweep. ChromaRMSE is essentially unchanged. Visual inspection confirms: color is present, structure is preserved, no oversaturation.

CLAUDE: The full sweep (CHROMA_ERROR_WEIGHT at 0.85, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0 with LUMA fixed at 1.55) showed that values above 2.0 start degrading SSIM — the sweet spot was around 2.0–2.5. But equal 1.0/1.0 achieves the same quality more simply by lowering the luma weight rather than raising chroma.

CLAUDE: **Also fixed:** `CONVERTER_DEFAULTS` now matches True Neutral (brightness 1.0, saturation 1.0, all weights 0). Previously defaults had aesthetic tuning (brightness 1.1, saturation 1.4, lumMatchWeight 12, etc.) which made baseline testing unreliable. Rob's Favorite preset preserves the old tuned values.

CLAUDE: **Also built:** Objective quality metrics system (`imageConverterQualityMetrics.ts`) integrated into the harness. Computes SSIM, lumaRMSE, chromaRMSE, meanDeltaE, and per-tile breakdowns by comparing rendered preview against downscaled source reference in OkLab. See `docs/QUALITY_METRICS.md`.

### CLAUDE: Summary — The Chain of Hacks

CLAUDE: The entire color fidelity saga traced back to one root cause:

CLAUDE: 1. `LUMA_ERROR_WEIGHT=1.55 / CHROMA_ERROR_WEIGHT=0.85` — unnecessary bias in OkLab → gray collapse

CLAUDE: 2. `CHROMA_BONUS_WEIGHT=10.0` — hack to compensate → oversaturation

CLAUDE: 3. `MCM_HIRES_COLOR_PENALTY_WEIGHT=4.0` — hack to fix MCM-specific oversaturation

CLAUDE: 4. `MCM_MULTICOLOR_USAGE_BONUS_WEIGHT=4.0` — another MCM band-aid

CLAUDE: Fix: delete the hacks (Rounds 2–3), fix the root cause (Round 6). The engine is now a pure function of OkLab distance with no hidden biases.
