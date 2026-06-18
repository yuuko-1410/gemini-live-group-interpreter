import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createServerApp } from "../src/server/app";

describe("server routes", () => {
  test("returns health status", async () => {
    const app = createServerApp();
    const response = await app.handle(new Request("http://localhost/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("translates text through the injected translator", async () => {
    const app = createServerApp({
      translator: {
        translateText: async (input) => ({
          translatedText: `${input.text} -> ${input.targetLanguage}`,
        }),
        translateTextStream: async function* (input) {
          yield `${input.text} `;
          yield input.targetLanguage;
        },
        synthesizeSpeech: async () => new Uint8Array(),
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/translate/text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "你好",
          sourceLanguage: "zh-Hans",
          targetLanguage: "en",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      translatedText: "你好 -> en",
    });
  });

  test("streams text translation chunks as newline-delimited events", async () => {
    const app = createServerApp({
      translator: {
        translateText: async () => ({ translatedText: "" }),
        translateTextStream: async function* (input) {
          yield `${input.text} `;
          yield input.targetLanguage;
        },
        synthesizeSpeech: async () => new Uint8Array(),
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/translate/text-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "你好",
          sourceLanguage: "zh-Hans",
          targetLanguage: "en",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await response.text()).toBe(
      '{"type":"chunk","text":"你好 "}\n{"type":"chunk","text":"en"}\n{"type":"done"}\n',
    );
  });

  test("streams upstream errors as events instead of hanging up", async () => {
    const app = createServerApp({
      translator: {
        translateText: async () => ({ translatedText: "" }),
        translateTextStream: async function* () {
          throw new Error("missing_gemini_api_key");
        },
        synthesizeSpeech: async () => new Uint8Array(),
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/translate/text-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "你好",
          sourceLanguage: "zh-Hans",
          targetLanguage: "en",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '{"type":"error","message":"missing_gemini_api_key"}\n',
    );
  });

  test("rejects text translation with unsupported language", async () => {
    const app = createServerApp();
    const response = await app.handle(
      new Request("http://localhost/api/translate/text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "hello",
          sourceLanguage: "en",
          targetLanguage: "xx-YY",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "invalid_request",
      message: "Unsupported language.",
    });
  });

  test("creates an in-memory meeting with a host", async () => {
    const app = createServerApp();
    const response = await app.handle(
      new Request("http://localhost/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hostName: "主持人",
          hostLanguage: "zh-Hans",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meeting.id).toHaveLength(8);
    expect(body.meeting.participants[0]).toMatchObject({
      displayName: "主持人",
      language: "zh-Hans",
      role: "host",
    });
  });

  test("creates a meeting using a client-provided room id", async () => {
    const app = createServerApp();
    const roomId = "3f3c701d-6246-49e3-8ce9-6f4f922df93c";

    const firstResponse = await app.handle(
      new Request("http://localhost/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId: roomId,
          hostName: "Yuuko",
          hostLanguage: "zh-Hans",
        }),
      }),
    );

    const secondResponse = await app.handle(
      new Request("http://localhost/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId: roomId,
          hostName: "Guest",
          hostLanguage: "en",
        }),
      }),
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect((await firstResponse.json()).meeting.id).toBe(roomId);
    expect((await secondResponse.json()).meeting.id).toBe(roomId);
  });

  test("creates an empty meeting before websocket join", async () => {
    const app = createServerApp();
    const roomId = "room-before-ws-join";

    const response = await app.handle(
      new Request("http://localhost/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId: roomId,
          hostName: "Yuuko",
          hostLanguage: "zh-Hans",
          empty: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meeting.id).toBe(roomId);
    expect(body.meeting.participants).toEqual([]);
  });

  test("serves the built frontend from the backend process", async () => {
    const distDir = await createClientDistFixture();
    const app = createServerApp({ clientDistDir: distDir });

    const indexResponse = await app.handle(new Request("http://localhost/"));
    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get("content-type")).toContain("text/html");
    expect(await indexResponse.text()).toContain("translate app");

    const assetResponse = await app.handle(new Request("http://localhost/assets/app.js"));
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toContain("text/javascript");
    expect(assetResponse.headers.get("cache-control")).toContain("immutable");
    expect(await assetResponse.text()).toBe("console.log('client');");
  });

  test("falls back to index.html for client routes without shadowing API paths", async () => {
    const distDir = await createClientDistFixture();
    const app = createServerApp({ clientDistDir: distDir });

    const clientRouteResponse = await app.handle(
      new Request("http://localhost/room?id=abc"),
    );
    expect(clientRouteResponse.status).toBe(200);
    expect(await clientRouteResponse.text()).toContain("translate app");

    const apiResponse = await app.handle(new Request("http://localhost/api/missing"));
    expect(apiResponse.status).toBe(404);
    expect(apiResponse.headers.get("content-type")).toContain("application/json");
  });
});

async function createClientDistFixture(): Promise<string> {
  const distDir = await mkdtemp(join(tmpdir(), "translate-client-dist-"));
  await mkdir(join(distDir, "assets"));
  await Bun.write(join(distDir, "index.html"), "<!doctype html><title>translate app</title>");
  await Bun.write(join(distDir, "assets/app.js"), "console.log('client');");
  return distDir;
}
