import { describe, expect, test } from "bun:test";
import { parseClientMessage } from "../src/shared/ws-protocol";

describe("websocket protocol", () => {
  test("accepts valid client control messages", () => {
    expect(
      parseClientMessage({
        type: "join",
        displayName: "Alice",
        language: "en",
      }),
    ).toEqual({
      ok: true,
      message: {
        type: "join",
        displayName: "Alice",
        language: "en",
      },
    });

    expect(
      parseClientMessage({
        type: "start_speaking",
      }),
    ).toEqual({
      ok: true,
      message: {
        type: "start_speaking",
      },
    });

    expect(
      parseClientMessage({
        type: "chat_message",
        text: "Can everyone see the captions?",
      }),
    ).toEqual({
      ok: true,
      message: {
        type: "chat_message",
        text: "Can everyone see the captions?",
      },
    });

    expect(
      parseClientMessage({
        type: "set_mode",
        mode: "face_to_face",
      }),
    ).toEqual({
      ok: true,
      message: {
        type: "set_mode",
        mode: "face_to_face",
      },
    });
  });

  test("rejects unknown message types and unsupported languages", () => {
    expect(parseClientMessage({ type: "join", language: "xx-YY" }).ok).toBe(false);
    expect(parseClientMessage({ type: "set_mode", mode: "walkie_talkie" }).ok).toBe(false);
    expect(parseClientMessage({ type: "unknown" }).ok).toBe(false);
    expect(parseClientMessage(null).ok).toBe(false);
  });
});
