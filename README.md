# @powerduck/openapi-parser

[![npm version](https://img.shields.io/npm/v/@powerduck/openapi-parser)](https://www.npmjs.com/package/@powerduck/openapi-parser)
[![license](https://img.shields.io/npm/l/@powerduck/openapi-parser)](https://github.com/powerducklab/openapi-parser/blob/main/LICENSE)
[![website](https://img.shields.io/badge/website-powerduck.com-blue)](https://www.powerduck.com/)

Upgrade any OpenAPI document — Swagger 2.0, OpenAPI 3.0, 3.1, or 3.2 — to
OpenAPI 3.2, in one call.

A thin wrapper over [`@scalar/openapi-parser`][parser] and
[`@scalar/openapi-upgrader`][upgrader]. It does not reimplement parsing,
validation, or upgrading; it wires them together and gives every failure a
single, predictable shape with a machine-readable error code.

## Features

- **One function, every version** — Swagger 2.0, OpenAPI 3.0.x, 3.1.x, and 3.2.x all upgrade to a validated 3.2 document.
- **JSON and YAML string input** — Pass a pre-parsed object or a raw JSON/YAML string. Parsing is delegated to `@scalar/openapi-parser`'s `validate()`.
- **Machine-readable error codes** — Every failure mode surfaces an `OpenApiUpgradeError` with a `UpgradeErrorCode` enum value. No string matching in production code.
- **Zero input mutation** — The input document is deep-copied (via `structuredClone`) before any upgrade stage runs. Your object is never modified.
- **Circular-reference guard** — Detects cyclic input before it can cause stack overflows in downstream upgraders. Configurable depth.
- **Output validation** — The upgraded 3.2 document is schema-validated by default. Disable via options if you need raw output.
- **Dual ESM + CJS** — `import` in modern Node and bundlers, `require()` in Electron main process and legacy code.

## Install

```sh
npm install @powerduck/openapi-parser
```

Requires Node.js 18 or later.

## Usage

```ts
import { upgradeOasTo32 } from "@powerduck/openapi-parser";
import { readFile } from "node:fs/promises";

// From a YAML string
const yaml = await readFile("./swagger.yaml", "utf8");
const document = await upgradeOasTo32(yaml);

// From a JSON string
const doc = await upgradeOasTo32('{"openapi":"3.1.0","info":{...}}');

// From a parsed object
const doc2 = await upgradeOasTo32({ openapi: "3.0.3", info: {...}, paths: {} });

console.log(document.openapi); // "3.2.0"
```

### With options

```ts
const document = await upgradeOasTo32(input, {
  validateResult: true,   // validate the upgraded 3.2 document (default: true)
  checkVersion: true,      // assert output declares 3.2.x (default: true)
  maxDepth: 64,            // circular-reference scan depth (default: 64, 0 = disabled)
});
```

## How it works

1. **Input guard** — The input must be a string or a plain object. Anything else (null, arrays, numbers) is rejected with `INVALID_INPUT`.
2. **Circular-reference scan** — Object input is walked up to `maxDepth` to detect cycles. Cyclic input is rejected with `CIRCULAR_REFERENCE`.
3. **Deep copy** — Object input is cloned via `structuredClone`, so downstream upgraders cannot mutate the caller's document.
4. **Parse and validate** — The input is handed to `validate()` from `@scalar/openapi-parser`. That single call parses the string (if it is one), checks the document against its own spec version, and reports which version that is.
5. **First-stage upgrade** — If the detected version is 2.0 or 3.0.x, the document goes through `upgrade()`, which lands it on 3.1. 3.1 and 3.2 documents skip this stage.
6. **Second-stage upgrade** — Every document goes through the 3.1 → 3.2 upgrader, so all callers get output from the same normalisation path.
7. **Version assertion** — The output is checked to declare OpenAPI 3.2.x (unless `checkVersion: false`).
8. **Output validation** — The upgraded document is schema-validated (unless `validateResult: false`).

## API

### `upgradeOasTo32(input, options?)`

Upgrades a Swagger 2.0 or OpenAPI 3.x document to OpenAPI 3.2.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `OpenApiDocument \| string` | Yes | A Swagger 2.0 or OpenAPI 3.x document, as a plain object or as a JSON / YAML string. |
| `options` | `UpgradeOptions` | No | Optional configuration. |

**Returns:** `Promise<Oas32Document>` — A validated OpenAPI 3.2 document.

**Throws:** `OpenApiUpgradeError` — See [Error Codes](#error-codes) for all possible failure modes.

### `UpgradeOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `validateResult` | `boolean` | `true` | Run schema validation on the upgraded 3.2 document. |
| `checkVersion` | `boolean` | `true` | Assert that the upgraded document declares OpenAPI 3.2.x. |
| `maxDepth` | `number` | `64` | Maximum nesting depth to scan for circular references. Set to `0` to disable the guard. |

### `OpenApiUpgradeError`

```ts
class OpenApiUpgradeError extends Error {
  readonly code: UpgradeErrorCode;
  readonly issues: readonly OpenApiValidationIssue[];
  readonly cause?: unknown;
}
```

### `isOpenApiUpgradeError(value)`

Type guard. Returns `true` when the value is an `OpenApiUpgradeError` instance.

```ts
try {
  await upgradeOasTo32(input);
} catch (error) {
  if (isOpenApiUpgradeError(error)) {
    switch (error.code) {
      case UpgradeErrorCode.InvalidInput:
        console.error("Bad input:", error.message);
        break;
      case UpgradeErrorCode.CircularReference:
        console.error("Cyclic document detected");
        break;
      default:
        console.error(`Upgrade failed (${error.code}):`, error.message);
    }
  } else {
    throw error; // unexpected, rethrow
  }
}
```

## Error Codes

| Code | Value | When it happens |
|------|-------|-----------------|
| `InvalidInput` | `"INVALID_INPUT"` | The input is not a string or a plain object (null, array, number, etc.). |
| `ParseOrValidateFailed` | `"PARSE_OR_VALIDATE_FAILED"` | The input could not be parsed, or failed initial schema validation. `.issues` carries the validator's issues. |
| `FirstUpgradeFailed` | `"FIRST_UPGRADE_FAILED"` | The 2.0/3.0 → 3.1 upgrader threw or returned no specification. |
| `SecondUpgradeFailed` | `"SECOND_UPGRADE_FAILED"` | The 3.1 → 3.2 upgrader threw. |
| `VersionAssertionFailed` | `"VERSION_ASSERTION_FAILED"` | The upgraded document does not declare OpenAPI 3.2.x. |
| `ValidationFailed` | `"VALIDATION_FAILED"` | The upgraded document failed schema validation. |
| `CircularReference` | `"CIRCULAR_REFERENCE"` | The input document contains a circular reference. |

## Exports

```ts
// Main function
import { upgradeOasTo32 } from "@powerduck/openapi-parser";

// Error handling
import {
  OpenApiUpgradeError,
  UpgradeErrorCode,
  isOpenApiUpgradeError,
  type UpgradeOptions,
  type OpenApiValidationIssue,
} from "@powerduck/openapi-parser";

// Document types
import type {
  Oas20Document,
  Oas30Document,
  Oas31Document,
  Oas32Document,
  OpenApiDocument,
  OpenApiInput,
  UpgradedDocument,
} from "@powerduck/openapi-parser";

// OpenAPI 3.2 schema object types
import type {
  SchemaObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  RequestBodyObject,
  ResponseObject,
  ServerObject,
  TagObject,
  MediaTypeObject,
} from "@powerduck/openapi-parser";

// Re-exported @scalar helpers (for advanced use)
import { dereference, upgrade, validate } from "@powerduck/openapi-parser";
```

## Electron / CommonJS

```js
const { upgradeOasTo32 } = require("@powerduck/openapi-parser");

upgradeOasTo32(specContent).then((doc) => {
  console.log(doc.openapi); // "3.2.0"
});
```

## Development

```sh
npm install
npm run build       # tsup: ESM + CJS + .d.ts
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run verify      # smoke-test both ESM and CJS builds
```

## Links

- [Official Website](https://www.powerduck.com/opensource/openapi-parser.html)
- [Documentation](https://www.powerduck.com/docs/openapi-parser/introduction/)
- [Live Demo](https://www.powerduck.com/demo/openapi-parser)
- [GitHub](https://github.com/powerducklab/openapi-parser)
- [npm](https://www.npmjs.com/package/@powerduck/openapi-parser)

## License

MIT

[parser]: https://github.com/scalar/openapi-parser
[upgrader]: https://github.com/scalar/openapi-parser/tree/main/packages/openapi-upgrader
