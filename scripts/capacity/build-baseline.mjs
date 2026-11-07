import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(
  new URL("../../artifacts/api-server/package.json", import.meta.url),
);
globalThis.require = require;
const { build } = require("esbuild");
const pino = require("esbuild-plugin-pino").default;
const revision = process.env.CAPACITY_BASELINE_REF ?? "0cbe3d5";
await build({
  entryPoints: {
    serverless: path.join(root, "artifacts/api-server/src/app.ts"),
  },
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: path.join(root, "artifacts/api-server/tmp/baseline"),
  outExtension: { ".js": ".mjs" },
  external: ["*.node", "bcryptjs", "pg-native"],
  plugins: [
    {
      name: "committed-baseline",
      setup(builder) {
        builder.onLoad({ filter: /\.tsx?$/ }, (args) => {
          if (args.path.includes("node_modules") || !args.path.startsWith(root))
            return;
          const relative = path.relative(root, args.path).replaceAll("\\", "/");
          return {
            contents: execFileSync("git", ["show", `${revision}:${relative}`], {
              cwd: root,
              encoding: "utf8",
              maxBuffer: 4000000,
            }),
            loader: args.path.endsWith("tsx") ? "tsx" : "ts",
          };
        });
      },
    },
    pino({ transports: ["pino-pretty"] }),
  ],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import __path from 'node:path'; import __url from 'node:url'; globalThis.require=__cr(import.meta.url); globalThis.__filename=__url.fileURLToPath(import.meta.url); globalThis.__dirname=__path.dirname(globalThis.__filename);",
  },
});
