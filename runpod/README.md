# RunPod usage — Team Crescendo

RunPod was used for training numerical estimation models, not for a live
inference API. The application loads the resulting scikit-learn joblib bundle
locally through its Python backend.

- Company history: 300 synthetic events from 2023–2026.
- Outputs assist crew, equipment, cost and selling-price estimates.
- Current training source/instructions: [`../training/eventops_v2/`](../training/eventops_v2/).
- Required application model: `models/eventops_v2/eventops_v2_models.joblib`.
- Matching application runtime: scikit-learn 1.9.1.
- Weights are supplied separately by the team; no retraining is needed to use an
  existing compatible model. Only load a trusted joblib bundle.
- The OpenAI text assistant is separate from these numerical models.

Do not copy the template's placeholder `runpod/handler.py` or claim an endpoint
that is not deployed. Keep your existing genuine training notebook/model files
when merging this package into an existing repository.

Add real training proof as `submission/SDC2026_Crescendo_Runpod_POU.pdf`.
Synthetic test performance is not evidence of real-company business impact.
