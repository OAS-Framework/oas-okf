# Schema status

- **Corrected schemas verified**: all three vendored schemas are byte-identical to the canonical package-engine reference now merged to main (reviewed head `af49fd542e7190d1da72a6e0b9214036b59cbd7c`; package-engine merge `612b4f8c48efb63be7435df3d4473feba7b25abf`; package-config merge `a0366349915f151b6f6897cb682b7258f9fc1d79`); CI validates package and capability manifests against them.
- **Runtime boundary final**: harvest requires the dispatcher's canonical absolute `OAS_CLI_BIN`, invokes it with argv-safe `execFile`, parses schema-v1 envelopes, reads dispatch settings, uses a capability-defined agent, and cleans mode-0600 task files. It never searches PATH or imports/discovers kernel files.
- `TODO(engine-consumer-fixtures)`: run the released OAS 0.19.0 three-mode harvest fixture, Pi/Claude scaffold parity, retired-flag/sub-floor rejection, and task-file cleanup when WS1 fixtures are published.

No publication tag or catalog entry may be created while this item remains open.
