# Separately supplied trained model

The source upload package deliberately does not duplicate trained weights.
Place your existing trusted **EventOps v2** bundle here:

```text
models/eventops_v2/eventops_v2_models.joblib
```

The filename and directory must match exactly. Do not leave the model inside a
ZIP file or substitute an earlier model/tutorial checkpoint.

- The runtime uses **scikit-learn 1.9.1**, pinned in `pyproject.toml`.
- Python checks that the bundle's `format` is `eventops_v2` and that the
  scikit-learn major/minor version matches.
- Keep `versions.json` alongside the model when available. `SOURCE.json` is
  optional provenance metadata; the app can load the model without it.
- The package inventory records the SHA-256 of the model present when this
  source package was built, so you can compare your own copy.
- Only load joblib/pickle files you trust; they can execute code.

If your repository already tracks the correct weights, keep that file. The
export does not remove or untrack it, and it does not create a new model or
require another RunPod training run.
