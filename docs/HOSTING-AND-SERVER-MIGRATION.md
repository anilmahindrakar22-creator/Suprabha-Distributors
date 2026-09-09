# Suprabha OS hosting and server migration plan

## Goal

Run Suprabha OS on an ordinary office PC now, then move the same application to a dedicated in-house server later without changing business workflows or creating a second source of truth. The future server may also host AI/analytics workloads, but transactional operations remain isolated from heavy AI jobs.

## Stage 1 — Office PC hosting now

### Recommended topology

```text
Office users on LAN
        |
        v
Windows office PC
Suprabha OS application
        |
        +-----------------> Supabase/PostgreSQL environment
        |
        +-----------------> local Tally connector -> Tally Prime
```

The application is built once and served on the local network. The office PC is the application host only; secrets remain in environment configuration, and business data remains in the configured PostgreSQL/Supabase environment unless a separately approved database migration is performed.

### Prerequisites

- Windows 11 or supported Windows Server.
- Node.js 22.13 or newer.
- pnpm 11.19 or compatible locked package-manager version.
- Git for controlled updates.
- Reliable LAN connection; preferably wired Ethernet for the host PC.
- Static/reserved LAN IP for the host PC.
- Windows Firewall rule allowing the chosen application port only on the private/local network.
- `.env` populated from `.env.example`; secrets are never committed to Git.

### First installation

```powershell
git clone <repository-url>
cd Suprabha-Distributors
git checkout <approved-release-branch-or-tag>
pnpm install --frozen-lockfile
Copy-Item .env.example .env
# Fill .env with the approved environment values.
pnpm test:ci
pnpm build
pnpm start:lan
```

`pnpm start:lan` serves the built application on `0.0.0.0:8787`, allowing other authorized devices on the office LAN to reach it at `http://<host-pc-ip>:8787`.

For a clean build-and-host cycle:

```powershell
pnpm host:pc
```

### Production-use guardrails for PC hosting

- Do not run daily operations from an uncommitted developer working tree.
- Run only an approved commit/tag that has passed the release gate.
- Use a dedicated Windows account/service account for the host process where practical.
- Configure automatic restart after Windows reboot before declaring the PC-hosted setup production-ready.
- Keep the host PC awake during business hours and disable automatic sleep/hibernation.
- Do not expose port 8787 directly to the public internet.
- Remote access, if required, must use an authenticated VPN or reviewed tunnel/reverse-proxy design rather than raw router port-forwarding.
- The Tally workstation must not become the only database or backup location.

## Stage 2 — Dedicated in-house application server

Move hosting when daily dependence, user count, availability requirements, or AI/analytics workloads justify dedicated hardware.

### Recommended topology

```text
                    Office LAN / VPN
                          |
             +------------+------------+
             |                         |
             v                         v
     Suprabha OS app/API          User devices
     dedicated server
             |
             +-------> PostgreSQL/Supabase authority
             |
             +-------> Tally connector -> Tally Prime
             |
             +-------> AI/analytics worker
```

The move should be operationally boring: copy the approved release, reproduce environment variables/secrets, build, run tests, switch the internal DNS/IP endpoint, validate, and keep a documented rollback path.

### Preferred server operating system

A Linux server is preferred for the future dedicated host because service supervision, backups, containers and AI runtimes are easier to operate consistently. Windows Server is acceptable if the Tally or internal IT constraints make Windows materially simpler. Tally itself may remain on a separate Windows machine.

## Stage 3 — In-house AI and analytics

AI is an adjunct workload, not part of the transactional request path.

```text
Transactional path
User -> Suprabha OS -> PostgreSQL

Analytics/AI path
PostgreSQL read model / approved extracts
        -> analytics queue/job
        -> local AI worker/GPU
        -> governed recommendation/analysis result
        -> Suprabha OS review surface
```

### Rules for AI workload isolation

- AI jobs never receive direct authority to post invoices, alter stock, change customer credit, approve placements, or mutate financial truth.
- Heavy AI jobs run asynchronously against approved read models/snapshots, not inside order-entry HTTP requests.
- Transactional database latency takes priority over AI throughput.
- Prefer a separate AI process/container and, when load justifies it, a separate machine or GPU worker.
- AI outputs store model/version, source-data timestamp, confidence/limitations and user approval where an action follows.
- Failure of the AI service must not stop order capture, billing reconciliation, dispatch, service or collections workflows.

## Portability rules

To preserve easy movement from office PC to server:

1. No hard-coded machine names, drive letters, LAN IPs or office folders in application logic.
2. Environment-specific endpoints and secrets come from environment configuration.
3. One authoritative transactional database per environment; never allow both old and new hosts to accept independent writes during cutover.
4. Files/documents use configured object/file storage rather than arbitrary desktop folders.
5. Scheduled/background work must use a documented worker/service entry point rather than relying on a logged-in desktop session.
6. Backups and restores are tested before moving the production endpoint.
7. Release artifacts are tied to a Git commit/tag so the exact running version is reproducible.

## Suggested hardware progression

### Current PC host

Suitable for the present OMS and early commercial modules:

- Modern 4–8 core CPU.
- 16 GB RAM preferred.
- SSD/NVMe storage.
- Wired gigabit LAN preferred.
- UPS strongly recommended if the PC becomes operationally critical.

### Future dedicated server without local large-model inference

- 8–16 modern CPU cores.
- 32–64 GB RAM.
- 1–2 TB NVMe, mirrored where budget permits.
- UPS.
- Automated local + off-site backups.

### Future AI-capable server

Do not buy the GPU until an actual model/workload is selected and benchmarked. A practical architecture is:

- 12–24 CPU cores.
- 64–128 GB RAM.
- 2 TB+ NVMe working storage plus backup storage.
- NVIDIA GPU selected by required model size/context/inference throughput.
- Separate AI worker process/container so GPU failure or exhaustion cannot affect the operational application.

Avoid buying expensive AI hardware merely because AI is on the roadmap. First establish the analyses to run, model family/size, data volume, latency target and acceptable cloud-vs-local economics.

## Budget-first AI infrastructure policy

Suprabha OS must optimize business return before hardware ambition. The default policy is to spend as little as practical until a measured workload proves the next upgrade will create operational or commercial value.

### Step 0 — use existing hardware

- Run the operational application and deterministic KPI/rule engine on the existing office PC where reliable enough.
- Use CPU-based Python analytics for wallet scoring, account risk, placement ROI, reagent leakage, opportunity prioritization and simple forecasting.
- Do not purchase a GPU merely to experiment with AI.
- Prefer hosted/on-demand AI for occasional experiments if its total cost is lower than owning idle hardware, subject to approved data/privacy controls.

### Step 1 — low-cost dedicated application server

Move to a dedicated server only when uptime, backups, concurrency or background jobs justify it. Favor value hardware rather than workstation-class specifications:

- 8–12 efficient CPU cores.
- 32 GB RAM initially; choose a board/platform that can expand to 64/128 GB later.
- 1 TB NVMe initially, with a second drive for backup/replication when affordable.
- No discrete GPU required.
- Reuse existing peripherals and avoid cosmetic/enthusiast components.

### Step 2 — add classical ML before local LLM hardware

The first intelligence stack should use inexpensive CPU-friendly models and rules:

- SQL/KPI calculations and deterministic Next Best Action rules.
- Logistic regression and tree-based models such as CatBoost/LightGBM/XGBoost for opportunity probability, churn/wallet-loss risk and ranking.
- Statistical/time-series forecasting for demand and reagent consumption.
- Isolation Forest/statistical anomaly detection where useful.

Local GPU inference is not a prerequisite for these capabilities. Build clean historical data and measurable business outcomes first.

### Step 3 — add a value GPU only after an AI use case pays for it

A GPU purchase requires all of the following:

1. A named production use case, such as management Q&A/RAG, document analysis or local narrative generation.
2. A measured workload/frequency that makes local inference cheaper or operationally better than hosted inference.
3. A selected model that has been benchmarked on representative Suprabha data.
4. A clear privacy or latency reason for local execution, or a documented financial payback.
5. Confirmation that the existing server PSU, cooling, motherboard and chassis can support the card safely.

When that gate is met, prioritize **VRAM per rupee** rather than gaming performance or newest-generation branding. A reliable used/refurbished NVIDIA card may be appropriate if warranty, power draw, thermals and compatibility are acceptable. Do not assume a 24–32 GB GPU is required; start with the smallest VRAM capacity that meets the benchmarked model and context requirement.

### Step 4 — scale memory/GPU only from evidence

- Expand RAM from 32 -> 64 -> 128 GB only when measured memory pressure or larger local models require it.
- Add or replace GPU only when model size, throughput or latency measurements justify it.
- Keep AI workers separable so a later second-hand GPU workstation or dedicated AI box can be added without moving the transactional database.
- Never finance premium AI hardware from hoped-for future use. Hardware should follow demonstrated value.

### Budget procurement principle

The preferred progression is:

```text
Existing PC
   -> improve SSD/RAM only if needed
   -> modest dedicated CPU server
   -> classical ML and governed rules
   -> hosted AI experiments
   -> value/used local GPU after ROI proof
   -> larger AI server only after sustained business value
```

The goal is not to own the largest model. The goal is to produce better account decisions, more wallet capture, better gross profit, faster collections and lower operational leakage at the lowest sensible total cost.

## Migration gate from PC to server

Move when one or more of these is true:

- The office PC must be continuously available and is becoming a single operational bottleneck.
- More users require stable concurrent access.
- Planned maintenance/restarts of the PC disrupt operations.
- Local background analytics begins competing with operational work.
- Management requires stronger uptime, backup, monitoring or disaster-recovery controls.
- AI workloads require sustained CPU/RAM/GPU resources.

## Cutover checklist

1. Freeze the approved application version.
2. Back up application configuration and database according to policy.
3. Provision server and reproduce secrets/configuration securely.
4. Install dependencies and run full CI/test suite.
5. Validate Tally connector and all external integrations.
6. Validate one complete real workflow end-to-end.
7. Stop writes on the old application host.
8. Switch LAN DNS/bookmark/IP endpoint to the new host.
9. Monitor orders, integration queue, errors and performance.
10. Keep old host available only as a documented rollback target until acceptance is complete; do not allow dual independent writes.

## Architecture principle

Suprabha OS should remain operationally simple even as capability grows:

```text
One application
One authoritative PostgreSQL system of record
One Tally boundary/connector
Optional background workers
Optional AI worker later
```

The AI layer scales independently; it must not force the core distribution system into microservices or a second transactional database.
