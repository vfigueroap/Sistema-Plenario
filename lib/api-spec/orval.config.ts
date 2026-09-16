import path from "path";

// Este archivo no importa nada de "orval" a propósito. El cortafuegos de
// paquetes de Replit bloquea la descarga de orval, y tenerlo declarado como
// dependencia hacía fallar `pnpm install` entero — es decir, impedía levantar
// la aplicación por culpa de una herramienta que sólo se usa para generar
// código. El código generado está versionado, así que orval se invoca por
// npx sólo cuando hace falta (ver el script "codegen"), y aquí exportamos un
// objeto plano en vez de usar su helper `defineConfig`, que sólo aporta tipos.

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer = (config: { info?: { title?: string } }) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default {
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
};
