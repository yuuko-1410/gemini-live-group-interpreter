import { describe, expect, test } from "bun:test";
import { resolveRoomUrl } from "../src/client/room-url";

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
});
