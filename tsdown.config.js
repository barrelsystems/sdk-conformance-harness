import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
  // `platform: "node"` auto-enables `fixedExtension` (.mjs/.d.mts); this
  // package's exports map expects .js/.d.ts, matching its `type: "module"`.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
