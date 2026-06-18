export type ResolvedRoomUrl = {
  roomId: string;
  href: string;
  created: boolean;
};

type RoomIdCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

export function createRandomRoomId(cryptoLike: RoomIdCrypto | undefined = globalThis.crypto): string {
  if (typeof cryptoLike?.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoLike?.getRandomValues === "function") {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function resolveRoomUrl(
  href: string,
  createRoomId: () => string = createRandomRoomId,
): ResolvedRoomUrl {
  const url = new URL(href);
  const existingRoomId = url.searchParams.get("room")?.trim();

  if (existingRoomId) {
    return {
      roomId: existingRoomId,
      href: url.toString(),
      created: false,
    };
  }

  const roomId = createRoomId();
  url.searchParams.set("room", roomId);

  return {
    roomId,
    href: url.toString(),
    created: true,
  };
}
