import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const harnessRoot = path.resolve(repoRoot, 'scripts', 'truski3000-harness');
const fixturesDir = path.resolve(harnessRoot, 'fixtures');
const publicFixturesDir = path.resolve(repoRoot, 'public', 'truski3000-harness', 'fixtures');
const outputRoot = path.resolve(harnessRoot, 'output');
const nameFlagIndex = process.argv.indexOf('--name');
const runName = nameFlagIndex >= 0 ? process.argv[nameFlagIndex + 1] ?? null : null;
if (nameFlagIndex >= 0 && !runName) {
  console.error('--name requires a value');
  process.exit(1);
}
const outputDirName = runName ?? 'latest';
const latestOutputDir = path.resolve(outputRoot, outputDirName);
const baselineDir = path.resolve(harnessRoot, 'baselines');
const manifestPath = path.resolve(harnessRoot, 'manifest.json');
const benchmarkOutputPath = path.resolve(outputRoot, 'benchmarks', 'latest.json');
const parityOutputPath = path.resolve(outputRoot, 'parity', 'latest.json');
const validationOutputPath = path.resolve(outputRoot, 'validation', 'latest.json');
const preferredHarnessPort = 4173;
const progressLogPrefix = '[TRUSKI_PROGRESS] ';
const backendLogPrefix = '[TRUSKI_BACKEND] ';
const validAccelerationModes = ['auto', 'wasm', 'js'];

const command = process.argv[2] ?? 'compare';
const validCommands = new Set(['record', 'compare', 'benchmark', 'parity', 'validate']);
if (!validCommands.has(command)) {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: node scripts/truski3000-harness/run.mjs [record|compare|benchmark|parity|validate]');
  process.exit(1);
}

const runAllFixtures = process.argv.includes('--all');
const fixtureFilterIndex = process.argv.indexOf('--fixture');
const fixtureFilter = fixtureFilterIndex >= 0 ? process.argv[fixtureFilterIndex + 1] ?? null : null;
const modeFilterIndex = process.argv.indexOf('--mode');
const modeFilter = modeFilterIndex >= 0 ? process.argv[modeFilterIndex + 1] ?? null : null;
const presetFilterIndex = process.argv.indexOf('--preset');
const presetFilter = presetFilterIndex >= 0 ? process.argv[presetFilterIndex + 1] ?? null : null;
const accelerationFilterIndex = process.argv.indexOf('--acceleration');
const accelerationFilter = accelerationFilterIndex >= 0 ? process.argv[accelerationFilterIndex + 1] ?? null : null;
const saliencyFlagIndex = process.argv.indexOf('--saliency');
const saliencyOverride = saliencyFlagIndex >= 0 ? parseFloat(process.argv[saliencyFlagIndex + 1] ?? 'NaN') : null;
const lumFlagIndex = process.argv.indexOf('--lum');
const lumOverride = lumFlagIndex >= 0 ? parseFloat(process.argv[lumFlagIndex + 1] ?? 'NaN') : null;
const csfFlagIndex = process.argv.indexOf('--csf');
const csfOverride = csfFlagIndex >= 0 ? parseFloat(process.argv[csfFlagIndex + 1] ?? 'NaN') : null;
const maxMsFlagIndex = process.argv.indexOf('--max-ms');
const scenarioTimeoutMs = maxMsFlagIndex >= 0
  ? Math.max(0, Number.parseInt(process.argv[maxMsFlagIndex + 1] ?? '180000', 10) || 180000)
  : 180000;
const iterationsFlagIndex = process.argv.indexOf('--iterations');
const benchmarkIterations = iterationsFlagIndex >= 0
  ? Math.max(1, Number.parseInt(process.argv[iterationsFlagIndex + 1] ?? '2', 10) || 2)
  : 2;
const modeMatrix = {
  standard: {
    outputStandard: true,
    outputEcm: false,
    outputMcm: false,
  },
  ecm: {
    outputStandard: false,
    outputEcm: true,
    outputMcm: false,
  },
  mcm: {
    outputStandard: false,
    outputEcm: false,
    outputMcm: true,
  },
};

const benchmarkProfiles = [
  {
    id: 'default',
    settings: {},
  },
  {
    id: 'true-neutral',
    settings: {
      brightnessFactor: 1.0,
      saturationFactor: 1.0,
      saliencyAlpha: 0.0,
      lumMatchWeight: 0,
      csfWeight: 0,
      includeTypographic: false,
      paletteId: 'colodore',
      manualBgColor: null,
    },
  },
];

function modeIds() {
  return Object.keys(modeMatrix);
}

function formatRequestedAcceleration(mode = accelerationFilter ?? 'auto') {
  switch (mode) {
    case 'js':
      return 'JS ONLY';
    case 'wasm':
      return 'WASM ONLY';
    default:
      return 'AUTO';
  }
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function syncFixturesToPublic() {
  await rm(publicFixturesDir, { recursive: true, force: true });
  await mkdir(path.dirname(publicFixturesDir), { recursive: true });
  await cp(fixturesDir, publicFixturesDir, { recursive: true });
}

function waitForUrl(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, response => {
        response.resume();
        if ((response.statusCode ?? 500) < 400) {
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 250);
      });

      request.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

function startHarnessServer() {
  const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(preferredHarnessPort)],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let resolved = false;
  let bufferedStdout = '';
  let bufferedStderr = '';

  const readyUrl = new Promise((resolve, reject) => {
    const inspect = chunk => {
      const match = chunk.match(/Local:\s+http:\/\/127\.0\.0\.1:(\d+)\//);
      if (!match || resolved) {
        return;
      }
      resolved = true;
      resolve(`http://127.0.0.1:${match[1]}/truski3000-harness.html`);
    };

    child.stdout?.on('data', chunk => {
      const text = chunk.toString();
      process.stdout.write(text);
      bufferedStdout += text;
      inspect(bufferedStdout);
      if (bufferedStdout.length > 4096) {
        bufferedStdout = bufferedStdout.slice(-4096);
      }
    });

    child.stderr?.on('data', chunk => {
      const text = chunk.toString();
      process.stderr.write(text);
      bufferedStderr += text;
      inspect(bufferedStderr);
      if (bufferedStderr.length > 4096) {
        bufferedStderr = bufferedStderr.slice(-4096);
      }
    });

    child.on('exit', code => {
      if (!resolved) {
        reject(new Error(`Harness dev server exited before becoming ready (code ${code ?? 'unknown'})`));
      }
    });
    child.on('error', reject);
  });

  return { child, readyUrl };
}

async function listScenarios() {
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  const available = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map(entry => entry.name)
    .sort();

  let scenarios;

  if (runAllFixtures) {
    scenarios = available.flatMap(fixture => modeIds().map(mode => ({ fixture, mode })));
  } else {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const manifestScenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios : [];
    const availableSet = new Set(available);
    const expanded = [];

    for (const scenario of manifestScenarios) {
      if (!scenario || typeof scenario.fixture !== 'string' || !Array.isArray(scenario.modes)) {
        continue;
      }
      if (!availableSet.has(scenario.fixture)) {
        throw new Error(`Harness manifest fixture not found: ${scenario.fixture}`);
      }
      for (const mode of scenario.modes) {
        if (!modeIds().includes(mode)) {
          throw new Error(`Harness manifest mode is invalid: ${mode}`);
        }
        expanded.push({ fixture: scenario.fixture, mode });
      }
    }
    scenarios = expanded;
  }

  if (scenarios.length === 0) {
    throw new Error('Harness manifest did not define any runnable scenarios');
  }

  if (modeFilter && !modeIds().includes(modeFilter)) {
    throw new Error(`Harness mode filter is invalid: ${modeFilter}`);
  }
  if (accelerationFilter && !validAccelerationModes.includes(accelerationFilter)) {
    throw new Error(`Unknown acceleration mode: ${accelerationFilter}`);
  }

  const filtered = scenarios.filter(scenario => {
    if (fixtureFilter && scenario.fixture !== fixtureFilter) {
      return false;
    }
    if (modeFilter && scenario.mode !== modeFilter) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    throw new Error(
      `Harness filters matched no scenarios${fixtureFilter ? ` for fixture ${fixtureFilter}` : ''}${modeFilter ? ` and mode ${modeFilter}` : ''}`
    );
  }

  return filtered;
}

function dataUrlToBuffer(dataUrl) {
  const marker = 'base64,';
  const base64Index = dataUrl.indexOf(marker);
  if (base64Index === -1) {
    throw new Error('Unexpected preview data URL format');
  }
  return Buffer.from(dataUrl.slice(base64Index + marker.length), 'base64');
}

async function writeRunArtifacts(result) {
  const fixtureName = path.parse(result.fixture).name;

  for (const [mode, summary] of Object.entries(result.summaries)) {
    if (!summary) continue;
    const previewDataUrl = result.previews[mode];
    if (!previewDataUrl) {
      throw new Error(`Missing preview for ${result.fixture} / ${mode}`);
    }

    const modeDir = path.resolve(latestOutputDir, mode, fixtureName);
    await mkdir(modeDir, { recursive: true });
    await writeFile(path.resolve(modeDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
    await writeFile(path.resolve(modeDir, 'preview.png'), dataUrlToBuffer(previewDataUrl));
  }
}

async function runHarnessFixture(page, fixtureName, settings, accelerationMode = 'auto') {
  const evaluatePromise = page.evaluate(
    async ({ nextFixtureName, modeSettings, nextAccelerationMode }) => {
      if (!window.__TRUSKI_HARNESS__) {
        throw new Error('Harness API is not available on window');
      }
      return await window.__TRUSKI_HARNESS__.runFixture({
        fixture: nextFixtureName,
        settings: modeSettings,
        accelerationMode: nextAccelerationMode,
      });
    },
    {
      nextFixtureName: fixtureName,
      modeSettings: settings,
      nextAccelerationMode: accelerationMode,
    }
  );

  if (scenarioTimeoutMs <= 0) {
    return await evaluatePromise;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(
        `Harness scenario timed out after ${scenarioTimeoutMs}ms (${fixtureName}, acceleration=${accelerationMode})`
      ));
    }, scenarioTimeoutMs);
  });

  try {
    return await Promise.race([evaluatePromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runKernelValidation(page) {
  return await page.evaluate(async () => {
    if (!window.__TRUSKI_HARNESS__) {
      throw new Error('Harness API is not available on window');
    }
    return await window.__TRUSKI_HARNESS__.validateKernels();
  });
}

function attachHarnessConsole(page) {
  page.on('console', message => {
    const text = message.text();

    if (text.startsWith(progressLogPrefix)) {
      try {
        const payload = JSON.parse(text.slice(progressLogPrefix.length));
        const detailSuffix = payload.detail ? ` - ${payload.detail}` : '';
        console.log(`Progress ${payload.fixture}: ${payload.stage} ${payload.pct}%${detailSuffix}`);
        return;
      } catch {
        console.log(text);
        return;
      }
    }

    if (text.startsWith(backendLogPrefix)) {
      try {
        const payload = JSON.parse(text.slice(backendLogPrefix.length));
        console.log(
          `BACKEND ${payload.fixture} ${payload.mode}: actual=${String(payload.backend).toUpperCase()} ` +
          `requested=${formatRequestedAcceleration(payload.accelerationMode)}`
        );
        return;
      } catch {
        console.log(text);
        return;
      }
    }

    // Pass through TruSkii diagnostic messages
    if (text.startsWith('[TruSkii')) {
      console.log(text);
      return;
    }
  });
}

async function runBenchmarks(page, scenarios) {
  const benchmarkResults = [];
  const profiles = presetFilter
    ? benchmarkProfiles.filter(profile => profile.id === presetFilter)
    : benchmarkProfiles;
  const accelerationModes = accelerationFilter
    ? validAccelerationModes.filter(mode => mode === accelerationFilter)
    : validAccelerationModes;

  if (presetFilter && profiles.length === 0) {
    throw new Error(`Unknown benchmark preset: ${presetFilter}`);
  }

  for (const profile of profiles) {
    for (const scenario of scenarios) {
      const scenarioSettings = {
        ...profile.settings,
        ...modeMatrix[scenario.mode],
      };

      for (const accelerationMode of accelerationModes) {
        console.log(
          `Benchmark ${profile.id} [${formatRequestedAcceleration(accelerationMode)}] -> ` +
          `${scenario.mode} ${scenario.fixture} (${benchmarkIterations} iterations)`
        );

        await runHarnessFixture(page, scenario.fixture, scenarioSettings, accelerationMode);
        const samples = [];
        let backendByMode = {};

        for (let iteration = 0; iteration < benchmarkIterations; iteration++) {
          const result = await runHarnessFixture(page, scenario.fixture, scenarioSettings, accelerationMode);
          samples.push(result.elapsedMs);
          backendByMode = result.backendByMode;
        }

        const meanElapsedMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        benchmarkResults.push({
          fixture: scenario.fixture,
          mode: scenario.mode,
          preset: profile.id,
          accelerationMode,
          iterations: benchmarkIterations,
          samplesMs: samples,
          meanElapsedMs: Number(meanElapsedMs.toFixed(2)),
          backendByMode,
        });
      }
    }
  }

  await mkdir(path.dirname(benchmarkOutputPath), { recursive: true });
  await writeFile(benchmarkOutputPath, JSON.stringify({ benchmarkResults }, null, 2) + '\n', 'utf8');

  console.log('TRUSKI3000 harness benchmark results:');
  for (const result of benchmarkResults) {
    console.log(
      `- ${result.preset} ${result.accelerationMode} ${result.mode}/${result.fixture}: ` +
      `${result.meanElapsedMs}ms avg [${result.samplesMs.map(value => value.toFixed(1)).join(', ')}] ` +
      `backend=${JSON.stringify(result.backendByMode)}`
    );
  }
  console.log(`Benchmark JSON written to ${benchmarkOutputPath}`);
}

async function runBackendParity(page, scenarios) {
  const parityResults = [];
  const failures = [];

  for (const scenario of scenarios) {
    const settings = modeMatrix[scenario.mode];
    console.log(`Parity ${scenario.mode} -> ${scenario.fixture} [JS ONLY vs WASM ONLY]`);

    const jsResult = await runHarnessFixture(page, scenario.fixture, settings, 'js');
    const wasmResult = await runHarnessFixture(page, scenario.fixture, settings, 'wasm');
    const jsSummary = jsResult.summaries[scenario.mode];
    const wasmSummary = wasmResult.summaries[scenario.mode];
    const jsPreview = jsResult.previews[scenario.mode];
    const wasmPreview = wasmResult.previews[scenario.mode];

    if (!jsSummary || !wasmSummary || !jsPreview || !wasmPreview) {
      failures.push(`${scenario.mode}/${scenario.fixture}: missing summary or preview`);
      continue;
    }

    const summaryMatches = JSON.stringify(jsSummary) === JSON.stringify(wasmSummary);
    const previewMatches = jsPreview === wasmPreview;

    parityResults.push({
      fixture: scenario.fixture,
      mode: scenario.mode,
      summaryMatches,
      previewMatches,
      jsBackend: jsResult.backendByMode[scenario.mode],
      wasmBackend: wasmResult.backendByMode[scenario.mode],
      jsSummary,
      wasmSummary,
    });

    if (!summaryMatches) {
      failures.push(`${scenario.mode}/${scenario.fixture}: summary mismatch (JS vs WASM)`);
    }
    if (!previewMatches) {
      failures.push(`${scenario.mode}/${scenario.fixture}: preview mismatch (JS vs WASM)`);
    }
  }

  await mkdir(path.dirname(parityOutputPath), { recursive: true });
  await writeFile(parityOutputPath, JSON.stringify({ parityResults }, null, 2) + '\n', 'utf8');

  if (failures.length > 0) {
    console.error('TRUSKI3000 harness parity failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error(`Parity JSON written to ${parityOutputPath}`);
    process.exit(1);
  }

  console.log(`TRUSKI3000 harness parity passed. JSON written to ${parityOutputPath}`);
}

function printQualityScores(result) {
  for (const [mode, summary] of Object.entries(result.summaries)) {
    if (!summary?.imageQuality) continue;
    const q = summary.imageQuality;
    console.log(
      `  ${mode} quality: SSIM=${q.ssim.toFixed(3)} lumaRMSE=${q.lumaRMSE.toFixed(4)} ` +
      `chromaRMSE=${q.chromaRMSE.toFixed(4)} meanDeltaE=${q.meanDeltaE.toFixed(4)} ` +
      `p95DeltaE=${q.percentile95DeltaE.toFixed(4)}`
    );
  }
}

function printCharacterUtilization(result) {
  for (const [mode, summary] of Object.entries(result.summaries)) {
    if (!summary?.screencodeHistogram) continue;
    const hist = summary.screencodeHistogram;
    const unique = summary.uniqueScreencodes;
    const total = hist.reduce((a, b) => a + b, 0);

    // Top 20 most-used characters
    const ranked = hist
      .map((count, sc) => ({ sc, count }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);

    const top20 = ranked.slice(0, 20);
    const top20Total = top20.reduce((a, e) => a + e.count, 0);

    // Distribution buckets
    const usedOnce = ranked.filter(e => e.count === 1).length;
    const used2to5 = ranked.filter(e => e.count >= 2 && e.count <= 5).length;
    const used6to20 = ranked.filter(e => e.count >= 6 && e.count <= 20).length;
    const usedOver20 = ranked.filter(e => e.count > 20).length;

    console.log(`  ${mode} character utilization: ${unique}/256 unique (${(unique / 256 * 100).toFixed(0)}%)`);
    console.log(`    Top 20 cover ${top20Total}/${total} cells (${(top20Total / total * 100).toFixed(0)}%):`);
    console.log(`      ${top20.map(e => 'sc' + e.sc + ':' + e.count).join(' ')}`);
    console.log(`    Distribution: ${usedOver20} chars>20× | ${used6to20} chars 6-20× | ${used2to5} chars 2-5× | ${usedOnce} chars 1×`);

    // Cross-reference: detail vs quality per cell
    if (summary.perCellDetail && summary.perCellTileDeltaE) {
      const detail = summary.perCellDetail;
      const deltaE = summary.perCellTileDeltaE;
      const ssim = summary.perCellTileSSIM || [];
      const screencodes = summary.screencodeHistogram; // need raw screencodes, not hist

      // Classify cells by detail level
      const detailThreshold = 0.3; // cells with meaningful structure
      const highDetail = [];
      const lowDetail = [];
      for (let i = 0; i < detail.length; i++) {
        const entry = { cell: i, detail: detail[i], deltaE: deltaE[i], ssim: ssim[i] || 0 };
        if (detail[i] >= detailThreshold) highDetail.push(entry);
        else lowDetail.push(entry);
      }

      const avgDeltaEHigh = highDetail.length > 0
        ? highDetail.reduce((a, e) => a + e.deltaE, 0) / highDetail.length : 0;
      const avgDeltaELow = lowDetail.length > 0
        ? lowDetail.reduce((a, e) => a + e.deltaE, 0) / lowDetail.length : 0;
      const avgSSIMHigh = highDetail.length > 0
        ? highDetail.reduce((a, e) => a + e.ssim, 0) / highDetail.length : 0;
      const avgSSIMLow = lowDetail.length > 0
        ? lowDetail.reduce((a, e) => a + e.ssim, 0) / lowDetail.length : 0;

      // Worst high-detail cells (high detail + high error = bad character choice)
      const worstDetailCells = highDetail
        .sort((a, b) => b.deltaE - a.deltaE)
        .slice(0, 10);

      console.log(`    Detail split (threshold=${detailThreshold}):`);
      console.log(`      High-detail cells: ${highDetail.length} — avgDeltaE=${avgDeltaEHigh.toFixed(4)} avgSSIM=${avgSSIMHigh.toFixed(3)}`);
      console.log(`      Low-detail cells:  ${lowDetail.length} — avgDeltaE=${avgDeltaELow.toFixed(4)} avgSSIM=${avgSSIMLow.toFixed(3)}`);
      if (worstDetailCells.length > 0) {
        console.log(`      Worst high-detail cells (detail>=0.3, sorted by error):`);
        const cellDescs = worstDetailCells.map(e => {
          const cx = e.cell % 40;
          const cy = Math.floor(e.cell / 40);
          return '        [' + cx + ',' + cy + '] detail=' + e.detail.toFixed(2) + ' deltaE=' + e.deltaE.toFixed(4) + ' ssim=' + e.ssim.toFixed(3);
        });
        console.log(cellDescs.join('\n'));
      }
    }

    // Color diagnostics: cells where chosen pair diverges from ideal
    if (summary.perCellColorDiag) {
      const diag = summary.perCellColorDiag;
      const C64_COLOR_NAMES = [
        'black', 'white', 'red', 'cyan', 'purple', 'green',
        'blue', 'yellow', 'orange', 'brown', 'pink', 'dgray',
        'mgray', 'lgreen', 'lblue', 'lgray'
      ];
      const cn = (c) => C64_COLOR_NAMES[c] || String(c);

      // Find cells with biggest gap between ideal and chosen error
      const colorGaps = diag.map((d, i) => ({
        cell: i,
        gap: d.chosenErr - d.idealErr,
        chosen: [d.bg, d.fg],
        ideal: [d.idealC1, d.idealC2],
        chosenErr: d.chosenErr,
        idealErr: d.idealErr,
        detail: (summary.perCellDetail && summary.perCellDetail[i]) || 0,
      }));

      // Overall stats
      const totalGap = colorGaps.reduce((a, e) => a + e.gap, 0);
      const cellsWithGap = colorGaps.filter(e => e.gap > 0.01).length;
      const avgGap = cellsWithGap > 0 ? totalGap / cellsWithGap : 0;

      // Cells where ideal != chosen (sorted by gap)
      const worstColorCells = colorGaps
        .filter(e => e.gap > 0.01)
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 10);

      console.log(`    Color pair diagnostics: ${cellsWithGap}/1000 cells chose non-ideal pair (avgGap=${avgGap.toFixed(2)})`);
      if (worstColorCells.length > 0) {
        console.log('      Worst color-pair gaps (ideal vs chosen):');
        for (const e of worstColorCells) {
          const cx = e.cell % 40;
          const cy = Math.floor(e.cell / 40);
          const idealStr = cn(e.ideal[0]) + '+' + cn(e.ideal[1]);
          const chosenStr = cn(e.chosen[0]) + '+' + cn(e.chosen[1]);
          console.log(
            '        [' + cx + ',' + cy + '] ideal=' + idealStr +
            '(' + e.idealErr.toFixed(1) + ') chosen=' + chosenStr +
            '(' + e.chosenErr.toFixed(1) + ') gap=' + e.gap.toFixed(1) +
            ' detail=' + e.detail.toFixed(2)
          );
        }
      }

      // Aggregate: which ideal colors are most often lost?
      const idealColorFreq = new Array(16).fill(0);
      const chosenColorFreq = new Array(16).fill(0);
      for (const d of diag) {
        idealColorFreq[d.idealC1]++;
        idealColorFreq[d.idealC2]++;
        chosenColorFreq[d.bg]++;
        chosenColorFreq[d.fg]++;
      }
      const lostColors = [];
      for (let c = 0; c < 16; c++) {
        const diff = idealColorFreq[c] - chosenColorFreq[c];
        if (diff > 10) lostColors.push({ color: c, name: cn(c), idealCount: idealColorFreq[c], chosenCount: chosenColorFreq[c], lost: diff });
      }
      if (lostColors.length > 0) {
        lostColors.sort((a, b) => b.lost - a.lost);
        console.log('      Colors underused vs ideal:');
        for (const lc of lostColors) {
          console.log('        ' + lc.name + ': ideal=' + lc.idealCount + ' chosen=' + lc.chosenCount + ' (lost ' + lc.lost + ' cells)');
        }
      }
      const gainedColors = [];
      for (let c = 0; c < 16; c++) {
        const diff = chosenColorFreq[c] - idealColorFreq[c];
        if (diff > 10) gainedColors.push({ color: c, name: cn(c), idealCount: idealColorFreq[c], chosenCount: chosenColorFreq[c], gained: diff });
      }
      if (gainedColors.length > 0) {
        gainedColors.sort((a, b) => b.gained - a.gained);
        console.log('      Colors overused vs ideal:');
        for (const gc of gainedColors) {
          console.log('        ' + gc.name + ': ideal=' + gc.idealCount + ' chosen=' + gc.chosenCount + ' (gained ' + gc.gained + ' cells)');
        }
      }
    }
  }
}

function formatDelta(value) {
  return value >= 0 ? `+${value.toFixed(4)}` : value.toFixed(4);
}

async function generateComparisonHtml(scenarios) {
  const reportPath = path.resolve(outputRoot, 'comparison.html');
  const rows = [];

  for (const scenario of scenarios) {
    const fixtureName = path.parse(scenario.fixture).name;
    const mode = scenario.mode;
    const latestSummaryPath = path.resolve(latestOutputDir, mode, fixtureName, 'summary.json');
    const baselineSummaryPath = path.resolve(baselineDir, mode, fixtureName, 'summary.json');

    let latest = null;
    let baseline = null;
    try { latest = JSON.parse(await readFile(latestSummaryPath, 'utf8')); } catch {}
    try { baseline = JSON.parse(await readFile(baselineSummaryPath, 'utf8')); } catch {}

    rows.push({ fixture: scenario.fixture, fixtureName, mode, latest, baseline });
  }

  function metricDelta(val, base, lowerBetter) {
    if (base == null || val == null) return '';
    const d = val - base;
    if (Math.abs(d) < 0.00005) return '<span class="neutral">(=)</span>';
    const good = lowerBetter ? d < 0 : d > 0;
    const sign = d > 0 ? '+' : '';
    const cls = good ? 'better' : 'worse';
    return '<span class="' + cls + '">(' + sign + d.toFixed(4) + ')</span>';
  }

  function metricRow(name, latestVal, baseVal, decimals, lowerBetter) {
    const bStr = baseVal != null ? baseVal.toFixed(decimals) : '—';
    const lStr = latestVal != null ? latestVal.toFixed(decimals) : '—';
    return '<tr><td>' + name + '</td><td>' + bStr + '</td><td>' + lStr + '</td><td>' + metricDelta(latestVal, baseVal, lowerBetter) + '</td></tr>';
  }

  function renderScenario(row) {
    const lq = row.latest ? row.latest.imageQuality : null;
    const bq = row.baseline ? row.baseline.imageQuality : null;
    const fixtureSrc = '../fixtures/' + row.fixture;
    const baselineSrc = '../baselines/' + row.mode + '/' + row.fixtureName + '/preview.png';
    const latestSrc = outputDirName + '/' + row.mode + '/' + row.fixtureName + '/preview.png';

    function summaryInfo(summary, label) {
      if (!summary) return '';
      let s = '<div class="card-info">';
      s += '<div class="card-label">' + label + '</div>';
      s += '<table class="card-table">';
      s += '<tr><td class="cl">bg</td><td>' + summary.backgroundColor + '</td></tr>';
      s += '<tr><td class="cl">charset</td><td>' + summary.charset + '</td></tr>';
      if (summary.ecmBgColors && summary.ecmBgColors.length > 0) {
        s += '<tr><td class="cl">ecm bgs</td><td>[' + summary.ecmBgColors.join(', ') + ']</td></tr>';
      }
      if (summary.mcmSharedColors && summary.mcmSharedColors.some(function(c) { return c > 0; })) {
        s += '<tr><td class="cl">mcm shared</td><td>[' + summary.mcmSharedColors.join(', ') + ']</td></tr>';
      }
      const q = summary.imageQuality;
      if (q) {
        s += '<tr><td class="cl">SSIM</td><td>' + q.ssim.toFixed(3) + '</td></tr>';
        s += '<tr><td class="cl">lumaRMSE</td><td>' + q.lumaRMSE.toFixed(4) + '</td></tr>';
        s += '<tr><td class="cl">chromaRMSE</td><td>' + q.chromaRMSE.toFixed(4) + '</td></tr>';
        s += '<tr><td class="cl">meanDeltaE</td><td>' + q.meanDeltaE.toFixed(4) + '</td></tr>';
        s += '<tr><td class="cl">p95DeltaE</td><td>' + q.percentile95DeltaE.toFixed(4) + '</td></tr>';
      }
      s += '</table>';
      s += '</div>';
      return s;
    }

    let html = '<div class="scenario">';
    html += '<h2>' + row.mode + ' / ' + row.fixture + '</h2>';
    html += '<div class="images">';
    html += '<div class="img-box"><img src="' + fixtureSrc + '" style="object-fit:cover;" alt="Source"><div class="label">Source</div></div>';
    if (row.baseline) {
      html += '<div class="img-box"><img src="' + baselineSrc + '" alt="Baseline">' + summaryInfo(row.baseline, 'Baseline') + '</div>';
    }
    if (row.latest) {
      html += '<div class="img-box"><img src="' + latestSrc + '" alt="Latest">' + summaryInfo(row.latest, 'Latest') + '</div>';
    }
    html += '</div>';

    if (lq && bq) {
      html += '<div class="metrics"><h3>Delta</h3><table>';
      html += '<tr><th></th><th>Baseline</th><th>Latest</th><th>Change</th></tr>';
      html += metricRow('SSIM', lq.ssim, bq.ssim, 3, false);
      html += metricRow('lumaRMSE', lq.lumaRMSE, bq.lumaRMSE, 4, true);
      html += metricRow('chromaRMSE', lq.chromaRMSE, bq.chromaRMSE, 4, true);
      html += metricRow('meanDeltaE', lq.meanDeltaE, bq.meanDeltaE, 4, true);
      html += metricRow('p95DeltaE', lq.percentile95DeltaE, bq.percentile95DeltaE, 4, true);
      html += '</table></div>';
    }

    html += '</div>';
    return html;
  }

  const scenarioHtml = rows.map(renderScenario).join('\n');
  const timestamp = new Date().toISOString().slice(0, 19);

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>TRUSKI3000 Comparison</title>',
    '<style>',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body { background: #1a1a1a; color: #e0e0e0; font-family: system-ui, sans-serif; padding: 24px; }',
    'h1 { margin-bottom: 4px; font-size: 1.3em; }',
    '.subtitle { color: #888; margin-bottom: 24px; font-size: 0.85em; }',
    '.scenario { margin-bottom: 32px; border-bottom: 1px solid #333; padding-bottom: 24px; }',
    '.scenario h2 { font-size: 1.1em; margin-bottom: 12px; }',
    '.images { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }',
    '.img-box { text-align: center; }',
    '.img-box img { width: 320px; height: 200px; image-rendering: pixelated; border: 1px solid #444; display: block; }',
    '.img-box .label { font-size: 0.75em; color: #888; margin-top: 4px; }',
    '.metrics { margin-top: 12px; font-size: 0.8em; font-family: monospace; }',
    '.metrics table { border-collapse: collapse; }',
    '.metrics th, .metrics td { padding: 2px 12px 2px 0; text-align: left; }',
    '.metrics th { color: #888; font-weight: normal; }',
    '.better { color: #6c6; }',
    '.worse { color: #c66; }',
    '.neutral { color: #888; }',
    '.card-info { font-size: 0.8em; margin-top: 6px; }',
    '.card-label { font-weight: bold; color: #ccc; margin-bottom: 4px; }',
    '.card-table { border-collapse: collapse; font-family: monospace; font-size: 0.9em; }',
    '.card-table td { padding: 1px 8px 1px 0; }',
    '.card-table .cl { color: #888; }',
    '.metrics h3 { font-size: 0.9em; margin-bottom: 4px; color: #aaa; }',
    '</style>',
    '</head>',
    '<body>',
    '<h1>TRUSKI3000 Visual Comparison</h1>',
    '<p class="subtitle">Generated ' + timestamp + ' | Baseline vs Latest</p>',
    scenarioHtml,
    '</body>',
    '</html>',
  ].join('\n');

  await writeFile(reportPath, html, 'utf8');
  console.log('Visual comparison: ' + reportPath);
}

async function compareAgainstBaselines() {
  const failures = [];

  for (const mode of Object.keys(modeMatrix)) {
    const latestModeDir = path.resolve(latestOutputDir, mode);
    let fixtures = [];
    try {
      fixtures = await readdir(latestModeDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fixtureEntry of fixtures) {
      if (!fixtureEntry.isDirectory()) continue;
      const fixtureName = fixtureEntry.name;
      const latestSummaryPath = path.resolve(latestModeDir, fixtureName, 'summary.json');
      const latestPreviewPath = path.resolve(latestModeDir, fixtureName, 'preview.png');
      const baselineSummaryPath = path.resolve(baselineDir, mode, fixtureName, 'summary.json');
      const baselinePreviewPath = path.resolve(baselineDir, mode, fixtureName, 'preview.png');

      try {
        const [latestSummaryBuf, baselineSummaryBuf, latestPreview, baselinePreview] = await Promise.all([
          readFile(latestSummaryPath),
          readFile(baselineSummaryPath),
          readFile(latestPreviewPath),
          readFile(baselinePreviewPath),
        ]);

        if (!latestSummaryBuf.equals(baselineSummaryBuf)) {
          failures.push(`${mode}/${fixtureName}: summary mismatch`);
        }
        if (!latestPreview.equals(baselinePreview)) {
          failures.push(`${mode}/${fixtureName}: preview mismatch`);
        }

        // Show quality score changes regardless of pass/fail
        try {
          const latestSummary = JSON.parse(latestSummaryBuf.toString('utf8'));
          const baselineSummary = JSON.parse(baselineSummaryBuf.toString('utf8'));
          if (latestSummary.imageQuality && baselineSummary.imageQuality) {
            const lq = latestSummary.imageQuality;
            const bq = baselineSummary.imageQuality;
            const ssimDelta = lq.ssim - bq.ssim;
            const chromaDelta = lq.chromaRMSE - bq.chromaRMSE;
            const lumaDelta = lq.lumaRMSE - bq.lumaRMSE;
            const changed = !latestSummaryBuf.equals(baselineSummaryBuf);
            const tag = changed ? 'CHANGED' : 'OK';
            console.log(
              `  ${mode}/${fixtureName} [${tag}]: ` +
              `SSIM ${bq.ssim.toFixed(3)}->${lq.ssim.toFixed(3)} (${formatDelta(ssimDelta)}) ` +
              `chromaRMSE ${bq.chromaRMSE.toFixed(4)}->${lq.chromaRMSE.toFixed(4)} (${formatDelta(chromaDelta)}) ` +
              `lumaRMSE ${bq.lumaRMSE.toFixed(4)}->${lq.lumaRMSE.toFixed(4)} (${formatDelta(lumaDelta)})`
            );
          }
        } catch {
          // Non-fatal — quality reporting is informational
        }
      } catch (error) {
        failures.push(`${mode}/${fixtureName}: missing baseline (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('TRUSKI3000 harness compare failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
}

async function recordBaselines() {
  await mkdir(baselineDir, { recursive: true });

  for (const modeEntry of await readdir(latestOutputDir, { withFileTypes: true })) {
    if (!modeEntry.isDirectory()) continue;
    const latestModeDir = path.resolve(latestOutputDir, modeEntry.name);
    const baselineModeDir = path.resolve(baselineDir, modeEntry.name);
    await mkdir(baselineModeDir, { recursive: true });

    for (const fixtureEntry of await readdir(latestModeDir, { withFileTypes: true })) {
      if (!fixtureEntry.isDirectory()) continue;
      const latestFixtureDir = path.resolve(latestModeDir, fixtureEntry.name);
      const baselineFixtureDir = path.resolve(baselineModeDir, fixtureEntry.name);
      await rm(baselineFixtureDir, { recursive: true, force: true });
      await cp(latestFixtureDir, baselineFixtureDir, { recursive: true });
    }
  }
}

async function main() {
  await syncFixturesToPublic();
  await rm(latestOutputDir, { recursive: true, force: true });
  await mkdir(latestOutputDir, { recursive: true });
  await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);

  const { child: harnessServer, readyUrl } = startHarnessServer();
  const stopHarnessServer = () => {
    if (!harnessServer.killed) {
      harnessServer.kill('SIGTERM');
    }
  };

  process.on('exit', stopHarnessServer);
  process.on('SIGINT', () => {
    stopHarnessServer();
    process.exit(130);
  });
  const harnessUrl = await readyUrl;
  await waitForUrl(harnessUrl);

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run `npm install` and `npx playwright install chromium` first.');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    attachHarnessConsole(page);
    await page.goto(harnessUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__TRUSKI_HARNESS__));

    const scenarios = await listScenarios();
    console.log(`Harness acceleration request: ${formatRequestedAcceleration()}`);
    console.log(`Harness scenario timeout: ${scenarioTimeoutMs > 0 ? `${scenarioTimeoutMs}ms` : 'disabled'}`);
    if (command === 'benchmark') {
      await runBenchmarks(page, scenarios);
      return;
    }
    if (command === 'parity') {
      await runBackendParity(page, scenarios);
      return;
    }
    if (command === 'validate') {
      const validation = await runKernelValidation(page);
      await mkdir(path.dirname(validationOutputPath), { recursive: true });
      await writeFile(validationOutputPath, JSON.stringify(validation, null, 2) + '\n', 'utf8');
      if (!validation.passed) {
        console.error('TRUSKI3000 harness validation failed:');
        for (const mismatch of validation.mismatches) {
          console.error(`- ${mismatch}`);
        }
        process.exit(1);
      }
      console.log(
        'TRUSKI3000 harness validation passed: ' +
        `${validation.standardSetErrCases} standard setErr cases, ` +
        `${validation.standardHammingCases} binary Hamming cases, ` +
        `${validation.mcmMatrixCases} MCM matrix cases, ` +
        `${validation.mcmHammingCases} MCM Hamming cases`
      );
      console.log(`Validation JSON written to ${validationOutputPath}`);
      return;
    }

    for (const scenario of scenarios) {
      const settings = { ...modeMatrix[scenario.mode] };
      if (saliencyOverride !== null && !isNaN(saliencyOverride)) {
        settings.saliencyAlpha = saliencyOverride;
      }
      if (lumOverride !== null && !isNaN(lumOverride)) {
        settings.lumMatchWeight = lumOverride;
      }
      if (csfOverride !== null && !isNaN(csfOverride)) {
        settings.csfWeight = csfOverride;
      }
      const overrideLabel = [
        saliencyOverride !== null ? `sal=${saliencyOverride}` : '',
        lumOverride !== null ? `lum=${lumOverride}` : '',
        csfOverride !== null ? `csf=${csfOverride}` : '',
      ].filter(Boolean).join(' ');
      console.log(`Running ${scenario.mode} -> ${scenario.fixture} [${formatRequestedAcceleration()}]${overrideLabel ? ' ' + overrideLabel : ''}`);
      const result = await runHarnessFixture(page, scenario.fixture, settings, accelerationFilter ?? 'auto');
      await writeRunArtifacts(result);
      printQualityScores(result);
      printCharacterUtilization(result);
    }

    await generateComparisonHtml(scenarios);
  } finally {
    await browser.close();
    stopHarnessServer();
  }

  if (command === 'record') {
    await recordBaselines();
    console.log(`Recorded baselines in ${baselineDir}`);
    return;
  }

  await compareAgainstBaselines();
  console.log('TRUSKI3000 harness compare passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
