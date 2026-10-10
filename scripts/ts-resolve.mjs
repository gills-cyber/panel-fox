// Registers a resolve hook so `node --test` can import app modules that use
// the `@/` alias and extensionless relative imports (as Vite resolves them).
import { register } from "node:module";
register("./ts-resolve-hooks.mjs", import.meta.url);
