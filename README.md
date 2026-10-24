# OpusEvents — Team Crescendo

> **Event planning, in sync.** An AI-assisted event-management prototype for
> Malaysian SMEs, connecting customer bookings, manager decisions and team delivery.

## Team Information

| Field | Details |
| --- | --- |
| **Team Name** | Crescendo |
| **Team Domain** | Domain 2 |
| **SDG Track** | SDG 8 — Decent Work and Economic Growth |
| **Team Leader** | Yaw En Qi |
| **University** | Xiamen University Malaysia |
| **Number of Members** | 5 |

## Links

| Resource | Link |
| --- | --- |
| GitHub Repository | [SDC_Hacakathon_Crescendo](https://github.com/shaniceyaw-creator/SDC_Hacakathon_Crescendo) |
| Replit Project | [OpusEvents project workspace](https://replit.com/@shaniceyaw/EventOps-Streamlit-Planner) |
| Live Demo | [Open OpusEvents](https://opusevent-event-planner.replit.app/opusevents/sign-in) |
| RunPod Endpoint | Not applicable — RunPod was used for training; numerical inference runs locally |
| Slide Deck | **TO COMPLETE: add the final shareable slide-deck link** |
| Demo Video | **TO COMPLETE: add the final narrated demonstration link** |

The Replit workspace URL retains its original project name. The current website
is **React and TypeScript, not Streamlit**, and its public application path is
`/opusevents/`.

## Overview

### Problem

Malaysian event-management SMEs must coordinate customer requests, crews,
equipment, preparation and budgets, especially during festive-season demand.
Fragmented spreadsheets and messages make it difficult to see resource clashes,
preparation progress and actual spending. Customers need timely responses,
workers need clear assignments, and managers need a shared operational overview.

### Solution

OpusEvents combines numerical estimates with a connected three-role workflow.
A two-stage model pipeline estimates crew and equipment needs, then uses the
predicted resources to estimate cost and selling price. Availability and booking
rules are checked separately; managers retain approval and staffing control.

An OpenAI-powered assistant provides planning advice using server-provided
business context. It does not create, approve or change bookings. The prototype
is designed as a proposed intelligent module for Orbyte; live Orbyte finance/HR
integration is future work.

### Key Features

- **Customer booking requests:** event type, guest count, location, start/end
  dates and daily working hours. Self-service requests support up to 1,000 guests
  with at least one week's notice; larger/special cases use a labelled demo contact.
- **AI-assisted estimation:** predicted crew, equipment, estimated cost, selling
  price and quote range, with warnings for inputs outside the training examples.
- **Manager control:** review, approve/reject and adjust assigned workers and
  shifts, including shifts ending the following day.
- **Shared confirmed bookings:** event-type labels, date/type organisation,
  preparation tasks, actual expenses, remaining budget and receipt references.
- **Worker calendar:** assigned events displayed in a month calendar, with
  available work and team preparation updates.
- **Insights and advice:** company-history views, demand context and an advisory
  assistant to support—not replace—manager decisions.

### Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| API server | Node.js, Express |
| Planning backend | Python, scikit-learn, pandas, NumPy |
| Database | PostgreSQL |
| Numerical AI | Two-stage scikit-learn bundle trained using RunPod; local joblib inference |
| Text assistant | OpenAI through Replit AI Integrations |
| Receipt files | Private Replit App Storage, with additional Replit OIDC sign-in |
| Hosting / Development | Replit |

## Project Structure

```text
.
├── artifacts/
│   ├── eventops-live/                 # React website, styles and brand assets
│   └── api-server/                    # Express API, sessions and integrations
├── src/v2/                            # Python predictions, booking and staffing logic
├── lib/                               # Shared API types/validation, DB and OpenAI client
├── data/v2/                           # Current synthetic company inputs and event history
├── models/eventops_v2/
│   ├── eventops_v2_models.joblib       # Required runtime model location
│   └── versions.json                  # Matching model/runtime information
├── scripts/
│   ├── eventops_v2_bridge.py           # Persistent JSON-lines Python bridge
│   └── eventops_schema.sql             # Current PostgreSQL table definitions
├── training/
│   ├── Training.ipynb                 # Team's training notebook
│   ├── Dataset/                       # Synthetic training data and splits
│   ├── outputs/                       # Saved reports, charts and training output
│   └── requirements.txt               # Separate training dependencies
├── runpod/README.md                    # Description of actual RunPod use
├── submission/                        # Required final submission PDFs
├── tests/                             # Application regression checks
├── .env.example                       # Variable names only; never real credentials
├── .replit                            # Replit configuration
├── package.json                       # JavaScript workspace scripts
├── pnpm-lock.yaml                     # JavaScript dependency lockfile
├── pyproject.toml / uv.lock            # Python runtime dependencies and lockfile
├── LICENSE
└── README.md
```

The runtime requires the model at `models/eventops_v2/` and both complete
`artifacts/` folders. Internal `eventops` package/directory names are stable
identifiers; they do not change the public OpusEvents branding.

### Architecture

```text
Customer / Manager / Worker
             |
        React website
             |
         Express API -------- OpenAI advisory assistant
             |          \--- Private receipt storage / receipt sign-in
    Persistent Python backend
         |             |
    PostgreSQL     Local trained model bundle

RunPod training -> exported joblib bundle -> local numerical inference
```

## How to Run

### Option 1 — Run on Replit 
1. Import this repository into Replit, preserving hidden files and both
   `.replit-artifact/artifact.toml` manifests.
2. Use **Node.js 24, pnpm 10 and Python 3.13**. From the repository root:

   ```sh
   pnpm install --frozen-lockfile
   ```

3. Install the Python runtime dependencies declared in `pyproject.toml` /
   `uv.lock` using Replit's Python tooling. The Python command started by Express
   must be able to import these dependencies.
4. Ensure the trusted trained model is at:

   ```text
   models/eventops_v2/eventops_v2_models.joblib
   ```

   The runtime pins **scikit-learn 1.9.1**. Use the matching bundle; do not rename
   an unrelated model. No retraining is needed for the existing compatible model.
5. Configure a **development** PostgreSQL database. Apply the schema to a new,
   empty development database:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/eventops_schema.sql
   ```

   Never target production with setup/tests. Startup does not create tables.
   The Drizzle schema is a placeholder; `drizzle-kit push` is not a replacement.
6. Set the actual private variables/services listed in `.env.example` through
   Replit's environment/Secrets settings:
   - `DATABASE_URL` and a private `SESSION_SECRET`.
   - `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY`.
   - Private App Storage configuration for receipt uploads.
   - Replit identity/OIDC configuration for the additional receipt sign-in.

   The OpenAI integration variables are required at API startup, even when the
   assistant is not opened. The root `.env.example` is only a reference; the app
   does not automatically load a root `.env`. Never commit real values.
7. Start the two managed artifact workflows:
   - `artifacts/api-server: API Server`
   - `artifacts/eventops-live: web`
8. Open `/opusevents/`. API warm-up seeds a new empty demo database; it does not
   replace existing saved bookings.

A GitHub import transfers code, not existing database rows, private configuration
or receipt objects. Per-service `PORT` and `BASE_PATH` settings come from the
artifact manifests; do not assign one global port to both servers.

### Run Tests

```sh
python -m unittest discover -s tests -v
node --test tests/booking-list.test.mjs tests/shift-time.test.mjs tests/public-paths.test.mjs
pnpm run typecheck
```

Some Python tests require the model and a development database. Never use
production for tests. Build commands are specified in each artifact manifest.

## How We Use Replit

- Develop and run the React website, Express API and persistent Python planner.
- Host the prototype, use PostgreSQL for structured booking/team data, and use
  AI Integrations for the advisory assistant.
- Store private receipt files with App Storage.
- Keep private configuration in runtime environment/Secrets rather than GitHub.

Proof supplied: [Replit proof of use](submission/SDC2026_Crescendo_Replit_POU.pdf).
The current proof shows credit usage; a project/workspace screenshot can provide
additional context linking that use to OpusEvents.

## How We Use RunPod

RunPod provided the training environment for the numerical resource and cost/
selling-price models. The training materials include a notebook, dataset/splits,
reports and chart outputs. The model is exported as a joblib file and loaded
locally by the website's Python backend.

There is **no live RunPod inference endpoint** and no serverless handler required
for this application. GPU-capable Pod provisioning is shown in the proof, but
this README does not claim that the scikit-learn pipeline is GPU-accelerated.
The numerical models and the OpenAI assistant are separate systems.

Proof supplied: [RunPod proof of use](submission/SDC2026_Crescendo_Runpod_POU.pdf).
A completed training-log/notebook screenshot would strengthen the connection
between the provisioned Pod and the submitted model.

## Data and Validation

- The numerical models use **300 synthetic company-history events from 2023–2026**.
- This history represents the demo company's own past events, not nationwide
  event listings.
- Current website history contains 300 records dated 3 October 2023 to
  18 September 2026.
- Synthetic evaluation reports are under `training/outputs/reports/`.
- Estimates are not exact requirements, guaranteed optimal prices, audited
  accounts or proof of real-company accuracy/savings.
- Demo accounts, workers, clients and event data are synthetic.

## Challenges & Learnings

- Separating numerical estimation from availability rules and manager approval.
- Handling multi-day events with daily hours and shifts crossing midnight.
- Keeping three roles aligned with shared booking and preparation updates.
- Keeping model history, runtime versions and the company-data story consistent.
- Distinguishing implemented prototype features from proposed Orbyte integration.

## Future Improvements

- [ ] Validate with permissioned real-company data.
- [ ] Compare manual and assisted planning on matched scenarios, measuring time,
  estimation errors and scheduling conflicts.
- [ ] Implement live Orbyte finance/HR integration.
- [ ] Strengthen production organisation-level permissions. Demo-role sessions
  and receipt sign-in are not complete company/event membership control.

## Team

| Name | Role / contribution | GitHub |
| --- | --- | --- |
| Yaw En Qi | Team leader; add specific project contributions | Add profile |
| Remaining four members | **TO COMPLETE: names and actual contributions** | Add profiles |
| **Yaw En Qi** | **Team Leader & Project Manager** — Project coordination, system architecture design, SDG alignment, and overall submission oversight. |
| **Eason** | **Lead Developer & Systems Engineer** — Full-stack system coding (React 19 frontend, Express 5 API server, Python scikit-learn ML engine, PostgreSQL database) and Replit deployment. |
| **Henry** | **Media & Pitch Specialist** — Product demonstration video recording, screen walkthroughs, voiceover narration, and video post-production editing. |
| **Ashley** | **Technical Writer & Documentation Lead** — Preliminary proposal report writing, technical declaration proofing, submission formatting, and README documentation. |
| **Harry** | **Compliance & Documentation Specialist** — Technical declaration proofing, report submission verification, compliance auditing, and README documentation. |

Member contributions have not been invented. Complete this table before the
final submission.

## Submission Checklist

- [x] Team name, domain, SDG, university and member count supplied.
- [ ] All five members' names and actual contributions added.
- [ ] Final slide-deck link added.
- [ ] Final narrated demonstration link added.
- [x] Replit proof-of-use PDF supplied.
- [x] RunPod proof-of-use PDF supplied.
- [ ] Preliminary submission PDF added: `submission/SDC2026_Crescendo_Preliminary.pdf`.
- [ ] Technical declaration PDF added: `submission/SDC2026_Crescendo_TechDeclaration.pdf`.
- [ ] Complete application source uploaded, including the correct runtime model path.
- [ ] Setup verified after configuring the required private services.
- [ ] Public files/screenshots reviewed for sensitive information.
- [ ] License metadata confirmed and made consistent.

## License

The repository contains an [Apache License 2.0 file](LICENSE). Its root
`package.json` currently declares `MIT`; the team should confirm its intended
license and align that metadata. This documentation does not change licensing
terms. Dependencies, logos and other media retain their respective rights.
