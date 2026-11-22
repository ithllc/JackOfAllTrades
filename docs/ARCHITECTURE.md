# Jack of All Trades — System Architecture Blueprint

**License:** GNU Affero General Public License v3.0 (`AGPL-3.0-only`)  
**Brand Mark:** Jack of Spades playing card emblem with the Jack holding a claw hammer (`BrandMark.tsx` / `public/icon.svg`)  
**Target Platform:** Progressive Web App (PWA) on Google Cloud Run + Cloud SQL for PostgreSQL (`pgvector`)  
**AI Stack:** Gemini Decisions API (`gemini-decision-1`) · `gemini-4-neon` · `gemini-3.8-flash-lite-tts` · `gemini-omni-1.2-flash` · `gemini-embedding-2`

---

## 1. End-to-End System Topology (ADR 001 – ADR 007)

```mermaid
flowchart TB
    subgraph Client["Jack of All Trades Universal PWA Client (iOS Safari · Android Chrome · WebXR Glasses)"]
        DEMO["Interactive DemoMode\nFirst-Visit Safe Onboarding"]
        CAM["MediaDevices API\nFull-Screen Magic Window Camera + Torch"]
        MIC["Push-to-Talk MediaRecorder\nHold to Explain (WebM Opus / MP4)"]
        NET["Adaptive Ingest Controller\nBandwidth / Thermal / Glare Guard"]
        WASM["Client-Side Wasm Motion Detector\n3-Second Hesitation Gate (-85% API Calls)"]
        RING["15-Second Rolling Frame Buffer\n(5-15 fps Video or 3x High-Contrast Burst)"]
        ANCHOR["WebXR Depth & Scale Anchor Guard\n(Coin / Credit Card / Thumb)"]
        PIP["Spatial & Audio Output Layer\nAuto-Play WAV Audio + Bounding Boxes + PiP Loop"]
    end

    subgraph CloudRun["Google Cloud Run (Stateless Node.js / Express · Port 8080)"]
        SIG["WebRTC Signaling & Session Controller"]
        PROXY["Gemini Routing Proxy\nPOST /api/analyze-buffer"]
        VOICEAPI["Multilingual Two-Way Voice Proxy\nPOST /api/voice-assist"]
        PIPAPI["PiP Video Endpoint\nPOST /api/generate-pip"]
        FBAPI["Ontology Feedback Endpoint\nPOST /api/ontology/feedback"]
    end

    subgraph Gemini4["Google Gemini 4 API Stack (@google/genai)"]
        DEC["The Router: gemini-decision-1\n(Decisions API · v1beta · 0 Output Tokens)"]
        NEON["The Brain: gemini-4-neon\n(Multimodal Vision + Audio Language Detection + RAG)"]
        TTS["The Voice: gemini-3.8-flash-lite-tts\n(Dynamic BCP-47 Same-Language WAV Synthesis)"]
        OMNI["The Motion Output: gemini-omni-1.2-flash\n(On-the-Fly PiP Motion Video Loop)"]
        EMB["Embeddings: gemini-embedding-2\n(768-dim Visual Signature Vectors)"]
    end

    subgraph CloudSQL["Google Cloud SQL — PostgreSQL 16 + pgvector (ADR 001)"]
        COMP["components Table\nparent_id Recursive CTE + vector(768) HNSW"]
        EDGES["component_edges Table\noften_confused_with · fastens_into"]
        ACT["repair_actions Table\nrequires_scale_anchor Guard (Break 2)"]
        BOUNTY["deflection_bounties & feedback_events\nData + $30 B2B2C Revenue Flywheel"]
    end

    DEMO -->|First-Visit Complete| CAM
    CAM --> NET
    NET -->|High Bandwidth & Cool| WASM
    NET -->|3G / Thermal / Extreme Glare| RING
    WASM -->|Hand Stalled >= 3s| RING
    ANCHOR --> RING
    RING -->|HTTPS POST 15s Buffer| PROXY

    MIC -->|Audio Blob + Current Visual Buffer| VOICEAPI
    RING -.->|Current Frame Context| VOICEAPI
    VOICEAPI -->|1. Inline Audio + Image + JSON Schema| NEON
    NEON -->|2. detectedLanguageCode + <3 Sentence Reply| TTS
    TTS -->|3. 24kHz RIFF WAV + X-MakerLens-Language Headers| PIP

    PROXY -->|1. Always Gate First| DEC
    DEC -->|Nominal / No Anomaly| PROXY
    DEC -->|Visual Noise Extreme| NET
    DEC -->|High-Confidence Anomaly| COMP
    COMP -->|Recursive CTE + pgvector RAG| NEON
    NEON -->|Grounded Diagnosis + Scale-Safe Action| PIP
    PIPAPI --> OMNI --> PIP

    PIP -->|User Taps Box: M4 not M6| FBAPI
    FBAPI --> EMB --> COMP
    FBAPI --> BOUNTY
    SIG -.->|SDP / ICE Signaling| CAM
```

---

## 2. Zero-Token Decision Routing & 15-Second Buffer Sequence (ADR 003 · Test Case 3)

Continuous 1080p video streaming into a heavy reasoning model causes mobile browser thermal throttling (Break 1) and excessive token spend. Jack of All Trades gates every continuous-scan inference call through three progressively heavier tiers:

1. **Tier 0 (On-Device Wasm Motion Detector):** Computes grayscale pixel delta at 2 Hz. Stays silent while hands are actively moving; emits a trigger only after ≥3.0 seconds of stillness (hesitation) or explicit user tap.
2. **Tier 1 (`gemini-decision-1` — Zero Output Tokens):** Evaluates the 15-second ring buffer with parallel calibrated `noul` checks (`user_stalled`, `hazard_proximity`, `alignment_anomaly`, `visual_noise_extreme`). Produces `0` output tokens.
3. **Tier 2 (`gemini-4-neon` + PostgreSQL RAG):** Wakes **only** when Tier 1 crosses the high-confidence anomaly threshold (`>= 0.78`). Enforces the **Scale Anchor Invariant (Break 2)** before emitting tool sizes.

```mermaid
sequenceDiagram
    autonumber
    participant User as User (Jack of All Trades PWA)
    participant Wasm as Client Wasm Motion Gate
    participant API as Cloud Run Express Proxy
    participant Dec as gemini-decision-1 (v1beta)
    participant PG as PostgreSQL + pgvector
    participant Neon as gemini-4-neon
    participant Omni as gemini-omni-1.2-flash

    User->>Wasm: Live WebRTC stream (5-15 fps) into 15s ring buffer
    Wasm->>Wasm: Hands stationary for >= 3.0s (pixel delta < 2.2%)
    Wasm->>API: POST /api/analyze-buffer (15s frames + scaleAnchor + networkMetrics)

    API->>Dec: ai.decisions.create(model="gemini-decision-1", parallel noul checks)
    Dec-->>API: { user_stalled: 0.91, hazard_proximity: 0.14, visual_noise_extreme: 0.12 } (0 output tokens)

    alt visual_noise_extreme >= 0.78 (Glare / Water / Blur)
        API-->>User: Instruct downgrade -> 3-Shot High-Contrast Burst Mode + Voice Prompt
    else No High-Confidence Anomaly (< 0.78)
        API-->>User: 200 OK { escalated: false, status: "nominal_zero_token" }
    else High-Confidence Anomaly (>= 0.78)
        API->>PG: rag_search_ontology_subgraph(embedding, has_scale_anchor) via Recursive CTE + HNSW
        PG-->>API: Grounded Subgraph + Failure Precursors (Tool sizes redacted if no anchor)
        API->>Neon: ai.interactions.create(model="gemini-4-neon", 15s buffer + RAG context)
        Neon-->>API: Diagnosis + Bounding Boxes + Next Step + PiP Motion Prompt
        API-->>User: Render Bounding Boxes & Spoken Step
        opt User requests visual hand-motion loop
            User->>API: POST /api/generate-pip
            API->>Omni: ai.interactions.create(model="gemini-omni-1.2-flash", response_format={type:"video"})
            Omni-->>API: MP4 PiP Motion Loop
            API-->>User: Display Picture-in-Picture Guidance Overlay
        end
    end
```

---

## 3. Native Two-Way Multilingual Voice Pipeline (ADR 004)

Jack of All Trades enables hands-free troubleshooting in any language through the **"Hold to Explain"** push-to-talk control on the Magic Window camera UI (`LiveCameraView.tsx` / `App.jsx`). The backend (`POST /api/voice-assist` in `server.ts` and `server.js`) automatically detects the exact spoken language from the raw microphone audio and synthesizes the spoken mechanic response in that same language—never forcing English.

### Encoding, Detection & Synthesis Flow

1. **Client Capture & Base64 Packaging:** While held, `MediaRecorder` records the user's microphone using the best supported codec (`audio/webm;codecs=opus` → `audio/mp4` → `audio/ogg;codecs=opus` via `pickBestRecorderMimeType`). On release, the client converts the recorded `Blob` into a Base64 string alongside the current JPEG camera frame(s) and `preferredLanguage: navigator.language` (used **only** as a fallback if the clip contains silence or unintelligible noise).
2. **Server Validation & Normalization (`src/lib/audioUtils.ts`):** `stripAudioDataUrl` and `normalizeAudioMimeType` strip codec suffixes (e.g., `audio/webm;codecs=opus` → `audio/webm`) and `validateAudioPayload` enforces a 10 MB ceiling and minimum clip length.
3. **Multimodal Reasoning + Language Identification (`gemini-4-neon`):** Sends the inline audio part (`{ type: 'audio', data, mime_type }`) and visual frame parts (`{ type: 'image', data, mime_type }`) with `EXPERT_MECHANIC_SYSTEM_PROMPT` and a strict JSON Schema `response_format` returning:
   - `speechDetected` (boolean distinguishing audible human speech from silence/noise so silent clips never hallucinate English repairs)
   - `userTranscript` (verbatim transcript in the original spoken language to ground language detection)
   - `detectedLanguageCode` (BCP-47 tag, e.g., `es-ES`, `fr-FR`, `ja-JP`, `pt-BR`)
   - `detectedLanguageName` (human-readable label, e.g., `Spanish`, `Japanese`)
   - `spokenResponse` (direct, actionable mechanic advice in that exact language)
4. **BCP-47 Normalization & Multilingual Sentence Cap:** `normalizeBcp47Language` standardizes bare ISO-639-1 codes (`es` → `es-ES`), underscore locales (`es_MX` → `es-MX`), and script subtags (`zh-Hans-CN` → `zh-CN`). `enforceThreeSentenceCap` strips markdown and limits output to ≤3 sentences across Latin, CJK (`。！？`), Arabic (`؟`), and Devanagari (`।`) scripts.
5. **Same-Language Speech Synthesis (`gemini-3.8-flash-lite-tts`):** Invokes `ai.interactions.create` with `response_format: { type: 'audio' }` and `generation_config: { speech_config: [{ language: detectedLanguageCode, voice: 'Kore' }] }`, yielding a 24 kHz mono 16-bit RIFF WAV buffer.
6. **Binary Audio Streaming & Playback:** When the client sends `Accept: audio/wav`, Express pipes the binary WAV directly back with metadata headers (`X-MakerLens-Language`, `X-MakerLens-Language-Name`, `X-MakerLens-Transcript`). The PWA wraps the binary `Blob` in `URL.createObjectURL(...)`, auto-plays it through a hidden `<audio>` element, and displays a concise caption showing the detected language.

```mermaid
sequenceDiagram
    autonumber
    participant User as User (Hold to Explain)
    participant PWA as Jack of All Trades PWA (MediaRecorder + <audio>)
    participant API as Express POST /api/voice-assist
    participant Neon as gemini-4-neon (Structured JSON)
    participant TTS as gemini-3.8-flash-lite-tts

    User->>PWA: Press & hold mic button, speak in any language (e.g., Spanish)
    PWA->>PWA: MediaRecorder captures audio Blob + snapshots camera JPEG frame(s)
    User->>PWA: Release button
    PWA->>API: POST /api/voice-assist (Accept: audio/wav)<br/>{ audioBase64, audioMimeType, visualFrames[], preferredLanguage }

    API->>API: stripAudioDataUrl() + validateAudioPayload() (<= 10 MB)
    API->>Neon: ai.interactions.create(model="gemini-4-neon")<br/>inline audio + image parts + JSON Schema response_format
    Neon-->>API: { detectedLanguageCode: "es-ES", detectedLanguageName: "Spanish", spokenResponse: "..." }

    API->>API: normalizeBcp47Language("es-ES") + enforceThreeSentenceCap(spokenResponse)
    API->>TTS: ai.interactions.create(model="gemini-3.8-flash-lite-tts")<br/>response_format={type:"audio"}, speech_config=[{language:"es-ES", voice:"Kore"}]
    TTS-->>API: Base64 24kHz 16-bit PCM RIFF WAV

    API-->>PWA: 200 OK (Content-Type: audio/wav)<br/>Headers: X-MakerLens-Language, X-MakerLens-Language-Name, X-MakerLens-Transcript
    PWA->>User: Auto-play binary WAV via <audio> + show "Speaking · Spanish" caption
```

---

## 4. PostgreSQL Recursive CTE & `pgvector` Ontology Schema (ADR 001)

```mermaid
erDiagram
    BRANDS ||--o{ MANUALS : sponsors
    MANUALS ||--o{ COMPONENTS : defines
    COMPONENTS ||--o{ COMPONENTS : "parent_id (Recursive CTE)"
    COMPONENTS ||--o{ COMPONENT_EDGES : "often_confused_with / fastens_into"
    COMPONENTS ||--o{ REPAIR_ACTIONS : prescribes
    MANUALS ||--o{ DIAGNOSTIC_SESSIONS : guides
    DIAGNOSTIC_SESSIONS ||--o{ ONTOLOGY_FEEDBACK_EVENTS : records
    COMPONENTS ||--o{ ONTOLOGY_FEEDBACK_EVENTS : updates_embedding
    DIAGNOSTIC_SESSIONS ||--o| DEFLECTION_BOUNTIES : earns

    COMPONENTS {
        serial id PK
        int parent_id FK
        int manual_id FK
        varchar name
        numeric thread_pitch_mm
        numeric nominal_diameter_mm
        vector_768 visual_signature_embedding
        text failure_precursor_cue
        int correction_count
    }

    REPAIR_ACTIONS {
        serial id PK
        int component_id FK
        varchar action_type
        varchar tool_required
        varchar tool_size_spec
        boolean requires_scale_anchor
        numeric success_rate
    }

    DEFLECTION_BOUNTIES {
        bigserial id PK
        uuid session_id FK
        int brand_id FK
        numeric bounty_usd
        numeric compute_cost_usd
        numeric net_margin_multiple
    }
```

---

## 5. Data & B2B2C Revenue Flywheel (PRD §3)

```mermaid
flowchart LR
    A["User Struggles with Physical Assembly\n(e.g., Tokyo IKEA Hinge / M4 vs M6 Screw)"]
    B["Touchscreen Bounding-Box Correction\nTap 'Too small' or 'M4 not M6'"]
    C["POST /api/ontology/feedback\nUpdates pgvector Centroid + Confusion Edge"]
    D["Instant Global RAG Lift\n(Chicago User Gets Proactive WebXR Angle Overlay)"]
    E["Support Call / $150 Hardware Return Averted"]
    F["Brand Pays $30 Deflection Bounty\nvs ~$1.50-$2.00 Cloud Run + Gemini Compute (>15x Compute Margin)"]

    A --> B --> C --> D --> E --> F --> A
```

---

## 6. Multi-Step Repair State Machine, Scale Ratio AR Overlay & Per-Step PiP (ADR 005 & ADR 006)

Real-world hardware fixes frequently require 2–6 sequential physical operations (for example: releasing a locking clip, removing two mounting bolts, sliding a cover, and reseating a seal). Pre-generating `N` video clips upfront would add unacceptable latency and compute cost, while showing only a static bottom sheet obscures the live camera.

### Adopted Design
1. **Unified Structured Multi-Step Diagnosis (Scan Problem + Hold to Explain):** Both `POST /api/analyze-buffer` and `POST /api/voice-assist` instruct `gemini-4-neon` with `SCALE_CALIBRATION_PROMPT_GUIDE` (US Quarter `24.26 mm`, Credit Card `85.60 mm × 53.98 mm`, Adult Thumb `20.0 mm`, or ruler) to return:
   - `estimatedPartSizeMm` & `scaleMeasurementNote` proving pixel-ratio comparison against the visible anchor.
   - `targetBox` & `anchorBox` in normalized `0..1000` `[ymin, xmin, ymax, xmax]` coordinates (mapped via `normalizeBoxToPct()`).
   - Ordered `steps[]` (up to 6 steps), each carrying its own `title`, `detail`, `motionCue` (`rotate_cw`, `rotate_ccw`, `slide`, `lift`, `press`, `align`, `inspect`), optional step-specific `targetBox`, `toolNeeded`, and dedicated `pipMotionPrompt`.
2. **Strict No-Coin-Placement PiP Invariant:** `pipMotionPrompt` is validated both in the prompt and inside `buildHotspotFromDiagnosis()` so PiP videos **always** demonstrate the physical repair hand motion for the active step—never generic coin placement.
3. **On-Demand Per-Step PiP Video Caching:** When the user taps **Show Step N Motion**, the client calls `POST /api/generate-pip` using only that step's `pipMotionPrompt` + reference camera frame and caches the resulting video URL in `stepVideos[stepNumber]` (`Record<number, string>`). Switching back to an earlier step replays instantaneously with zero extra API calls.
4. **Live Spatial AR Overlay + Floating Mini-PiP (`SpatialRepairOverlay.tsx`):**
   - Renders the active step's corner-bracketed AR reticle + animated SVG directional motion cue directly on top of the live camera feed (`z-20`), plus a dashed emerald **Scale Anchor Verified Box** when calibrated.
   - `InstructionSheet` stays compact (`max-h-[56dvh]`) and provides a **View AR** toggle so the user can collapse the sheet into a slim step switcher bar while keeping the live AR reticle and a floating corner **Mini-PiP** video window pinned over the camera.

```mermaid
sequenceDiagram
    autonumber
    participant User as User (Mobile / Desktop PWA)
    participant AR as SpatialRepairOverlay + InstructionSheet
    participant API as Unified Cloud Run server.js
    participant Neon as gemini-4-neon
    participant Omni as gemini-omni-1.2-flash
    participant SQL as Cloud SQL (PostgreSQL 16 + pgvector)

    User->>API: Scan Problem OR Hold to Explain (frames + optional audio)
    API->>Neon: Prompt with SCALE_CALIBRATION_PROMPT_GUIDE (24.26mm quarter / 85.6mm card / 20mm thumb)
    Neon-->>API: { estimatedPartSizeMm, targetBox, anchorBox, steps[1..N] with per-step motionCue & pipMotionPrompt }
    API->>SQL: Auto-log diagnostic_sessions + embed (gemini-embedding-2) + match/insert components & repair_actions
    API-->>AR: Return diagnosis + scaleCalibration + sessionId + componentId + WAV speech
    AR->>User: Render Live AR Reticle + SVG Motion Arrow + Compact Multi-Step Sheet

    opt User taps "Show Step N Motion"
        User->>API: POST /api/generate-pip (Step N pipMotionPrompt + frame)
        API->>Omni: Generate 6s close-up repair hand-motion loop
        Omni-->>AR: Cache in stepVideos[N] + play inline or in Floating Mini-PiP
    end

    opt User taps "Done — This Fixed It!" or "Wrong Part or Size?"
        User->>API: POST /api/ontology/confirm-fix OR POST /api/ontology/feedback
        API->>SQL: Update diagnostic_sessions, repair_actions.success_rate, components.visual_signature_embedding & $30 bounty
    end
```

---

## 7. Architecture Decision Records & Engineering Mitigations

| ID | Architectural Problem | Adopted Design | Verification Standard |
| :--- | :--- | :--- | :--- |
| **ADR 001** | Graph traversal + multimodal RAG without Neo4j or stateful SQLite volumes | PostgreSQL 16 with Recursive CTEs (`WITH RECURSIVE`) and `pgvector` HNSW cosine indexes; dual-transport Cloud SQL resolver (`SQL_*` and `DB_*` aliases, `/cloudsql/` socket presence check + Public IP TLS fallback) | `schema.sql` functions `get_component_hierarchy` & `rag_search_ontology_subgraph`; unit tests (`dbConfig.test.ts`, `ontologyMapper.test.ts`) |
| **ADR 002** | Scale-to-zero serverless hosting & drift between dev `server.ts` and Cloud Run `server.js` | Single source of truth in `server.ts`, compiled by `esbuild` directly into `server.js` (ESM) in `Dockerfile` and repo so dev, Cloud Run, and `node server.js` expose identical routes (`/api/health`, `/api/ontology/*`, `/api/deliverables`) | `Dockerfile` multi-stage build + production `node server.js` smoke test |
| **ADR 003 / Break 1** | Continuous 1080p streaming caused iPhone Safari thermal dimming & API bloat | Client-side Wasm motion gate (3s stillness) → zero-token `gemini-decision-1` → conditional `gemini-4-neon` | QA Test Case 3 + unit tests (`routingLogic.test.ts`) |
| **ADR 004** | Hands-free voice queries from global users require same-language spoken mechanic guidance without forcing English | Two-stage pipeline at `POST /api/voice-assist`: `gemini-4-neon` structured JSON language detection + Scale Calibration + multi-step diagnosis → `normalizeBcp47Language` → `gemini-3.8-flash-lite-tts` returning binary 24 kHz RIFF WAV + structured repair guide | QA Test Case 4 + unit tests (`audioUtils.test.ts`, `scaleCalibration.test.ts`) |
| **ADR 005** | Multi-step repairs need visual hand-motion guidance without pre-generating N expensive PiP videos upfront | Per-step `pipMotionPrompt` + `motionCue` + `targetBox` returned in `steps[]`; client generates 6s `gemini-omni-1.2-flash` clips strictly on demand per step and caches them in `stepVideos[stepNumber]` with a floating Mini-PiP window | Unit tests (`makerLensState.test.ts`) + live browser stepper verification |
| **ADR 006 / Break 2** | "Scale" hallucination & hidden AR overlays covered by tall bottom sheets | Pixel-ratio measurement prompt (`24.26 mm` US quarter, `85.6 mm` card, `20 mm` thumb) returning `estimatedPartSizeMm`, `scaleMeasurementNote`, `targetBox`, and `anchorBox`, rendered via `<SpatialRepairOverlay/>` with animated directional SVG arrows and a compact sheet + **View AR** toggle | `resolveScaleCalibration()`, `normalizeBoxToPct()`, `SpatialRepairOverlay.tsx` |
| **ADR 007** | Admin Ontology stayed static unless operators manually inserted rows | Automatic Cloud SQL write-back (`recordLiveDiagnosisToCloudSql`) logging every live Scan & Voice session, embedding frames via `gemini-embedding-2`, auto-inserting newly discovered parts, plus in-camera **Done — This Fixed It!** (`POST /api/ontology/confirm-fix`) and **Wrong Part or Size?** (`POST /api/ontology/feedback`) | `ontologyMapper.test.ts` + live `/api/ontology/tree` PostgreSQL verification |
| **Hardest Input** | Water-smeared lens + chrome glare + spraying water under a kitchen sink | Automatic downgrade from WebRTC video to 3-shot high-contrast burst photography + voice instruction | QA Test Case 1 (3G throttling / visual noise fallback) |
| **UX Accessibility** | Technical camera telemetry overwhelms non-technical DIY users | Full-screen **Magic Window** UI (`LiveCameraView.tsx`) with only Scan, Push-to-Talk, and Flashlight controls + first-visit interactive `<DemoMode/>` | Unit tests (`makerLensState.test.ts`) + browser verification |


