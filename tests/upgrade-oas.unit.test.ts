import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Document as Oas20Document } from "@scalar/openapi-types/2.0";
import type { Document as Oas30Document } from "@scalar/openapi-types/3.0";
import type { Document as Oas31Document } from "@scalar/openapi-types/3.1";
import type { Document as Oas32Document } from "@scalar/openapi-types/3.2";

/**
 * Mutable test harness. The mock factories below are hoisted above the
 * imports, so they may only close over this object and must never capture
 * values from the module scope directly.
 */
const harness = {
  validateCalls: [] as unknown[],
  validateImpl: (input: unknown): unknown => ({
    valid: true,
    specification: input,
    version: "3.1",
  }),

  firstStageCalls: [] as unknown[],
  firstStageImpl: (document: unknown): unknown => ({
    specification: {
      ...(document as Record<string, unknown>),
      openapi: "3.1.0",
    },
    version: "3.1",
  }),

  secondStageCalls: [] as unknown[],
  secondStageImpl: (document: unknown): unknown => ({
    ...(document as Record<string, unknown>),
    openapi: "3.2.0",
  }),

  /** Stage names in execution order, to assert the pipeline sequence. */
  order: [] as string[],
};

vi.mock("@scalar/openapi-parser", () => ({
  validate: (input: unknown) => {
    harness.order.push("validate");
    harness.validateCalls.push(input);
    return harness.validateImpl(input);
  },
  upgrade: (document: unknown) => {
    harness.order.push("first-stage");
    harness.firstStageCalls.push(document);
    return harness.firstStageImpl(document);
  },
  dereference: vi.fn(),
}));

vi.mock("@scalar/openapi-upgrader/3.1-to-3.2", () => ({
  upgradeFromThreeOneToThreeTwo: (document: unknown) => {
    harness.order.push("second-stage");
    harness.secondStageCalls.push(document);
    return harness.secondStageImpl(document);
  },
}));

const {
  OpenApiUpgradeError,
  UpgradeErrorCode,
  dereference,
  isOpenApiUpgradeError,
  upgrade,
  upgradeOasTo32,
  validate,
} = await import("../src/index.js");

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const swagger20 = {
  swagger: "2.0",
  info: { title: "Legacy API", version: "1.0.0" },
  paths: {},
} satisfies Oas20Document;

const oas30 = {
  openapi: "3.0.3",
  info: { title: "Old API", version: "1.0.0" },
  paths: {},
} satisfies Oas30Document;

const oas31 = {
  openapi: "3.1.0",
  info: { title: "Current API", version: "1.0.0" },
} satisfies Oas31Document;

const oas32 = {
  openapi: "3.2.0",
  info: { title: "Target API", version: "1.0.0" },
} satisfies Oas32Document;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Makes validate() report success with a fixed version and document. */
const validatesAs = (version: string, specification?: unknown): void => {
  harness.validateImpl = (input: unknown) => ({
    valid: true,
    specification: specification ?? input,
    version,
  });
};

/**
 * Resolves with the rejection reason, or throws if the promise fulfils.
 * Uses the two-argument then() so the reason stays typed as unknown.
 */
const captureRejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    (value) => {
      throw new Error(
        `expected a rejection, but the promise fulfilled with ${String(value)}`,
      );
    },
    (reason: unknown) => reason,
  );

/** Narrows an unknown rejection reason to OpenApiUpgradeError. */
const expectUpgradeError = (
  error: unknown,
): InstanceType<typeof OpenApiUpgradeError> => {
  if (!(error instanceof OpenApiUpgradeError)) {
    throw new Error(`expected OpenApiUpgradeError, received: ${String(error)}`);
  }
  return error;
};

beforeEach(() => {
  harness.validateCalls = [];
  harness.validateImpl = (input: unknown) => ({
    valid: true,
    specification: input,
    version: "3.1",
  });
  harness.firstStageCalls = [];
  harness.firstStageImpl = (document: unknown) => ({
    specification: {
      ...(document as Record<string, unknown>),
      openapi: "3.1.0",
    },
    version: "3.1",
  });
  harness.secondStageCalls = [];
  harness.secondStageImpl = (document: unknown) => ({
    ...(document as Record<string, unknown>),
    openapi: "3.2.0",
  });
  harness.order = [];
});

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — pipeline", () => {
  it("returns a 3.2 document for 3.1 input", async () => {
    const result = await upgradeOasTo32({ ...oas31 });
    expect(result.openapi).toBe("3.2.0");
    expect(result.info.title).toBe("Current API");
  });

  it("skips the 3.1 stage for 3.1 input", async () => {
    validatesAs("3.1");
    await upgradeOasTo32({ ...oas31 });
    expect(harness.firstStageCalls).toHaveLength(0);
    // validate is called twice: input validation + output validation
    expect(harness.order).toEqual(["validate", "second-stage", "validate"]);
  });

  it("skips the 3.1 stage for 3.2 input but still normalises it", async () => {
    validatesAs("3.2");
    await upgradeOasTo32({ ...oas32 });
    expect(harness.firstStageCalls).toHaveLength(0);
    expect(harness.secondStageCalls).toHaveLength(1);
  });

  it("runs both stages for Swagger 2.0 input", async () => {
    validatesAs("2.0");
    const result = await upgradeOasTo32({ ...swagger20 });
    expect(result.openapi).toBe("3.2.0");
    expect(harness.order).toEqual([
      "validate",
      "first-stage",
      "second-stage",
      "validate",
    ]);
  });

  it("runs both stages for 3.0.x input", async () => {
    validatesAs("3.0");
    await upgradeOasTo32({ ...oas30 });
    expect(harness.firstStageCalls).toHaveLength(1);
    expect(harness.secondStageCalls).toHaveLength(1);
  });

  it("validates before touching any upgrader", async () => {
    const input = { ...oas30 };
    validatesAs("3.0");
    await upgradeOasTo32(input);
    expect(harness.order[0]).toBe("validate");
    expect(harness.order[1]).toBe("first-stage");
  });

  it("validates the input and the output (twice total) by default", async () => {
    validatesAs("2.0");
    await upgradeOasTo32({ ...swagger20 });
    expect(harness.validateCalls).toHaveLength(2);
  });

  it("skips output validation when validateResult is false", async () => {
    validatesAs("2.0");
    await upgradeOasTo32({ ...swagger20 }, { validateResult: false });
    expect(harness.validateCalls).toHaveLength(1);
    expect(harness.order).toEqual(["validate", "first-stage", "second-stage"]);
  });

  it("feeds the validated document, not the raw input, into the pipeline", async () => {
    const normalized = { openapi: "3.1.0", info: { title: "Normalized" } };
    validatesAs("3.1", normalized);
    await upgradeOasTo32("openapi: 3.1.0");
    expect(harness.secondStageCalls[0]).toBe(normalized);
  });

  it("unwraps the { specification } envelope from the 3.1 stage", async () => {
    validatesAs("3.0");
    harness.firstStageImpl = () => ({
      specification: { openapi: "3.1.0", info: { title: "Rewritten" } },
      version: "3.1",
    });
    await upgradeOasTo32({ ...oas30 });
    expect(harness.secondStageCalls[0]).toEqual({
      openapi: "3.1.0",
      info: { title: "Rewritten" },
    });
  });

  it("awaits a 3.1 stage that returns a promise", async () => {
    validatesAs("3.0");
    harness.firstStageImpl = (document: unknown) =>
      Promise.resolve({
        specification: { ...(document as Record<string, unknown>) },
        version: "3.1",
      });
    const result = await upgradeOasTo32({ ...oas30 });
    expect(result.openapi).toBe("3.2.0");
  });

  it("awaits a validate implementation that returns a promise", async () => {
    harness.validateImpl = (input: unknown) =>
      Promise.resolve({ valid: true, specification: input, version: "3.1" });
    const result = await upgradeOasTo32({ ...oas31 });
    expect(result.openapi).toBe("3.2.0");
  });

  it("accepts an options object as the second argument", async () => {
    validatesAs("3.1");
    const result = await upgradeOasTo32({ ...oas31 }, { validateResult: false });
    expect(result.openapi).toBe("3.2.0");
    expect(harness.validateCalls).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Version branching                                                          */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — version branching", () => {
  const skipsFirstStage = ["3.1", "3.1.0", "3.1.1", "3.2", "3.2.0", "3.2.9"];
  const runsFirstStage = ["2.0", "3.0", "3.0.0", "3.0.4"];

  it.each(skipsFirstStage)("treats %s as already at 3.1+", async (version) => {
    validatesAs(version);
    await upgradeOasTo32({ ...oas31 }, { validateResult: false });
    expect(harness.firstStageCalls).toHaveLength(0);
  });

  it.each(runsFirstStage)("lifts %s through the 3.1 stage", async (version) => {
    validatesAs(version);
    await upgradeOasTo32({ ...oas30 }, { validateResult: false });
    expect(harness.firstStageCalls).toHaveLength(1);
  });

  it("only matches the version at the start of the string", async () => {
    // "13.1" must not be mistaken for 3.1 by the branching regex.
    validatesAs("13.1");
    await upgradeOasTo32({ ...oas30 }, { validateResult: false });
    expect(harness.firstStageCalls).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Zero input mutation                                                        */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — zero input mutation", () => {
  it("does not modify the caller's object", async () => {
    const input = { ...oas31, extra: "untouched" };
    const snapshot = JSON.parse(JSON.stringify(input));
    await upgradeOasTo32(input);
    expect(input).toEqual(snapshot);
  });

  it("passes a deep copy to the first-stage upgrader", async () => {
    validatesAs("3.0");
    const input = { ...oas30 };
    await upgradeOasTo32(input, { validateResult: false });
    // The upgrader receives a different object reference than the caller's.
    expect(harness.firstStageCalls[0]).not.toBe(input);
    expect(harness.firstStageCalls[0]).toEqual(input);
  });

  it("passes a deep copy to validate", async () => {
    validatesAs("3.1");
    const input = { ...oas31 };
    await upgradeOasTo32(input, { validateResult: false });
    expect(harness.validateCalls[0]).not.toBe(input);
    expect(harness.validateCalls[0]).toEqual(input);
  });
});

/* -------------------------------------------------------------------------- */
/* Input guards                                                               */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — input guards", () => {
  it("rejects null with INVALID_INPUT", async () => {
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32(null as never)),
    );
    expect(error.code).toBe(UpgradeErrorCode.InvalidInput);
    expect(error.message).toMatch(/null/);
  });

  it("rejects undefined with INVALID_INPUT", async () => {
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32(undefined as never)),
    );
    expect(error.code).toBe(UpgradeErrorCode.InvalidInput);
  });

  it("rejects an array with INVALID_INPUT", async () => {
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32([] as never)),
    );
    expect(error.code).toBe(UpgradeErrorCode.InvalidInput);
    expect(error.message).toMatch(/an array/);
  });

  it("rejects a number with INVALID_INPUT", async () => {
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32(42 as never)),
    );
    expect(error.code).toBe(UpgradeErrorCode.InvalidInput);
    expect(error.message).toMatch(/type number/);
  });

  it("accepts a JSON string", async () => {
    validatesAs("3.1");
    const result = await upgradeOasTo32(JSON.stringify(oas31), {
      validateResult: false,
    });
    expect(result.openapi).toBe("3.2.0");
  });

  it("accepts a YAML string", async () => {
    validatesAs("3.1");
    const yaml = "openapi: 3.1.0\ninfo:\n  title: YAML Test\n  version: 1.0.0";
    const result = await upgradeOasTo32(yaml, { validateResult: false });
    expect(result.openapi).toBe("3.2.0");
  });

  it("touches no upgrader for invalid input", async () => {
    await captureRejection(upgradeOasTo32(null as never));
    expect(harness.firstStageCalls).toHaveLength(0);
    expect(harness.secondStageCalls).toHaveLength(0);
    expect(harness.order).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Circular reference guard                                                   */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — circular reference guard", () => {
  it("rejects a document with a direct circular reference", async () => {
    const doc: Record<string, unknown> = { openapi: "3.1.0", info: {} };
    doc.self = doc;
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32(doc as never)),
    );
    expect(error.code).toBe(UpgradeErrorCode.CircularReference);
  });

  it("rejects a document with a nested circular reference", async () => {
    const doc: Record<string, unknown> = {
      openapi: "3.1.0",
      info: {},
      components: { schemas: {} },
    };
    (doc.components as Record<string, unknown>).loop = doc;
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32(doc as never)),
    );
    expect(error.code).toBe(UpgradeErrorCode.CircularReference);
  });

  it("rejects a circular reference inside an array", async () => {
    const doc: Record<string, unknown> = { openapi: "3.1.0", info: {} };
    doc.items = [doc];
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32(doc as never)),
    );
    expect(error.code).toBe(UpgradeErrorCode.CircularReference);
  });

  it("disables the guard when maxDepth is 0", async () => {
    validatesAs("3.1");
    const doc: Record<string, unknown> = { openapi: "3.1.0", info: {} };
    doc.self = doc;
    // With maxDepth: 0, the guard is skipped. validate receives the cyclic
    // object and (in this mock) returns it, so the pipeline completes.
    const result = await upgradeOasTo32(doc as never, {
      maxDepth: 0,
      validateResult: false,
    });
    expect(result.openapi).toBe("3.2.0");
  });

  it("does not flag a deeply nested but acyclic document", async () => {
    validatesAs("3.1");
    const doc = {
      openapi: "3.1.0",
      info: { title: "Deep" },
      a: { b: { c: { d: { e: { f: { g: "deep" } } } } } },
    };
    const result = await upgradeOasTo32(doc as never, { validateResult: false });
    expect(result.openapi).toBe("3.2.0");
  });

  it("stops scanning when depth exceeds maxDepth", async () => {
    validatesAs("3.1");
    // maxDepth = 1: root (depth 0) is scanned, children (depth 1) are scanned,
    // but grandchildren (depth 2) are skipped by the depth > maxDepth guard.
    const doc = {
      openapi: "3.1.0",
      info: { title: "Shallow scan" },
      level1: { level2: { level3: "too deep" } },
    };
    const result = await upgradeOasTo32(doc as never, {
      maxDepth: 1,
      validateResult: false,
    });
    expect(result.openapi).toBe("3.2.0");
  });
});

/* -------------------------------------------------------------------------- */
/* Validation failures                                                        */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — validation failures", () => {
  it("rejects an invalid document and exposes the raw issues", async () => {
    const errors = [{ message: "first" }, { message: "second" }];
    harness.validateImpl = () => ({ valid: false, errors });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.ParseOrValidateFailed);
    expect(error.message).toContain("not a valid OpenAPI document");
    expect(error.message).toContain("first");
    expect(error.issues).toEqual(errors);
  });

  it("reports only the first issue in the message", async () => {
    harness.validateImpl = () => ({
      valid: false,
      errors: [{ message: "missing info" }, { message: "bad path" }],
    });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.message).not.toContain("bad path");
  });

  it("handles an invalid result with no errors array", async () => {
    harness.validateImpl = () => ({ valid: false });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.message).toContain("no issues were reported");
    expect(error.issues).toEqual([]);
  });

  it("rejects when validate reports success but returns no specification", async () => {
    harness.validateImpl = () => ({ valid: true, version: "3.1" });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.ParseOrValidateFailed);
    expect(error.message).toContain("not a valid OpenAPI document");
    expect(harness.secondStageCalls).toHaveLength(0);
  });

  it("wraps an error thrown by validate as cause", async () => {
    const boom = new Error("validator exploded");
    harness.validateImpl = () => {
      throw boom;
    };
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32("::: broken yaml")),
    );
    expect(error.code).toBe(UpgradeErrorCode.ParseOrValidateFailed);
    expect(error.message).toMatch(/could not be parsed or validated/i);
    expect(error.cause).toBe(boom);
  });

  it("wraps a rejected validate promise as cause", async () => {
    const boom = new Error("async validator failure");
    harness.validateImpl = () => Promise.reject(boom);
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32("::: broken yaml")),
    );
    expect(error.cause).toBe(boom);
  });

  it("touches no upgrader when validation fails", async () => {
    harness.validateImpl = () => ({ valid: false });
    await captureRejection(upgradeOasTo32({ ...oas31 }));
    expect(harness.firstStageCalls).toHaveLength(0);
    expect(harness.secondStageCalls).toHaveLength(0);
    expect(harness.order).toEqual(["validate"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Upgrade failures                                                           */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — upgrade failures", () => {
  it("wraps an error thrown by the 3.1 stage", async () => {
    const boom = new Error("parser exploded");
    validatesAs("3.0");
    harness.firstStageImpl = () => {
      throw boom;
    };
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas30 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.FirstUpgradeFailed);
    expect(error.cause).toBe(boom);
    expect(harness.secondStageCalls).toHaveLength(0);
  });

  it("wraps a rejection from the 3.1 stage", async () => {
    const boom = new Error("async failure");
    validatesAs("3.0");
    harness.firstStageImpl = () => Promise.reject(boom);
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas30 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.FirstUpgradeFailed);
    expect(error.cause).toBe(boom);
  });

  it("wraps an error thrown by the 3.2 stage", async () => {
    const boom = new Error("upgrader exploded");
    harness.secondStageImpl = () => {
      throw boom;
    };
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.SecondUpgradeFailed);
    expect(error.cause).toBe(boom);
  });

  it("rejects when the 3.1 stage returns no specification", async () => {
    validatesAs("3.0");
    harness.firstStageImpl = () => ({ version: "3.1" });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas30 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.FirstUpgradeFailed);
    expect(harness.secondStageCalls).toHaveLength(0);
  });

  it("uses fallback message when 3.1 stage returns empty errors array", async () => {
    validatesAs("3.0");
    harness.firstStageImpl = () => ({ version: "3.1", errors: [] });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas30 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.FirstUpgradeFailed);
    expect(error.message).toContain("no issues were reported");
    expect(error.issues).toEqual([]);
  });

  it("uses fallback message when 3.1 stage issue has no message field", async () => {
    validatesAs("3.0");
    harness.firstStageImpl = () => ({
      version: "3.1",
      errors: [{ path: "/openapi" }],
    });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas30 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.FirstUpgradeFailed);
    expect(error.message).toContain("no issues were reported");
    expect(error.issues).toEqual([{ path: "/openapi" }]);
  });
});

/* -------------------------------------------------------------------------- */
/* Version assertion                                                          */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — version assertion", () => {
  it("rejects when the upgraded document does not declare 3.2.x", async () => {
    validatesAs("3.1");
    harness.secondStageImpl = (document: unknown) => ({
      ...(document as Record<string, unknown>),
      openapi: "3.1.0", // not upgraded
    });
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 }, { validateResult: false })),
    );
    expect(error.code).toBe(UpgradeErrorCode.VersionAssertionFailed);
  });

  it("skips version assertion when checkVersion is false", async () => {
    validatesAs("3.1");
    harness.secondStageImpl = (document: unknown) => ({
      ...(document as Record<string, unknown>),
      openapi: "3.1.0", // not upgraded, but assertion is disabled
    });
    const result = await upgradeOasTo32(
      { ...oas31 },
      { checkVersion: false, validateResult: false },
    );
    expect(result.openapi).toBe("3.1.0");
  });

  it("checks swagger field when openapi is absent in version assertion", async () => {
    validatesAs("3.1");
    harness.secondStageImpl = (document: unknown) => {
      const { openapi, ...rest } = document as Record<string, unknown>;
      return { ...rest, swagger: "2.0" };
    };
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 }, { validateResult: false })),
    );
    expect(error.code).toBe(UpgradeErrorCode.VersionAssertionFailed);
    expect(error.message).toContain("2.0");
  });
});

/* -------------------------------------------------------------------------- */
/* Output validation failures                                                 */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — output validation failures", () => {
  it("rejects when the upgraded document fails schema validation", async () => {
    // First validate (input) succeeds, second validate (output) fails.
    let callCount = 0;
    harness.validateImpl = (input: unknown) => {
      callCount++;
      if (callCount === 1) {
        return { valid: true, specification: input, version: "3.1" };
      }
      return { valid: false, errors: [{ message: "output schema invalid" }] };
    };
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.ValidationFailed);
    expect(error.message).toContain("output schema invalid");
    expect(error.issues).toEqual([{ message: "output schema invalid" }]);
  });

  it("wraps an error thrown during output validation", async () => {
    let callCount = 0;
    harness.validateImpl = (input: unknown) => {
      callCount++;
      if (callCount === 1) {
        return { valid: true, specification: input, version: "3.1" };
      }
      throw new Error("output validator crashed");
    };
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.ValidationFailed);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toBe("output validator crashed");
  });

  it("handles output validation failure with no errors array", async () => {
    let callCount = 0;
    harness.validateImpl = (input: unknown) => {
      callCount++;
      if (callCount === 1) {
        return { valid: true, specification: input, version: "3.1" };
      }
      return { valid: false };
    };
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32({ ...oas31 })),
    );
    expect(error.code).toBe(UpgradeErrorCode.ValidationFailed);
    expect(error.message).toContain("no issues were reported");
    expect(error.issues).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Deep copy failures                                                         */
/* -------------------------------------------------------------------------- */

describe("upgradeOasTo32 — deep copy failures", () => {
  it("rejects with INVALID_INPUT when structuredClone throws", async () => {
    // structuredClone throws DataCloneError for functions, Symbols, etc.
    const docWithFunction = {
      openapi: "3.1.0",
      info: { title: "Bad" },
      badFn: (): void => {},
    } as never;
    const error = expectUpgradeError(
      await captureRejection(upgradeOasTo32(docWithFunction)),
    );
    expect(error.code).toBe(UpgradeErrorCode.InvalidInput);
    expect(error.message).toMatch(/could not be cloned/i);
    expect(error.cause).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Error class                                                                */
/* -------------------------------------------------------------------------- */

describe("OpenApiUpgradeError", () => {
  it("is an Error with a stable name and machine-readable code", () => {
    const error = new OpenApiUpgradeError(UpgradeErrorCode.InvalidInput, "boom");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OpenApiUpgradeError);
    expect(error.name).toBe("OpenApiUpgradeError");
    expect(error.message).toBe("boom");
    expect(error.code).toBe(UpgradeErrorCode.InvalidInput);
  });

  it("defaults issues to an empty array and leaves cause unset", () => {
    const error = new OpenApiUpgradeError(UpgradeErrorCode.InvalidInput, "boom");
    expect(error.issues).toEqual([]);
    expect("cause" in error).toBe(false);
  });

  it("omits cause when it is explicitly undefined", () => {
    const error = new OpenApiUpgradeError(
      UpgradeErrorCode.InvalidInput,
      "boom",
      [],
      undefined,
    );
    expect("cause" in error).toBe(false);
  });

  it("retains a falsy cause that is not undefined", () => {
    const error = new OpenApiUpgradeError(
      UpgradeErrorCode.InvalidInput,
      "boom",
      [],
      null,
    );
    expect("cause" in error).toBe(true);
    expect(error.cause).toBeNull();
  });

  it("stores the issues it is given by reference", () => {
    const issues = [{ message: "a" }, { path: "/b" }];
    const error = new OpenApiUpgradeError(
      UpgradeErrorCode.ValidationFailed,
      "boom",
      issues,
    );
    expect(error.issues).toBe(issues);
  });

  it("captures a stack trace", () => {
    const error = new OpenApiUpgradeError(UpgradeErrorCode.InvalidInput, "boom");
    expect(typeof error.stack).toBe("string");
    expect(error.stack).toContain("OpenApiUpgradeError");
  });

  it("survives instanceof after being thrown and caught", () => {
    const thrown = ((): unknown => {
      try {
        throw new OpenApiUpgradeError(UpgradeErrorCode.InvalidInput, "boom");
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(OpenApiUpgradeError);
  });
});

/* -------------------------------------------------------------------------- */
/* Type guard                                                                 */
/* -------------------------------------------------------------------------- */

describe("isOpenApiUpgradeError", () => {
  it("returns true for OpenApiUpgradeError instances", () => {
    const error = new OpenApiUpgradeError(UpgradeErrorCode.InvalidInput, "boom");
    expect(isOpenApiUpgradeError(error)).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(isOpenApiUpgradeError(new Error("plain"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isOpenApiUpgradeError("string")).toBe(false);
    expect(isOpenApiUpgradeError(42)).toBe(false);
    expect(isOpenApiUpgradeError(null)).toBe(false);
    expect(isOpenApiUpgradeError(undefined)).toBe(false);
    expect(isOpenApiUpgradeError({})).toBe(false);
  });

  it("narrows the type in a catch block", async () => {
    try {
      await upgradeOasTo32(null as never);
      throw new Error("should have thrown");
    } catch (err) {
      if (isOpenApiUpgradeError(err)) {
        expect(err.code).toBe(UpgradeErrorCode.InvalidInput);
        expect(typeof err.message).toBe("string");
      } else {
        throw new Error("expected OpenApiUpgradeError");
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

describe("public surface", () => {
  it("re-exports the parser helpers", () => {
    expect(typeof dereference).toBe("function");
    expect(typeof upgrade).toBe("function");
    expect(typeof validate).toBe("function");
  });

  it("exports the documented API", () => {
    expect(typeof upgradeOasTo32).toBe("function");
    expect(typeof OpenApiUpgradeError).toBe("function");
    expect(typeof isOpenApiUpgradeError).toBe("function");
    expect(typeof UpgradeErrorCode).toBe("object");
  });

  it("exports all error codes", () => {
    expect(UpgradeErrorCode.InvalidInput).toBe("INVALID_INPUT");
    expect(UpgradeErrorCode.ParseOrValidateFailed).toBe("PARSE_OR_VALIDATE_FAILED");
    expect(UpgradeErrorCode.FirstUpgradeFailed).toBe("FIRST_UPGRADE_FAILED");
    expect(UpgradeErrorCode.SecondUpgradeFailed).toBe("SECOND_UPGRADE_FAILED");
    expect(UpgradeErrorCode.VersionAssertionFailed).toBe("VERSION_ASSERTION_FAILED");
    expect(UpgradeErrorCode.ValidationFailed).toBe("VALIDATION_FAILED");
    expect(UpgradeErrorCode.CircularReference).toBe("CIRCULAR_REFERENCE");
  });
});
