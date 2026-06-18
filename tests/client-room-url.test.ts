import { describe, expect, test } from "bun:test";
import { createRandomRoomId, resolveRoomUrl } from "../src/client/room-url";

describe("client room url", () => {
  test("keeps the room id from the current link", () => {
    const result = resolveRoomUrl("https://example.com/app?room=room-12345678", () => "new-room");

    expect(result.roomId).toBe("room-12345678");
    expect(result.created).toBe(false);
    expect(result.href).toBe("https://example.com/app?room=room-12345678");
  });

  test("creates a room id when the link has no room", () => {
    const result = resolveRoomUrl("https://example.com/app?name=Yuuko", () => "new-room");

    expect(result.roomId).toBe("new-room");
    expect(result.created).toBe(true);
    expect(result.href).toBe("https://example.com/app?name=Yuuko&room=new-room");
  });

  test("creates a fallback uuid when crypto.randomUUID is unavailable", () => {
    const result = createRandomRoomId({
      getRandomValues: (array: Uint8Array) => {
        array.fill(1);
        return array;
      },
    });

    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
