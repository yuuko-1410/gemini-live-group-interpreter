import { describe, expect, test } from "bun:test";
import {
  createGeminiLiveWebSocketUrl,
  createSetupMessage,
  formatGeminiLiveError,
  waitForGeminiLiveDrain,
} from "../src/server/gemini-live";

describe("gemini live websocket", () => {
  test("builds the official Live Translate websocket url without a double slash before ws", () => {
    const liveUrl = createGeminiLiveWebSocketUrl("test key");

    expect(liveUrl).toStartWith(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=",
    );
    expect(liveUrl).not.toContain("googleapis.com//ws/");
    expect(liveUrl).toContain("key=test%20key");
  });

  test("builds a Live Translate setup message", () => {
    expect(createSetupMessage("en")).toEqual({
      setup: {
        model: "models/gemini-3.5-live-translate-preview",
        generationConfig: {
          responseModalities: ["AUDIO"],
          translationConfig: {
            targetLanguageCode: "en",
            echoTargetLanguage: true,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
  });

  test("redacts api keys from websocket errors", () => {
    const message = formatGeminiLiveError({
      type: "error",
      message:
        "WebSocket connection to 'wss://generativelanguage.googleapis.com/ws/path?key=secret-key' failed",
      error: {
        url: "wss://generativelanguage.googleapis.com/ws/path?key=secret-key",
      },
    });

    expect(message).toContain("key=[REDACTED]");
    expect(message).not.toContain("secret-key");
  });

  test("waits for a quiet drain window before closing after audio stream end", async () => {
    let lastMessageAt = Date.now();
    setTimeout(() => {
      lastMessageAt = Date.now();
    }, 12);

    const startedAt = Date.now();
    await waitForGeminiLiveDrain(() => lastMessageAt, {
      minMs: 20,
      idleMs: 18,
      maxMs: 120,
    });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
  });
});
