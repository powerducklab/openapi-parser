/**
 * Validate the input, then upgrade it to OpenAPI 3.2.
 *
 * validate() accepts an object, a JSON string or a YAML string, and returns
 * the parsed document together with its version, so parsing and version
 * detection are not repeated here.
 */

export { dereference, upgrade, validate } from "@scalar/openapi-parser";

import {
  upgrade as upgradeToThreeOne,
  validate as validateDocument,
} from "@scalar/openapi-parser";
import { upgradeFromThreeOneToThreeTwo } from "@scalar/openapi-upgrader/3.1-to-3.2";

import type { Document as Oas20Document } from "@scalar/openapi-types/2.0";
import type { Document as Oas30Document } from "@scalar/openapi-types/3.0";
import type { Document as Oas31Document } from "@scalar/openapi-types/3.1";
import type { Document as Oas32Document } from "@scalar/openapi-types/3.2";

export type { Oas20Document, Oas30Document, Oas31Document, Oas32Document };

export type {
  SchemaObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  RequestBodyObject,
  ResponseObject,
  ServerObject,
  TagObject,
  MediaTypeObject,
} from "@scalar/openapi-types/3.2";

/** Any parsed document this package accepts. */
export type OpenApiDocument =
  | Oas20Document
  | Oas30Document
  | Oas31Document
  | Oas32Document;

/** Any document shape this package accepts, parsed or serialized. */
export type OpenApiInput = OpenApiDocument | string;

/** The document shape this package always produces. */
export type UpgradedDocument = Oas32Document;

/** A single issue reported by the validator. */
export interface OpenApiValidationIssue {
  readonly message?: string;
  readonly [key: string]: unknown;
}

/** Machine-readable codes for every failure mode along the upgrade path. */
export enum UpgradeErrorCode {
  /** The input is not a string or a plain object. */
  InvalidInput = "INVALID_INPUT",
  /** The input could not be parsed or failed initial validation. */
  ParseOrValidateFailed = "PARSE_OR_VALIDATE_FAILED",
  /** The first-stage upgrader (2.0/3.0 -> 3.1) failed or returned no spec. */
  FirstUpgradeFailed = "FIRST_UPGRADE_FAILED",
  /** The second-stage upgrader (3.1 -> 3.2) threw. */
  SecondUpgradeFailed = "SECOND_UPGRADE_FAILED",
  /** The upgraded document does not declare OpenAPI 3.2.x. */
  VersionAssertionFailed = "VERSION_ASSERTION_FAILED",
  /** The upgraded document failed schema validation. */
  ValidationFailed = "VALIDATION_FAILED",
  /** The input document contains a circular reference. */
  CircularReference = "CIRCULAR_REFERENCE",
}

/** Options accepted by {@link upgradeOasTo32}. */
export interface UpgradeOptions {
  /**
   * Run schema validation on the upgraded 3.2 document.
   * Defaults to true.
   */
  readonly validateResult?: boolean;
  /**
   * Assert that the upgraded document declares OpenAPI 3.2.x.
   * Defaults to true.
   */
  readonly checkVersion?: boolean;
  /**
   * Maximum nesting depth to scan for circular references.
   * Defaults to 64. Set to 0 to disable the guard.
   */
  readonly maxDepth?: number;
}

/** Error thrown for any failure along the upgrade path. */
export class OpenApiUpgradeError extends Error {
  readonly code: UpgradeErrorCode;
  readonly issues: readonly OpenApiValidationIssue[];
  readonly cause?: unknown;

  constructor(
    code: UpgradeErrorCode,
    message: string,
    issues: readonly OpenApiValidationIssue[] = [],
    cause?: unknown,
  ) {
    super(message);
    this.name = "OpenApiUpgradeError";
    this.code = code;
    this.issues = issues;
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, OpenApiUpgradeError.prototype);
  }
}

/** Type guard: returns true when the value is an {@link OpenApiUpgradeError}. */
export const isOpenApiUpgradeError = (
  value: unknown,
): value is OpenApiUpgradeError => value instanceof OpenApiUpgradeError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_MAX_DEPTH = 64;
const TARGET_VERSION_PATTERN = /^3\.2(?:\.|$)/;
const THREE_ONE_OR_TWO_PATTERN = /^3\.(?:1|2)(?:\.|$)/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const describeValue = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a value of type ${typeof value}`;
};

/**
 * Detects circular references in a plain object using an iterative DFS with
 * an explicit stack. Avoids recursion overhead and stack overflow on deeply
 * nested documents. Throws OpenApiUpgradeError with code CIRCULAR_REFERENCE
 * when a cycle is found on the current traversal path.
 */
const assertNoCircularReference = (
  document: Record<string, unknown>,
  maxDepth: number,
): void => {
  if (maxDepth <= 0) return;

  const onPath = new Set<object>();
  // Each stack frame: [value, depth, keys, index]
  // Using a flat array for performance instead of an array of objects.
  const stack: Array<[unknown, number, string[] | null, number]> = [];

  const push = (value: unknown, depth: number): void => {
    if (depth > maxDepth) return;
    if (Array.isArray(value)) {
      onPath.add(value);
      stack.push([value, depth, null, 0]);
    } else if (isPlainObject(value)) {
      if (onPath.has(value)) {
        throw new OpenApiUpgradeError(
          UpgradeErrorCode.CircularReference,
          "The input document contains a circular reference, which is not " +
            "supported by the upgrade pipeline.",
        );
      }
      onPath.add(value);
      stack.push([value, depth, Object.keys(value), 0]);
    }
  };

  push(document, 0);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const [value, depth, keys, index] = frame;

    if (keys === null) {
      // Array
      const arr = value as unknown[];
      if (index < arr.length) {
        frame[3] = index + 1;
        push(arr[index]!, depth + 1);
      } else {
        onPath.delete(arr as object);
        stack.pop();
      }
    } else {
      // Object
      if (index < keys.length) {
        frame[3] = index + 1;
        const obj = value as Record<string, unknown>;
        push(obj[keys[index]!]!, depth + 1);
      } else {
        onPath.delete(value as object);
        stack.pop();
      }
    }
  }
};

/**
 * Returns a deep copy of a plain JSON-serializable object. Uses
 * structuredClone (available in Node 18+, matching this package's engines
 * requirement), which correctly handles circular references. OpenAPI
 * documents are plain JSON data, so structuredClone is both safe and
 * allocation-efficient.
 */
const deepCopy = (document: Record<string, unknown>): Record<string, unknown> => {
  try {
    return structuredClone(document) as Record<string, unknown>;
  } catch (error) {
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.InvalidInput,
      "The input document could not be cloned; it may contain values that " +
        "are not representable as JSON.",
      [],
      error,
    );
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upgrades a Swagger 2.0, OpenAPI 3.0.x, 3.1.x or 3.2.x document to OpenAPI
 * 3.2. Accepts a parsed document, a JSON string or a YAML string.
 *
 * The input is validated first, so malformed documents fail with a single
 * OpenApiUpgradeError carrying the validator's issues rather than with an
 * arbitrary error from somewhere inside the upgrade chain.
 *
 * This function is pure: it does not mutate the input and has no side
 * effects beyond reading module-level dependencies.
 *
 * @param input - A Swagger 2.0 or OpenAPI 3.x document, as a plain object
 *   or as a JSON / YAML string.
 * @param options - Optional configuration (see {@link UpgradeOptions}).
 * @returns A validated OpenAPI 3.2 document.
 * @throws {OpenApiUpgradeError} with a machine-readable {@link UpgradeErrorCode}
 *   for every failure mode.
 *
 * @example
 * ```ts
 * import { upgradeOasTo32, isOpenApiUpgradeError } from "@powerduck/openapi-parser";
 *
 * // From a parsed object
 * const doc32 = await upgradeOasTo32(specObject);
 *
 * // From a JSON string
 * const doc32 = await upgradeOasTo32('{"openapi":"3.1.0",...}');
 *
 * // From a YAML string
 * const doc32 = await upgradeOasTo32("openapi: 3.1.0\ninfo:\n  title: Example");
 * ```
 */
export const upgradeOasTo32 = async (
  input: OpenApiInput,
  options: UpgradeOptions = {},
): Promise<UpgradedDocument> => {
  const {
    validateResult = true,
    checkVersion = true,
    maxDepth = DEFAULT_MAX_DEPTH,
  } = options;

  const isObjectInput = isPlainObject(input);

  // 1. Input shape guard: accept only strings or plain objects.
  if (typeof input !== "string" && !isObjectInput) {
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.InvalidInput,
      `The input must be a plain object or a JSON/YAML string, but ` +
        `received ${describeValue(input)}.`,
    );
  }

  // 2. Circular-reference guard for object input (strings are parsed by
  //    validate() and cannot contain JS-level cycles).
  if (isObjectInput) {
    assertNoCircularReference(input, maxDepth);
  }

  // 3. Defensive deep copy for object input so downstream upgraders cannot
  //    mutate the caller's document. String input is parsed fresh by validate().
  const safeInput = isObjectInput
    ? (deepCopy(input) as OpenApiDocument)
    : input;

  // 4. Parse and validate the input. validate() handles JSON/YAML strings
  //    and returns the parsed specification together with its version.
  let result: Awaited<ReturnType<typeof validateDocument>>;
  try {
    result = await validateDocument(safeInput as never);
  } catch (error) {
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.ParseOrValidateFailed,
      "The document could not be parsed or validated.",
      [],
      error,
    );
  }

  if (!result.valid || !result.specification) {
    const issues = (result.errors ?? []) as OpenApiValidationIssue[];
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.ParseOrValidateFailed,
      `The input is not a valid OpenAPI document: ${
        issues[0]?.message ?? "no issues were reported"
      }`,
      issues,
    );
  }

  // 5. First-stage upgrade: 2.0 / 3.0.x -> 3.1.
  //    3.1 and 3.2 documents skip this stage.
  const threeOne = THREE_ONE_OR_TWO_PATTERN.test(result.version)
    ? result.specification
    : await runFirstUpgrade(result.specification);

  // 6. Second-stage upgrade: 3.1 -> 3.2 (always runs, even for 3.2 input,
  //    so every caller gets output from the same normalisation path).
  let upgraded: UpgradedDocument;
  try {
    upgraded = upgradeFromThreeOneToThreeTwo(
      threeOne as never,
    ) as unknown as UpgradedDocument;
  } catch (error) {
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.SecondUpgradeFailed,
      "The 3.1-to-3.2 upgrader threw while converting the document.",
      [],
      error,
    );
  }

  // 7. Version assertion.
  if (checkVersion) {
    const version =
      (upgraded as Record<string, unknown>).openapi ??
      (upgraded as Record<string, unknown>).swagger;
    if (typeof version !== "string" || !TARGET_VERSION_PATTERN.test(version)) {
      throw new OpenApiUpgradeError(
        UpgradeErrorCode.VersionAssertionFailed,
        `The upgraded document does not declare OpenAPI 3.2.x ` +
          `(found: ${String(version)}).`,
      );
    }
  }

  // 8. Schema validation on the upgraded document.
  if (validateResult) {
    await runValidation(upgraded);
  }

  return upgraded;
};

// ---------------------------------------------------------------------------
// Internal upgrade stages (kept as small wrappers for clear error reporting)
// ---------------------------------------------------------------------------

const runFirstUpgrade = async (
  specification: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  let firstResult: Awaited<ReturnType<typeof upgradeToThreeOne>>;
  try {
    firstResult = await upgradeToThreeOne(specification as never);
  } catch (error) {
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.FirstUpgradeFailed,
      "The 2.0/3.0-to-3.1 upgrader threw while converting the document.",
      [],
      error,
    );
  }

  if (!firstResult.specification) {
    const issues = ((firstResult as { errors?: OpenApiValidationIssue[] }).errors ??
      []) as OpenApiValidationIssue[];
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.FirstUpgradeFailed,
      `The 2.0/3.0-to-3.1 upgrader did not return a valid specification: ${
        issues[0]?.message ?? "no issues were reported"
      }`,
      issues,
    );
  }

  return firstResult.specification as Record<string, unknown>;
};

const runValidation = async (document: UpgradedDocument): Promise<void> => {
  let validation: Awaited<ReturnType<typeof validateDocument>>;
  try {
    validation = await validateDocument(document as never);
  } catch (error) {
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.ValidationFailed,
      "The validator threw while checking the upgraded document.",
      [],
      error,
    );
  }

  if (!validation.valid) {
    const issues = (validation.errors ?? []) as OpenApiValidationIssue[];
    throw new OpenApiUpgradeError(
      UpgradeErrorCode.ValidationFailed,
      "The upgraded document is not valid OpenAPI 3.2: " +
        `${issues[0]?.message ?? "no issues were reported"}.`,
      issues,
    );
  }
};
