import { defineConfig } from "tsup";

const shared = {
  entry: { index: "src/index.ts" },
  target: "node18",
  platform: "node" as const,
  sourcemap: false,
  minify: "terser" as const,
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    format: ["esm"],
    // Runs first and owns the output folder.
    clean: true,
    // Declarations are emitted once and shared by both formats.
    dts: true,
    // Scalar stays external so ESM consumers resolve it natively. Inlining it
    // here would force esbuild to shim require() for Scalar's CJS
    // dependencies, which fails at runtime under a real ESM loader.
  },
  {
    ...shared,
    format: ["cjs"],
    clean: false,
    dts: false,
    // Inlined so Electron's main process can require() this package even
    // though Scalar publishes ESM only.
    noExternal: [/^@scalar\//],
  },
]);