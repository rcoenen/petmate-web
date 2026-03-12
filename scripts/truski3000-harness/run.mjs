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
const gallerySourceIndex = process.argv.indexOf('--source');
const gallerySource = gallerySourceIndex >= 0 ? process.argv[gallerySourceIndex + 1] ?? 'baselines' : 'baselines';
const preferredHarnessPort = 4173;
const progressLogPrefix = '[TRUSKI_PROGRESS] ';
const backendLogPrefix = '[TRUSKI_BACKEND] ';
const validAccelerationModes = ['wasm', 'js'];

const command = process.argv[2] ?? 'compare';
const validCommands = new Set(['record', 'compare', 'capture', 'benchmark', 'parity', 'validate', 'gallery']);
if (!validCommands.has(command)) {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: node scripts/truski3000-harness/run.mjs [record|compare|capture|benchmark|parity|validate|gallery]');
  process.exit(1);
}

const runAllFixtures = process.argv.includes('--all');
const fixtureFilterIndex = process.argv.indexOf('--fixture');
const fixtureFilter = fixtureFilterIndex >= 0 ? process.argv[fixtureFilterIndex + 1] ?? null : null;
const modeFilterIndex = process.argv.indexOf('--mode');
const modeFilter = modeFilterIndex >= 0 ? process.argv[modeFilterIndex + 1] ?? null : null;
const profileFilterIndex = process.argv.indexOf('--profile');
const profileFilter = profileFilterIndex >= 0 ? process.argv[profileFilterIndex + 1] ?? null : null;
const presetFilterIndex = process.argv.indexOf('--preset');
const presetFilter = presetFilterIndex >= 0 ? process.argv[presetFilterIndex + 1] ?? null : null;
const accelerationFilterIndex = process.argv.indexOf('--acceleration');
const accelerationFilter = accelerationFilterIndex >= 0 ? process.argv[accelerationFilterIndex + 1] ?? null : null;
const serverModeIndex = process.argv.indexOf('--server');
const serverMode = serverModeIndex >= 0 ? process.argv[serverModeIndex + 1] ?? 'preview' : 'preview';
if (!['preview', 'dev'].includes(serverMode)) {
  console.error(`Unknown server mode: ${serverMode}`);
  console.error('Use --server preview or --server dev');
  process.exit(1);
}
const skipBuild = process.argv.includes('--skip-build');
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

const harnessProfiles = [
  {
    id: 'current-defaults',
    label: 'Current Defaults',
    settings: {},
  },
  {
    id: 'robs-favorite',
    label: "Rob's Favorite",
    settings: {
      brightnessFactor: 1.1,
      saturationFactor: 1.4,
      saliencyAlpha: 3.0,
      lumMatchWeight: 12,
      csfWeight: 10,
      mcmHuePreservationWeight: 10,
      mcmHiresColorPenaltyWeight: 4,
      mcmMulticolorUsageBonusWeight: 4,
      includeTypographic: true,
      paletteId: 'colodore',
      manualBgColor: null,
    },
  },
  {
    id: 'true-neutral',
    label: 'True Neutral',
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

const benchmarkProfiles = [
  {
    id: 'default',
    profileId: 'current-defaults',
  },
  {
    id: 'robs-favorite',
    profileId: 'robs-favorite',
  },
  {
    id: 'true-neutral',
    profileId: 'true-neutral',
  },
];

function getHarnessProfile(profileId = 'current-defaults') {
  return harnessProfiles.find(profile => profile.id === profileId) ?? null;
}

function resolveScenarioSettings(modeSettings, profileId = 'current-defaults', extraOverrides = {}) {
  const profile = getHarnessProfile(profileId);
  if (!profile) {
    throw new Error(`Unknown harness profile: ${profileId}`);
  }
  return {
    ...profile.settings,
    ...modeSettings,
    ...extraOverrides,
  };
}

function modeIds() {
  return Object.keys(modeMatrix);
}

function formatRequestedAcceleration(mode = accelerationFilter ?? 'wasm') {
  switch (mode) {
    case 'js':
      return 'JS ONLY';
    case 'wasm':
      return 'WASM ONLY';
    default:
      return String(mode);
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

function startHarnessServer(mode = 'preview') {
  const scriptName = mode === 'dev' ? 'dev' : 'preview';
  const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', scriptName, '--', '--host', '127.0.0.1', '--port', String(preferredHarnessPort)],
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
  if (profileFilter && !getHarnessProfile(profileFilter)) {
    throw new Error(`Unknown harness profile: ${profileFilter}`);
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

async function runHarnessFixture(page, fixtureName, settings, accelerationMode = 'wasm', profileId = null) {
  const evaluatePromise = page.evaluate(
    async ({ nextFixtureName, modeSettings, nextAccelerationMode, nextProfileId }) => {
      if (!window.__TRUSKI_HARNESS__) {
        throw new Error('Harness API is not available on window');
      }
      return await window.__TRUSKI_HARNESS__.runFixture({
        fixture: nextFixtureName,
        settings: modeSettings,
        accelerationMode: nextAccelerationMode,
        profileId: nextProfileId,
      });
    },
    {
      nextFixtureName: fixtureName,
      modeSettings: settings,
      nextAccelerationMode: accelerationMode,
      nextProfileId: profileId,
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

function attachHarnessConsole(page, progressRenderer = null) {
  page.on('console', message => {
    const text = message.text();

    if (text.startsWith(progressLogPrefix)) {
      try {
        const payload = JSON.parse(text.slice(progressLogPrefix.length));
        if (progressRenderer?.updateProgress(payload)) {
          return;
        }
        const detailSuffix = payload.detail ? ` - ${payload.detail}` : '';
        console.log(`Progress ${payload.fixture}: ${payload.stage} ${payload.pct}%${detailSuffix}`);
        return;
      } catch {
        progressRenderer?.log(text) ?? console.log(text);
        return;
      }
    }

    if (text.startsWith(backendLogPrefix)) {
      try {
        const payload = JSON.parse(text.slice(backendLogPrefix.length));
        if (progressRenderer?.updateBackend(payload)) {
          return;
        }
        console.log(
          `BACKEND ${payload.fixture} ${payload.mode}: actual=${String(payload.backend).toUpperCase()} ` +
          `requested=${formatRequestedAcceleration(payload.accelerationMode)}`
        );
        return;
      } catch {
        progressRenderer?.log(text) ?? console.log(text);
        return;
      }
    }

    // Pass through TruSkii diagnostic messages
    if (text.startsWith('[TruSkii')) {
      progressRenderer?.log(text) ?? console.log(text);
      return;
    }
  });
}

async function runBenchmarks(page, scenarios) {
  const benchmarkResults = [];
  const profiles = presetFilter
    ? benchmarkProfiles.filter(profile => profile.id === presetFilter)
    : profileFilter
    ? benchmarkProfiles.filter(profile => profile.profileId === profileFilter)
    : benchmarkProfiles;
  const accelerationModes = accelerationFilter
    ? validAccelerationModes.filter(mode => mode === accelerationFilter)
    : validAccelerationModes;

  if (presetFilter && profiles.length === 0) {
    throw new Error(`Unknown benchmark preset: ${presetFilter}`);
  }
  if (!presetFilter && profileFilter && profiles.length === 0) {
    throw new Error(`No benchmark presets map to harness profile: ${profileFilter}`);
  }

  for (const profile of profiles) {
    const resolvedProfile = getHarnessProfile(profile.profileId);
    if (!resolvedProfile) {
      throw new Error(`Unknown harness profile for benchmark preset ${profile.id}: ${profile.profileId}`);
    }
    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      const scenarioSettings = resolveScenarioSettings(modeMatrix[scenario.mode], profile.profileId);

      for (const accelerationMode of accelerationModes) {
        console.log(
          `Benchmark ${profile.id} [${formatRequestedAcceleration(accelerationMode)}] -> ` +
          `${scenario.mode} ${scenario.fixture} (${benchmarkIterations} iterations)`
        );

        await runHarnessFixture(page, scenario.fixture, scenarioSettings, accelerationMode, resolvedProfile.id);
        const samples = [];
        let backendByMode = {};

        for (let iteration = 0; iteration < benchmarkIterations; iteration++) {
          const result = await runHarnessFixture(
            page,
            scenario.fixture,
            scenarioSettings,
            accelerationMode,
            resolvedProfile.id
          );
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
  const profileId = profileFilter ?? 'current-defaults';

  for (const scenario of scenarios) {
    const settings = resolveScenarioSettings(modeMatrix[scenario.mode], profileId);
    console.log(`Parity ${scenario.mode} -> ${scenario.fixture} [JS ONLY vs WASM ONLY] profile=${profileId}`);

    const jsResult = await runHarnessFixture(page, scenario.fixture, settings, 'js', profileId);
    const wasmResult = await runHarnessFixture(page, scenario.fixture, settings, 'wasm', profileId);
    const jsSummary = jsResult.summaries[scenario.mode];
    const wasmSummary = wasmResult.summaries[scenario.mode];
    const jsPreview = jsResult.previews[scenario.mode];
    const wasmPreview = wasmResult.previews[scenario.mode];

    if (!jsSummary || !wasmSummary || !jsPreview || !wasmPreview) {
      failures.push(`${scenario.mode}/${scenario.fixture}: missing summary or preview`);
      continue;
    }

    const summaryMatches =
      JSON.stringify(stripVolatileSummaryFields(jsSummary)) ===
      JSON.stringify(stripVolatileSummaryFields(wasmSummary));
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
    const conversionMs = summary.conversionMs ?? result.elapsedMs;
    console.log(
      `  ${mode} quality: SSIM=${q.ssim.toFixed(3)} cellSSIM=${(q.cellSSIM ?? 0).toFixed(3)} lumaRMSE=${q.lumaRMSE.toFixed(4)} ` +
      `chromaRMSE=${q.chromaRMSE.toFixed(4)} meanDeltaE=${q.meanDeltaE.toFixed(4)} ` +
      `p95DeltaE=${q.percentile95DeltaE.toFixed(4)} timeMs=${conversionMs.toFixed(2)}`
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

function formatDelta(value, lowerBetter = false) {
  // Flip sign for lower-is-better metrics so + always means improvement
  const display = lowerBetter ? -value : value;
  const str = display >= 0 ? `+${display.toFixed(4)}` : display.toFixed(4);
  if (Math.abs(value) < 0.00005) return str;
  const good = lowerBetter ? value < 0 : value > 0;
  return good ? `\x1b[32m${str}\x1b[0m` : `\x1b[31m${str}\x1b[0m`;
}

function stripVolatileSummaryFields(summary) {
  if (!summary) return summary;
  const {
    accelerationMode,
    accelerationBackend,
    conversionMs,
    conversionSeconds,
    ...stable
  } = summary;
  return stable;
}

function summarizeSettingsForDisplay(settings) {
  if (!settings) return 'unknown';
  return [
    `b=${settings.brightnessFactor}`,
    `s=${settings.saturationFactor}`,
    `sal=${settings.saliencyAlpha}`,
    `lum=${settings.lumMatchWeight}`,
    `csf=${settings.csfWeight}`,
    `mcmHue=${settings.mcmHuePreservationWeight ?? 0}`,
    `mcmHires=${settings.mcmHiresColorPenaltyWeight ?? 0}`,
    `mcmMulti=${settings.mcmMulticolorUsageBonusWeight ?? 0}`,
    settings.includeTypographic ? 'typo=on' : 'typo=off',
    `palette=${settings.paletteId}`,
    `manualBg=${settings.manualBgColor == null ? 'auto' : settings.manualBgColor}`,
  ].join(' ');
}

function extractSummaryProvenance(summary) {
  if (!summary) return null;
  return {
    profileId: summary.profileId ?? null,
    effectiveSettings: summary.effectiveSettings ?? null,
    settingsFingerprint: summary.settingsFingerprint ?? null,
    objectiveSignature: summary.objectiveSignature ?? null,
    objectiveFingerprint: summary.objectiveFingerprint ?? null,
  };
}

function compareSummaryProvenance(latestSummary, baselineSummary) {
  const latest = extractSummaryProvenance(latestSummary);
  const baseline = extractSummaryProvenance(baselineSummary);
  if (!latest || !baseline) {
    return { status: 'missing', detail: 'missing summary provenance' };
  }
  if (!latest.settingsFingerprint || !latest.objectiveFingerprint ||
      !baseline.settingsFingerprint || !baseline.objectiveFingerprint) {
    return { status: 'legacy', detail: 'baseline or latest summary is missing provenance fingerprints' };
  }
  const settingsMatch = latest.settingsFingerprint === baseline.settingsFingerprint;
  const objectiveMatch = latest.objectiveFingerprint === baseline.objectiveFingerprint;
  if (settingsMatch && objectiveMatch) {
    return { status: 'match', detail: 'settings + objective fingerprints match' };
  }

  const details = [];
  if (!settingsMatch) {
    details.push(
      `settings differ: baseline(${summarizeSettingsForDisplay(baseline.effectiveSettings)}) vs latest(${summarizeSettingsForDisplay(latest.effectiveSettings)})`
    );
  }
  if (!objectiveMatch) {
    details.push(
      `objective differs: baseline=${String(baseline.objectiveFingerprint).slice(0, 12)} latest=${String(latest.objectiveFingerprint).slice(0, 12)}`
    );
  }
  return {
    status: 'mismatch',
    detail: details.join('; '),
  };
}

function formatModeLabel(mode) {
  switch (mode) {
    case 'standard':
      return 'STD (Standard)';
    case 'ecm':
      return 'ECM (Extended Color Mode)';
    case 'mcm':
      return 'MCM (Multicolor Mode)';
    default:
      return String(mode);
  }
}

function formatAccelerationMode(mode) {
  switch (mode) {
    case 'js':
      return 'JS ONLY';
    case 'wasm':
      return 'WASM ONLY';
    default:
      return String(mode);
  }
}

function formatAccelerationBackend(backend) {
  switch (backend) {
    case 'wasm':
      return 'WASM';
    case 'js':
      return 'JS';
    default:
      return 'unknown';
  }
}

function formatModeShort(mode) {
  switch (mode) {
    case 'standard':
      return 'STD';
    case 'ecm':
      return 'ECM';
    case 'mcm':
      return 'MCM';
    default:
      return String(mode).toUpperCase();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderProgressBar(pct, width = 24) {
  const normalized = clamp(Number.isFinite(pct) ? pct : 0, 0, 100);
  const filled = Math.round((normalized / 100) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}] ${normalized.toFixed(0).padStart(3, ' ')}%`;
}

function truncateText(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 1) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function createProgressRenderer() {
  const interactive = Boolean(process.stdout.isTTY && process.stderr.isTTY);
  let renderedLineCount = 0;
  let totalScenarios = 0;
  let completedScenarios = 0;
  let currentScenario = null;
  let lastBackend = null;

  function clear() {
    if (!interactive || renderedLineCount === 0) {
      return;
    }
    process.stdout.write(`\x1b[${renderedLineCount}F`);
    for (let index = 0; index < renderedLineCount; index++) {
      process.stdout.write('\x1b[2K');
      if (index < renderedLineCount - 1) {
        process.stdout.write('\x1b[1B');
      }
    }
    process.stdout.write(`\x1b[${renderedLineCount - 1}F`);
    renderedLineCount = 0;
  }

  function emit(lines) {
    if (!interactive) {
      return;
    }
    clear();
    const joined = lines.join('\n');
    process.stdout.write(`${joined}\n`);
    renderedLineCount = lines.length;
  }

  function render() {
    if (!interactive || !currentScenario) {
      return;
    }
    const scenarioPct = clamp(currentScenario.pct ?? 0, 0, 100);
    const overallPct = totalScenarios > 0
      ? ((completedScenarios + scenarioPct / 100) / totalScenarios) * 100
      : 0;
    const totalLine =
      `Total    ${renderProgressBar(overallPct)}  ` +
      `${Math.min(completedScenarios + 1, totalScenarios)}/${totalScenarios}  ` +
      `${currentScenario.index + 1 < totalScenarios ? 'running' : 'finishing'}`;
    const currentHeader =
      `Current  ${formatModeShort(currentScenario.mode)}  ${currentScenario.fixture}  ` +
      `${currentScenario.index + 1}/${totalScenarios}`;
    const stageText = truncateText(
      `${currentScenario.stage ?? 'Working'}${currentScenario.detail ? ` - ${currentScenario.detail}` : ''}`,
      120
    );
    const currentLine = `${renderProgressBar(scenarioPct)}  ${stageText}`;
    const backendLine = lastBackend
      ? `Backend  actual=${formatAccelerationBackend(lastBackend.backend)}  requested=${formatRequestedAcceleration(lastBackend.accelerationMode)}`
      : `Backend  requested=${formatRequestedAcceleration(accelerationFilter ?? 'wasm')}`;
    emit([totalLine, currentHeader, currentLine, backendLine]);
  }

  function log(message) {
    if (interactive) {
      clear();
    }
    console.log(message);
    render();
  }

  return {
    startScenario(scenario, index, total) {
      totalScenarios = total;
      currentScenario = {
        fixture: scenario.fixture,
        mode: scenario.mode,
        index,
        pct: 0,
        stage: 'Queued',
        detail: '',
      };
      lastBackend = null;
      render();
    },
    updateProgress(payload) {
      if (!currentScenario || payload.fixture !== currentScenario.fixture) {
        return false;
      }
      currentScenario = {
        ...currentScenario,
        pct: payload.pct ?? currentScenario.pct,
        stage: payload.stage ?? currentScenario.stage,
        detail: payload.detail ?? currentScenario.detail,
      };
      render();
      return true;
    },
    updateBackend(payload) {
      if (!currentScenario || payload.fixture !== currentScenario.fixture) {
        return false;
      }
      lastBackend = payload;
      render();
      return true;
    },
    finishScenario(result) {
      const summaries = Object.values(result.summaries).filter(Boolean);
      const summary = summaries[0] ?? null;
      const mode = currentScenario?.mode ?? Object.keys(result.summaries).find(key => result.summaries[key]) ?? 'unknown';
      const fixture = currentScenario?.fixture ?? result.fixture;
      const backend = summary?.accelerationBackend ? formatAccelerationBackend(summary.accelerationBackend) : 'unknown';
      const elapsedMs = summary?.conversionMs ?? result.elapsedMs;
      completedScenarios += 1;
      currentScenario = null;
      lastBackend = null;
      if (interactive) {
        clear();
      }
      console.log(
        `Completed ${formatModeShort(mode)} ${fixture} in ${(elapsedMs / 1000).toFixed(2)}s` +
        ` (${backend}) ${completedScenarios}/${totalScenarios}`
      );
    },
    log,
    flush() {
      clear();
    },
    isInteractive() {
      return interactive;
    },
  };
}

function safeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'gallery';
}

function resolveGallerySource() {
  if (gallerySource === 'baselines') {
    return {
      label: 'Accepted Baselines',
      sourceRoot: baselineDir,
      previewPrefix: '../baselines',
      modeDirPrefix: '../baselines',
    };
  }

  const sourceName = gallerySource;
  return {
    label: `Output: ${sourceName}`,
    sourceRoot: path.resolve(outputRoot, sourceName),
    previewPrefix: sourceName,
    modeDirPrefix: sourceName,
  };
}

async function generateGalleryHtml(scenarios) {
  const source = resolveGallerySource();
  const rows = [];

  for (const scenario of scenarios) {
    const fixtureName = path.parse(scenario.fixture).name;
    const summaryPath = path.resolve(source.sourceRoot, scenario.mode, fixtureName, 'summary.json');
    const previewPath = path.resolve(source.sourceRoot, scenario.mode, fixtureName, 'preview.png');

    let summary = null;
    try {
      summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    } catch {
      summary = null;
    }

    rows.push({
      fixture: scenario.fixture,
      fixtureName,
      mode: scenario.mode,
      summary,
      previewExists: Boolean(summary),
      previewSrc: `${source.previewPrefix}/${scenario.mode}/${fixtureName}/preview.png`,
      sourceSrc: `../fixtures/${scenario.fixture}`,
    });
  }

  const grouped = new Map();
  for (const row of rows) {
    const existing = grouped.get(row.fixture) ?? [];
    existing.push(row);
    grouped.set(row.fixture, existing);
  }

  const fixtureSections = [...grouped.entries()].map(([fixture, fixtureRows]) => {
    const orderedRows = fixtureRows.sort((a, b) => modeIds().indexOf(a.mode) - modeIds().indexOf(b.mode));
    let html = '<section class="fixture">';
    html += `<div class="fixture-head"><h2>${safeHtml(fixture)}</h2></div>`;
    html += '<div class="fixture-grid">';
    html += `<div class="card source-card"><img src="../fixtures/${safeHtml(fixture)}" alt="Source"><div class="card-title">Source</div></div>`;

    for (const row of orderedRows) {
      html += '<div class="card result-card">';
      if (row.previewExists) {
        html += `<img src="${safeHtml(row.previewSrc)}" alt="${safeHtml(formatModeLabel(row.mode))}">`;
      } else {
        html += '<div class="missing">Missing</div>';
      }
      html += `<div class="card-title">${safeHtml(formatModeLabel(row.mode))}</div>`;
      if (row.summary) {
        html += '<table class="card-table">';
        html += `<tr><td class="cl">bg</td><td>${safeHtml(row.summary.backgroundColor)}</td></tr>`;
        html += `<tr><td class="cl">charset</td><td>${safeHtml(row.summary.charset)}</td></tr>`;
        if (row.summary.ecmBgColors && row.summary.ecmBgColors.length > 0) {
          html += `<tr><td class="cl">ecm bgs</td><td>[${safeHtml(row.summary.ecmBgColors.join(', '))}]</td></tr>`;
        }
        if (row.summary.mcmSharedColors && row.summary.mcmSharedColors.some(color => color > 0)) {
          html += `<tr><td class="cl">mcm shared</td><td>[${safeHtml(row.summary.mcmSharedColors.join(', '))}]</td></tr>`;
        }
        if (row.summary.conversionMs != null) {
          html += `<tr><td class="cl">time ms</td><td>${safeHtml(row.summary.conversionMs.toFixed(2))}</td></tr>`;
        }
        if (row.summary.conversionSeconds != null) {
          html += `<tr><td class="cl">time s</td><td>${safeHtml(row.summary.conversionSeconds.toFixed(3))}</td></tr>`;
        }
        if (row.summary.accelerationBackend) {
          html += `<tr><td class="cl">backend</td><td>${safeHtml(formatAccelerationBackend(row.summary.accelerationBackend))}</td></tr>`;
        }
        if (row.summary.profileId) {
          html += `<tr><td class="cl">profile</td><td>${safeHtml(row.summary.profileId)}</td></tr>`;
        }
        if (row.summary.imageQuality) {
          const quality = row.summary.imageQuality;
          html += `<tr><td class="cl">SSIM</td><td>${safeHtml(quality.ssim.toFixed(3))}</td></tr>`;
          html += `<tr><td class="cl">meanΔE</td><td>${safeHtml(quality.meanDeltaE.toFixed(4))}</td></tr>`;
          html += `<tr><td class="cl">p95ΔE</td><td>${safeHtml(quality.percentile95DeltaE.toFixed(4))}</td></tr>`;
        }
        html += '</table>';
      } else {
        html += '<div class="missing-meta">No summary.json found for this mode.</div>';
      }
      html += '</div>';
    }

    html += '</div>';
    html += '</section>';
    return html;
  }).join('\n');

  const reportName = runName ?? `${slugify(gallerySource)}-gallery`;
  const reportPath = path.resolve(outputRoot, `${reportName}.html`);
  const timestamp = new Date().toISOString().slice(0, 19);
  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>TRUSKI3000 Gallery</title>',
    '<style>',
    '* { box-sizing: border-box; }',
    'body { margin: 0; padding: 24px; background: #16181c; color: #e9edf1; font-family: system-ui, sans-serif; }',
    'h1 { margin: 0 0 6px; font-size: 1.45rem; }',
    '.subtitle { margin: 0 0 24px; color: #98a2ad; font-size: 0.92rem; }',
    '.fixture { margin-bottom: 28px; padding-bottom: 28px; border-bottom: 1px solid #2b3037; }',
    '.fixture-head { margin-bottom: 12px; }',
    '.fixture-head h2 { margin: 0; font-size: 1.05rem; }',
    '.fixture-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; align-items: start; }',
    '.card { background: #1e232a; border: 1px solid #2d333c; border-radius: 10px; overflow: hidden; min-height: 100%; }',
    '.card img { width: 100%; aspect-ratio: 320 / 200; object-fit: cover; display: block; image-rendering: pixelated; background: #0f1114; }',
    '.card-title { padding: 10px 12px 0; font-weight: 700; font-size: 0.95rem; }',
    '.card-table { width: 100%; border-collapse: collapse; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; margin: 8px 0 12px; }',
    '.card-table td { padding: 2px 12px; vertical-align: top; }',
    '.card-table .cl { width: 78px; color: #98a2ad; }',
    '.source-card { background: #15191f; }',
    '.missing, .missing-meta { color: #98a2ad; padding: 24px 12px; }',
    '.missing { min-height: 200px; display: grid; place-items: center; font-weight: 600; }',
    '</style>',
    '</head>',
    '<body>',
    '<h1>TRUSKI3000 Mode Gallery</h1>',
    `<p class="subtitle">Generated ${safeHtml(timestamp)} | Source set: ${safeHtml(source.label)} | Modes: Standard, ECM, MCM</p>`,
    fixtureSections,
    '</body>',
    '</html>',
  ].join('\n');

  await writeFile(reportPath, html, 'utf8');
  console.log('Gallery: ' + reportPath);
  return reportPath;
}

async function generateComparisonHtml(scenarios) {
  const uniqueModes = [...new Set(scenarios.map(scenario => scenario.mode))];
  const modeSuffix = uniqueModes.length === 1 ? uniqueModes[0] : 'multimode';
  const reportBaseName = outputDirName === 'latest' ? 'baselines' : outputDirName;
  const reportFileName = `${reportBaseName}_${modeSuffix}.html`;
  const reportPath = path.resolve(outputRoot, reportFileName);
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
    const display = lowerBetter ? -d : d;
    const sign = display > 0 ? '+' : '';
    const cls = good ? 'better' : 'worse';
    return '<span class="' + cls + '">(' + sign + display.toFixed(4) + ')</span>';
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
      if (summary.conversionMs != null) {
        s += '<tr><td class="cl">time ms</td><td>' + summary.conversionMs.toFixed(2) + '</td></tr>';
      }
      if (summary.conversionSeconds != null) {
        s += '<tr><td class="cl">time s</td><td>' + summary.conversionSeconds.toFixed(3) + '</td></tr>';
      }
      if (summary.accelerationBackend) {
        s += '<tr><td class="cl">rendered by</td><td>' + formatAccelerationBackend(summary.accelerationBackend) + '</td></tr>';
      }
      if (summary.accelerationMode) {
        s += '<tr><td class="cl">request</td><td>' + formatAccelerationMode(summary.accelerationMode) + '</td></tr>';
      }
      if (summary.profileId) {
        s += '<tr><td class="cl">profile</td><td>' + summary.profileId + '</td></tr>';
      }
      if (summary.effectiveSettings) {
        s += '<tr><td class="cl">settings</td><td>' + summarizeSettingsForDisplay(summary.effectiveSettings) + '</td></tr>';
      }
      if (summary.objectiveFingerprint) {
        s += '<tr><td class="cl">objective</td><td>' + String(summary.objectiveFingerprint).slice(0, 12) + '</td></tr>';
      }
      const q = summary.imageQuality;
      if (q) {
        s += '<tr><td class="cl">SSIM</td><td>' + q.ssim.toFixed(3) + '</td></tr>';
        s += '<tr><td class="cl">cellSSIM</td><td>' + (q.cellSSIM ?? 0).toFixed(3) + '</td></tr>';
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
    html += '<h2>' + formatModeLabel(row.mode) + ' / ' + row.fixture + '</h2>';
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
      html += metricRow('cellSSIM', lq.cellSSIM ?? 0, bq.cellSSIM ?? 0, 3, false);
      html += metricRow('lumaRMSE', lq.lumaRMSE, bq.lumaRMSE, 4, true);
      html += metricRow('chromaRMSE', lq.chromaRMSE, bq.chromaRMSE, 4, true);
      html += metricRow('meanDeltaE', lq.meanDeltaE, bq.meanDeltaE, 4, true);
      html += metricRow('p95DeltaE', lq.percentile95DeltaE, bq.percentile95DeltaE, 4, true);
      html += metricRow('conversionMs', row.latest?.conversionMs, row.baseline?.conversionMs, 2, true);
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
    '<p class="subtitle">Generated ' + timestamp + ' | Baseline vs Latest | Latest cards show the actual render backend when available</p>',
    scenarioHtml,
    '</body>',
    '</html>',
  ].join('\n');

  await writeFile(reportPath, html, 'utf8');
  console.log('Visual comparison: ' + reportPath);
  return reportPath;
}

async function compareAgainstBaselines() {
  const failures = [];
  const warnings = [];

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
        const latestSummary = JSON.parse(latestSummaryBuf.toString('utf8'));
        const baselineSummary = JSON.parse(baselineSummaryBuf.toString('utf8'));
        const provenance = compareSummaryProvenance(latestSummary, baselineSummary);
        const provenanceMismatch = provenance.status === 'mismatch';
        const summaryMatches =
          JSON.stringify(stripVolatileSummaryFields(latestSummary)) ===
          JSON.stringify(stripVolatileSummaryFields(baselineSummary));

        if (provenanceMismatch) {
          failures.push(`${mode}/${fixtureName}: provenance mismatch (${provenance.detail}); compare gate invalid`);
        } else if (!summaryMatches) {
          const suffix = provenance.status === 'legacy'
            ? ` (${provenance.detail}; summary mismatch may reflect old baselines rather than a regression)`
            : '';
          failures.push(`${mode}/${fixtureName}: summary mismatch${suffix}`);
        }
        if (!provenanceMismatch && !latestPreview.equals(baselinePreview)) {
          const suffix = provenance.status === 'legacy'
            ? ` (${provenance.detail}; preview mismatch may reflect old baselines rather than a regression)`
            : '';
          failures.push(`${mode}/${fixtureName}: preview mismatch${suffix}`);
        }
        if (provenance.status === 'legacy') {
          warnings.push(`${mode}/${fixtureName}: ${provenance.detail}`);
        }

        // Show quality score changes regardless of pass/fail
        try {
          if (latestSummary.imageQuality && baselineSummary.imageQuality) {
            const lq = latestSummary.imageQuality;
            const bq = baselineSummary.imageQuality;
            const ssimDelta = lq.ssim - bq.ssim;
            const cellSSIMDelta = (lq.cellSSIM ?? 0) - (bq.cellSSIM ?? 0);
            const chromaDelta = lq.chromaRMSE - bq.chromaRMSE;
            const lumaDelta = lq.lumaRMSE - bq.lumaRMSE;
            const deltaEDelta = lq.meanDeltaE - bq.meanDeltaE;
            const p95Delta = lq.percentile95DeltaE - bq.percentile95DeltaE;
            const timeDelta = (latestSummary.conversionMs ?? 0) - (baselineSummary.conversionMs ?? 0);
            const changed = !summaryMatches || !latestPreview.equals(baselinePreview);
            const tag = provenanceMismatch
              ? 'PROVENANCE'
              : provenance.status === 'legacy'
              ? 'LEGACY'
              : changed
              ? 'CHANGED'
              : 'OK';
            console.log(
              `  ${mode}/${fixtureName} [${tag}]: ` +
              `SSIM (${formatDelta(ssimDelta)}) ` +
              `cellSSIM (${formatDelta(cellSSIMDelta)}) ` +
              `lumaRMSE (${formatDelta(lumaDelta, true)}) ` +
              `chromaRMSE (${formatDelta(chromaDelta, true)}) ` +
              `meanΔE (${formatDelta(deltaEDelta, true)}) ` +
              `p95ΔE (${formatDelta(p95Delta, true)}) ` +
              `timeMs (${formatDelta(timeDelta, true)})` +
              (tag === 'PROVENANCE' || tag === 'LEGACY' ? ` provenance=${provenance.detail}` : '')
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

  if (warnings.length > 0) {
    console.warn('TRUSKI3000 harness compare warnings:');
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
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
  if (command === 'gallery') {
    const scenarios = await listScenarios();
    await generateGalleryHtml(scenarios);
    return;
  }

  await syncFixturesToPublic();
  await rm(latestOutputDir, { recursive: true, force: true });
  await mkdir(latestOutputDir, { recursive: true });
  if (!skipBuild) {
    await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
  } else {
    console.log('Skipping build step and reusing existing dist/assets.');
  }

  const { child: harnessServer, readyUrl } = startHarnessServer(serverMode);
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
  const progressRenderer = createProgressRenderer();

  try {
    const page = await browser.newPage();
    attachHarnessConsole(page, progressRenderer);
    await page.goto(harnessUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__TRUSKI_HARNESS__));

    const scenarios = await listScenarios();
    progressRenderer.log(`Harness server mode: ${serverMode}${skipBuild ? ' (reused build)' : ''}`);
    progressRenderer.log(`Harness acceleration request: ${formatRequestedAcceleration()}`);
    progressRenderer.log(`Harness scenario timeout: ${scenarioTimeoutMs > 0 ? `${scenarioTimeoutMs}ms` : 'disabled'}`);
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

    const selectedProfileId = profileFilter ?? 'current-defaults';
    const selectedProfile = getHarnessProfile(selectedProfileId);
    if (!selectedProfile) {
      throw new Error(`Unknown harness profile: ${selectedProfileId}`);
    }

    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      const extraOverrides = {};
      if (saliencyOverride !== null && !isNaN(saliencyOverride)) {
        extraOverrides.saliencyAlpha = saliencyOverride;
      }
      if (lumOverride !== null && !isNaN(lumOverride)) {
        extraOverrides.lumMatchWeight = lumOverride;
      }
      if (csfOverride !== null && !isNaN(csfOverride)) {
        extraOverrides.csfWeight = csfOverride;
      }
      const settings = resolveScenarioSettings(modeMatrix[scenario.mode], selectedProfileId, extraOverrides);
      const overrideLabel = [
        `profile=${selectedProfileId}`,
        saliencyOverride !== null ? `sal=${saliencyOverride}` : '',
        lumOverride !== null ? `lum=${lumOverride}` : '',
        csfOverride !== null ? `csf=${csfOverride}` : '',
      ].filter(Boolean).join(' ');
      progressRenderer.log(
        `Running ${scenario.mode} -> ${scenario.fixture} [${formatRequestedAcceleration()}]` +
        `${overrideLabel ? ' ' + overrideLabel : ''}`
      );
      progressRenderer.startScenario(scenario, scenarioIndex, scenarios.length);
      const result = await runHarnessFixture(
        page,
        scenario.fixture,
        settings,
        accelerationFilter ?? 'wasm',
        selectedProfile.id
      );
      progressRenderer.finishScenario(result);
      await writeRunArtifacts(result);
      printQualityScores(result);
      printCharacterUtilization(result);
    }

    await generateComparisonHtml(scenarios);
  } finally {
    progressRenderer.flush();
    await browser.close();
    stopHarnessServer();
  }

  if (command === 'record') {
    await recordBaselines();
    console.log(`Recorded baselines in ${baselineDir}`);
    return;
  }

  if (command === 'capture') {
    console.log(`Captured harness artifacts in ${latestOutputDir}`);
    return;
  }

  await compareAgainstBaselines();
  console.log('TRUSKI3000 harness compare passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
