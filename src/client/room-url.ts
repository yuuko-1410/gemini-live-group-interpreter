export type ResolvedRoomUrl = {
  roomId: string;
  href: string;
  created: boolean;
};

export function resolveRoomUrl(
  href: string,
  createRoomId: () => string = () => crypto.randomUUID(),
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
