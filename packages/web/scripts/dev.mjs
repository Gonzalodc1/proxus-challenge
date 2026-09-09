import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Runs the Tailwind watcher and the Vite dev server together.
 *
 * The previous `dev` script did this with `sh -c '... & vite; kill $!'`, which
 * needs a POSIX shell and job control. On Windows it fails before starting:
 * `'sh' is not recognized`, and Vite then receives `kill` and `$!` as stray
 * arguments. That put a platform gate on the whole project for no reason.
 *
 * Kept dependency-free on purpose. The challenge asks not to add frameworks,
 * and a task runner would be a dependency to solve twenty lines of process
 * handling. Both tools are launched through `process.execPath` using the entry
 * point declared in their own `package.json`, which avoids the `.cmd` shims
 * that cannot be spawned without a shell, and means killing the child actually
 * kills the tool rather than an intermediate shell.
 */

const require = createRequire(import.meta.url);

const binaryOf = (packageName, binName) => {
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];

  if (typeof entry !== "string") {
    throw new Error(`No se encontró el ejecutable "${binName}" en ${packageName}.`);
  }

  return resolve(dirname(manifestPath), entry);
};

const start = (file, args) =>
  spawn(process.execPath, [file, ...args], { stdio: "inherit" });

const tailwind = start(binaryOf("@tailwindcss/cli", "tailwindcss"), [
  "-i",
  "src/styles.input.css",
  "-o",
  "src/styles.generated.css",
  // `always` instead of a bare `--watch`: the CLI stops watching when stdin
  // closes, which is exactly what happens to a child process launched from a
  // script. Without it the watcher exits right after the first build and the
  // dev server is left serving CSS that never rebuilds.
  "--watch=always"
]);

const vite = start(binaryOf("vite", "vite"), process.argv.slice(2));

let stopping = false;
const stopAll = () => {
  if (stopping) {
    return;
  }
  stopping = true;
  tailwind.kill();
  vite.kill();
};

// Vite owns the session: when it ends, so does the watcher, and its exit code
// is what the script reports so a failed start is still a failed command.
vite.on("exit", (code) => {
  stopAll();
  process.exit(code ?? 0);
});

// If the watcher dies on its own, styles would silently stop rebuilding.
// Better to bring the whole thing down than to leave a dev server that quietly
// serves stale CSS.
tailwind.on("exit", (code) => {
  if (!stopping) {
    console.error(`\nEl watcher de Tailwind terminó (código ${code ?? 0}). Cerrando el servidor de desarrollo.`);
    stopAll();
    process.exit(code ?? 1);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}
