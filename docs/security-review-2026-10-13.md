# Security review — 2026-10-13

Scope: Reference/clone traversal, circular structures, depth limits, Scalar dependency tree and ESM/CJS exports.

Raise Scalar parser minimum to 0.29.13, which pins json-magic with patched undici 7.29.1. No additional P0/P1 reproduced in reviewed local traversal paths.

Validation: package type checks, existing automated tests, targeted regression tests for changes, and release build/package checks. The complete pre-change test/type-check baseline passed for all 17 owned libraries. Final release validation is recorded by the release workflow.

This is a focused P0/P1 review, not a guarantee that all vulnerabilities are absent. npm advisory severity alone is not evidence that a particular application path is exploitable.

Runtime metadata now requires Node.js 22+, matching the existing Scalar dependency requirement instead of claiming unsupported Node.js 18 compatibility. Browser entry points remain unchanged.
