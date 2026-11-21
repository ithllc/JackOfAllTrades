# JackOfAllTrades — System Architecture Blueprint

**License:** GNU Affero General Public License v3.0 (`AGPL-3.0-only`)  
**Target Platform:** Progressive Web App (PWA) on Google Cloud Run + Cloud SQL for PostgreSQL (`pgvector`)  
**AI Stack:** Gemini Decisions API (`gemini-decision-1`) · `gemini-4-neon` · `gemini-omni-1.2-flash` · `gemini-embedding-2`

---

## 1. End-to-End System Topology (ADR 001, ADR 002, ADR 003)

```mermaid
flowchart TB
    subgraph Client["Universal PWA Client (iOS Safari · Android Chrome · WebXR Glasses)"]
        CAM["MediaDevices API\nWebRTC Camera + Spatial Audio"]
        NET["Adaptive Ingest Controller\nBandwidth / Thermal / Glare Guard"]
        WASM["Client-Side Wasm Motion Detector\n3-Second Hesitation Gate (-85% API Calls)"]
        RING["15-Second Rolling Frame Buffer\n(5-15 fps Video or 3x High-Contrast Burst)"]
        ANCHOR["WebXR Depth & Scale Anchor Guard\n(Coin / Credit Card / Thumb)"]
        PIP["Spatial Output Layer\nPiP Motion Loop + Tap-to-Correct Bounding Boxes"]
    end

    subgraph CloudRun["Google Cloud Run (Stateless Node.js / Express · Port 8080)"]
        SIG["WebRTC Signaling & Session Controller"]
        PROXY["Gemini Routing Proxy\nPOST /api/analyze-buffer"]
        PIPAPI["PiP Video Endpoint\nPOST /api/generate-pip"]
        FBAPI["Ontology Feedback Endpoint\nPOST /api/ontology/feedback"]
    end

    subgraph Gemini4["Google Gemini 4 API Stack"]
        DEC["The Router: gemini-decision-1\n(Decisions API · v1beta · 0 Output Tokens)"]
        NEON["The Brain: gemini-4-neon\n(Multimodal Diagnosis + Manual RAG)"]
        OMNI["The Output: gemini-omni-1.2-flash\n(On-the-Fly PiP Motion Video Loop)"]
        EMB["Embeddings: gemini-embedding-2\n(768-dim Visual Signature Vectors)"]
    end

    subgraph CloudSQL["Google Cloud SQL — PostgreSQL 16 + pgvector (ADR 001)"]
        COMP["components Table\nparent_id Recursive CTE + vector(768) HNSW"]
        EDGES["component_edges Table\noften_confused_with · fastens_into"]
        ACT["repair_actions Table\nrequires_scale_anchor Guard (Break 2)"]
        BOUNTY["deflection_bounties & feedback_events\nData + $30 B2B2C Revenue Flywheel"]
    end

    CAM --> NET
    NET -->|High Bandwidth & Cool| WASM
    NET -->|3G / Thermal / Extreme Glare| RING
    WASM -->|Hand Stalled >= 3s| RING
    ANCHOR --> RING
    RING -->|HTTPS POST 15s Buffer| PROXY

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

Continuous 1080p video streaming into a heavy reasoning model causes mobile browser thermal throttling (Break 1) and excessive token spend. JackOfAllTrades gates every inference call through three progressively heavier tiers:

1. **Tier 0 (On-Device Wasm Motion Detector):** Computes grayscale pixel delta at 2 Hz. Stays silent while hands are actively moving; emits a trigger only after ≥3.0 seconds of stillness (hesitation) or explicit user tap.
2. **Tier 1 (`gemini-decision-1` — Zero Output Tokens):** Evaluates the 15-second ring buffer with parallel calibrated `noul` checks (`user_stalled`, `hazard_proximity`, `alignment_anomaly`, `visual_noise_extreme`). Produces `0` output tokens.
3. **Tier 2 (`gemini-4-neon` + PostgreSQL RAG):** Wakes **only** when Tier 1 crosses the high-confidence anomaly threshold (`>= 0.78`). Enforces the **Scale Anchor Invariant (Break 2)** before emitting tool sizes.

```mermaid
sequenceDiagram
    autonumber
    participant User as User (PWA Camera)
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
        API-->>User: Render WebXR Bounding Boxes & Audio Step
        opt User requests visual hand-motion loop
            User->>API: POST /api/generate-pip
            API->>Omni: ai.interactions.create(model="gemini-omni-1.2-flash", response_format={type:"video"})
            Omni-->>API: MP4 PiP Motion Loop
            API-->>User: Display Picture-in-Picture Guidance Overlay
        end
    end
```

---

## 3. PostgreSQL Recursive CTE & `pgvector` Ontology Schema (ADR 001)

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

## 4. Data & B2B2C Revenue Flywheel (PRD §3)

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

## 5. Architecture Decision Records & Engineering Mitigations

| ID | Architectural Problem | Adopted Design | Verification Standard |
| :--- | :--- | :--- | :--- |
| **ADR 001** | Graph traversal + multimodal RAG without Neo4j or stateful SQLite volumes | PostgreSQL 16 with Recursive CTEs (`WITH RECURSIVE`) and `pgvector` HNSW cosine indexes | `schema.sql` functions `get_component_hierarchy` & `rag_search_ontology_subgraph` |
| **ADR 002** | Scale-to-zero serverless hosting for WebRTC signaling + API proxy | Stateless Node.js/Express + Vite PWA container on Google Cloud Run (`PORT=8080`) | `Dockerfile` multi-stage build + `/healthz` probe |
| **ADR 003 / Break 1** | Continuous 1080p streaming caused iPhone Safari thermal dimming & API bloat | Client-side Wasm motion gate (3s stillness) → zero-token `gemini-decision-1` → conditional `gemini-4-neon` | QA Test Case 3 + unit tests (`routingLogic.test.ts`) |
| **Break 2** | "Scale" hallucination recommending a pipe wrench for a 2mm screw | Mandatory WebXR depth or physical scale anchor (coin, credit card, thumb) enforced in both SQL and server response guard | `enforceScaleAnchorInvariant()` + `requires_scale_anchor` SQL check |
| **Hardest Input** | Water-smeared lens + chrome glare + spraying water under a kitchen sink | Automatic downgrade from WebRTC video to 3-shot high-contrast burst photography + voice instruction | QA Test Case 1 (3G throttling / visual noise fallback) |
