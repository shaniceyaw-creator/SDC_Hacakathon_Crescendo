# Numerical-model training reference

This minimal application handoff retains the training Python source and its
requirements, not the full notebook packaging tools, chart exports or weights.
Keep your genuine RunPod notebook/configuration and training evidence alongside
this source, or add a link to your existing training repository.

The application does not run this training script at startup. Use your existing
trusted exported model at models/eventops_v2/eventops_v2_models.joblib instead.
Current synthetic company history is under data/v2/; the training period is
2023-2026. Read the training script's paths before running a separate training
session. The application runtime requires scikit-learn 1.9.1.

No live RunPod endpoint is configured. See ../../runpod/README.md for actual use.
