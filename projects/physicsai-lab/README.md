# PhysicsAI Lab

PhysicsAI Lab is the web extension track for the Online PINN PDE Framework V3. Phase 9 establishes an auditable baseline from the upstream release before work on the experiment explorer and browser inference.

The verified V3.0.4 archive contains 65 completed experiments across nine PDE configurations and five methods. Wave and Heat have three seeds each. Model files span two formats, Keras HDF5 and NumPy NPZ. The upstream main branch also contains V4. Its experiment counts and model formats belong to that separate version.

- [Phase 9 evidence and integration map](docs/PHASE_9_AUDIT.md)
- [Pinned V3 source](https://github.com/danny97041/online-pinn-pde-framework/tree/v3.0.4)
- [Official release assets](https://github.com/danny97041/online-pinn-pde-framework/releases/tag/v3.0.4)

Run the standard-library archive check from this directory with Python 3.12 or later.

```text
python scripts/audit_v3.py /path/to/V3_Results.zip
```

The optional smoke check loads original models from an explicitly selected clean V3.0.4 checkout and a checksum-matched release file. Install the numerical and API dependencies listed in the audit, then run:

```text
python scripts/smoke_v3.py /path/to/clean-v3.0.4 /path/to/V3_Results.zip --all
```

The checkpoint publishes the audit code and verification summaries. Upstream weights, archives and notebook source are available at their original release.

## Research workspace

[Research results for 65 runs](results/README.md) · [Numerical contract](docs/PHASE_10_CONTRACT.md) · [Browser implementation and reproduction](docs/PHASE_11.md)
