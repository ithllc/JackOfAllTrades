import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMediaIngestMode,
  computeFrameMotionDelta,
  evaluateHesitationTrigger,
  evaluateDecisionsRouting,
  enforceScaleAnchorInvariant,
  InMemoryOntologyGraph,
  buildFeatureVector,
} from './routingLogic';

test('Test Case 1: downgrades from WebRTC video to 3-shot burst photography on 3G / high latency', () => {
  const result = evaluateMediaIngestMode({
    downlinkMbps: 0.65,
    rttMs: 420,
    thermalState: 'nominal',
    extremeVisualNoise: false,
    effectiveType: '3g',
  });

  assert.equal(result.mode, 'burst_photo_3x');
  assert.equal(result.requiresBurstCapture, true);
  assert.equal(result.targetFps, 0);
  assert.ok(result.voicePrompt && result.voicePrompt.toLowerCase().includes('burst'));
});

test('Hardest Input & Break 1: downgrades on extreme lens glare/water or serious thermal throttling', () => {
  const glareResult = evaluateMediaIngestMode({
    downlinkMbps: 25,
    rttMs: 32,
    thermalState: 'nominal',
    extremeVisualNoise: true,
    effectiveType: 'wifi',
  });
  assert.equal(glareResult.mode, 'burst_photo_3x');
  assert.ok(glareResult.voicePrompt?.includes('Wipe the lens'));

  const thermalResult = evaluateMediaIngestMode({
    downlinkMbps: 25,
    rttMs: 32,
    thermalState: 'serious',
    extremeVisualNoise: false,
    effectiveType: 'wifi',
  });
  assert.equal(thermalResult.mode, 'burst_photo_3x');
});

test('Break 1 / Test Case 3: Wasm motion gate stays quiet while moving and fires after >= 3s stillness', () => {
  const frameA = new Uint8Array(64).fill(100);
  const frameMoved = new Uint8Array(64).fill(180);
  const frameStill = new Uint8Array(64).fill(101);

  assert.ok(computeFrameMotionDelta(frameA, frameMoved) > 0.25);
  assert.ok(computeFrameMotionDelta(frameA, frameStill) < 0.01);

  let state = { stillMs: 0, triggered: false, lastMotionDelta: 0 };
  state = evaluateHesitationTrigger(state, 0.005, 1500);
  assert.equal(state.triggered, false);
  assert.equal(state.stillMs, 1500);

  // Active movement resets hesitation timer
  state = evaluateHesitationTrigger(state, 0.12, 500);
  assert.equal(state.stillMs, 0);
  assert.equal(state.triggered, false);

  // Stationary for 3.2 seconds fires trigger
  state = evaluateHesitationTrigger(state, 0.004, 1600);
  state = evaluateHesitationTrigger(state, 0.003, 1600);
  assert.equal(state.triggered, true);
  assert.equal(state.stillMs, 3200);
});

test('ADR 003 / Test Case 3: routes to gemini-4-neon ONLY on high-confidence Decisions API anomaly', () => {
  const nominal = evaluateDecisionsRouting({
    userStalled: 0.22,
    hazardProximity: 0.05,
    alignmentAnomaly: 0.18,
    visualNoiseExtreme: 0.11,
    cameraFocused: 0.94,
    objectInFrame: 0.91,
  });
  assert.equal(nominal.shouldEscalateToNeon, false);
  assert.equal(nominal.dominantTrigger, 'nominal');

  const stalled = evaluateDecisionsRouting({
    userStalled: 0.91,
    hazardProximity: 0.12,
    alignmentAnomaly: 0.34,
    visualNoiseExtreme: 0.08,
    cameraFocused: 0.92,
    objectInFrame: 0.95,
  });
  assert.equal(stalled.shouldEscalateToNeon, true);
  assert.equal(stalled.dominantTrigger, 'user_stalled');

  const noisy = evaluateDecisionsRouting({
    userStalled: 0.85,
    hazardProximity: 0.10,
    alignmentAnomaly: 0.40,
    visualNoiseExtreme: 0.88,
    cameraFocused: 0.19,
    objectInFrame: 0.72,
  });
  assert.equal(noisy.shouldDowngradeToBurst, true);
  assert.equal(noisy.shouldEscalateToNeon, false);
});

test('Break 2: Scale Anchor Guard bars exact tool sizes without WebXR depth or physical anchor', () => {
  const blocked = enforceScaleAnchorInvariant(
    {
      toolRequired: 'Metric Socket Wrench',
      toolSizeSpec: '10mm metric socket (NOT 3/8")',
      requiresScaleAnchor: true,
      instructionText: 'Tighten M10 bolt with 10mm socket.',
    },
    'none',
    false
  );
  assert.equal(blocked.scaleGuardBlocked, true);
  assert.ok(blocked.toolSizeSpec.includes('Scale anchor required'));
  assert.ok(blocked.anchorPrompt?.includes('coin'));

  const unlocked = enforceScaleAnchorInvariant(
    {
      toolRequired: 'Metric Socket Wrench',
      toolSizeSpec: '10mm metric socket (NOT 3/8")',
      requiresScaleAnchor: true,
      instructionText: 'Tighten M10 bolt with 10mm socket.',
    },
    'us_quarter',
    false
  );
  assert.equal(unlocked.scaleGuardBlocked, false);
  assert.equal(unlocked.toolSizeSpec, '10mm metric socket (NOT 3/8")');
});

test('ADR 001 & Test Case 2: Recursive CTE tree traversal + M4/M6 embedding correction lifts RAG rank immediately', () => {
  const graph = new InMemoryOntologyGraph();

  // Verify Recursive CTE top-down hierarchy from Cabinet Door Assembly (id=1 -> id=2 -> id=3)
  const tree = graph.getHierarchyTree(1);
  assert.equal(tree.length, 3);
  assert.equal(tree[2].name, 'M4 Machine Screw (Hinge Plate)');
  assert.equal(tree[2].depth, 2);
  assert.equal(
    tree[2].breadcrumbPath,
    'Cabinet Door Assembly > 110-Deg Concealed Hinge Arm > M4 Machine Screw (Hinge Plate)'
  );

  // Test Case 2: Ambiguous close-up screw observation initially matches M6 (id=4) higher than M4 (id=3)
  const ambiguousScrewScan = buildFeatureVector([0.14, 0.16, 0.87, 0.43, 0.10, 0.07, 0.06, 0.09]);
  const beforeMatches = graph.searchRagSubgraph(ambiguousScrewScan, 'us_quarter', false, 2);
  assert.equal(beforeMatches[0].component.id, 4); // M6 initially wins

  // User taps bounding box and corrects M6 -> M4 (id=3)
  graph.applyCorrection({
    predictedComponentId: 4,
    correctedComponentId: 3,
    capturedEmbedding: ambiguousScrewScan,
    tag: 'M4_not_M6',
    regionCode: 'US-CHI',
  });

  // Next scan of the exact same screw by a different user now retrieves M4 #1 via RAG
  const afterMatches = graph.searchRagSubgraph(ambiguousScrewScan, 'us_quarter', false, 2);
  assert.equal(afterMatches[0].component.id, 3);
  assert.equal(afterMatches[0].component.name, 'M4 Machine Screw (Hinge Plate)');
});
