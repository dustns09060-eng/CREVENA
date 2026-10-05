// Lets `node --experimental-strip-types` load the project's extensionless
// relative imports ("./types") that the Next/TypeScript toolchain accepts.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err && err.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) {
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {
          // try the next candidate
        }
      }
    }
    throw err;
  }
}
