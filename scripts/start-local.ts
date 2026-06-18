const envFile = await loadDotEnv(".env");
const runtimeEnv = {
  ...envFile,
  ...process.env,
};

const apiPort = runtimeEnv.PORT ?? runtimeEnv.API_PORT ?? "18080";
const webPort = runtimeEnv.WEB_PORT ?? "18081";
const apiOrigin = `http://localhost:${apiPort}`;

const children: Bun.Subprocess[] = [];

function spawn(name: string, command: string[], env: Record<string, string>) {
  const child = Bun.spawn(command, {
    env: {
      ...runtimeEnv,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  children.push(child);
  pipe(name, child.stdout);
  pipe(name, child.stderr);
  return child;
}

function pipe(name: string, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  void (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      for (const line of text.split("\n")) {
        if (line.trim().length > 0) {
          console.log(`[${name}] ${line}`);
        }
      }
    }
  })();
}

function shutdown() {
  for (const child of children) {
    child.kill();
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

console.log(`Starting API on ${apiOrigin}`);
console.log(`Starting app on http://127.0.0.1:${webPort}`);
console.log(`Gemini API key: ${runtimeEnv.GEMINI_API_KEY ? "configured" : "missing"}`);
console.log("Press Ctrl+C to stop both processes.");

spawn("api", ["bun", "run", "dev:api"], {
  PORT: apiPort,
});

spawn("web", ["bun", "run", "dev:web", "--", "--port", webPort], {
  TRANSLATE_API_ORIGIN: apiOrigin,
});

await Promise.race(children.map((child) => child.exited));
shutdown();

async function loadDotEnv(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path);
  if (!file.size) return {};

  const text = await file.text();
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!key) continue;

    values[key] = stripQuotes(rawValue);
  }

  return values;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
