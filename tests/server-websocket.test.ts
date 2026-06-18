import { afterEach, describe, expect, test } from "bun:test";
import { createServerApp } from "../src/server/app";
import { type LiveTranslateFactory } from "../src/server/live-session";
import { createMeetingStore } from "../src/server/meeting-store";
import { type ServerMessage } from "../src/shared/ws-protocol";

const runningApps: Array<ReturnType<typeof createServerApp>> = [];

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.stop(true)));
});

describe("meeting websocket", () => {
  test("joins a meeting after receiving a JSON control message", async () => {
    const app = startTestApp();
    runningApps.push(app);

    const port = app.server?.port;
    expect(port).toBeNumber();

    const meetingId = `ws-join-${Date.now()}`;
    const createResponse = await fetch(`http://localhost:${port}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        hostName: "Probe",
        hostLanguage: "zh-Hans",
      }),
    });
    expect(createResponse.status).toBe(200);

    const firstMessage = await joinMeeting(`ws://localhost:${port}/ws/meetings/${meetingId}`);

    expect(firstMessage).toMatchObject({
      type: "joined",
      meetingId,
    });
    expect(firstMessage.participantId).toBeString();
  });

  test("treats non-json binary frames as audio even when they start with a brace byte", async () => {
    const app = startTestApp();
    runningApps.push(app);

    const port = app.server?.port;
    expect(port).toBeNumber();

    const meetingId = `ws-audio-${Date.now()}`;
    const createResponse = await fetch(`http://localhost:${port}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        hostName: "Probe",
        hostLanguage: "zh-Hans",
      }),
    });
    expect(createResponse.status).toBe(200);

    const result = await sendBracePrefixedAudio(
      `ws://localhost:${port}/ws/meetings/${meetingId}`,
    );

    expect(result.invalidMessageReceived).toBe(false);
  });

  test("treats binary json without a known control type as audio", async () => {
    const app = startTestApp();
    runningApps.push(app);

    const port = app.server?.port;
    expect(port).toBeNumber();

    const meetingId = `ws-json-audio-${Date.now()}`;
    const createResponse = await fetch(`http://localhost:${port}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        hostName: "Probe",
        hostLanguage: "zh-Hans",
        empty: true,
      }),
    });
    expect(createResponse.status).toBe(200);

    const result = await sendBinaryFrameAfterJoin({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      frame: new TextEncoder().encode("{}"),
    });

    expect(result.invalidMessageReceived).toBe(false);
  });

  test("broadcasts updated member list after a participant disconnects", async () => {
    const app = startTestApp();
    runningApps.push(app);

    const port = app.server?.port;
    expect(port).toBeNumber();

    const meetingId = `ws-cleanup-${Date.now()}`;
    const createResponse = await fetch(`http://localhost:${port}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        hostName: "Host",
        hostLanguage: "zh-Hans",
        empty: true,
      }),
    });
    expect(createResponse.status).toBe(200);

    const first = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Alice",
      language: "zh-Hans",
    });
    const second = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Bob",
      language: "en",
    });

    const twoMemberState = await second.nextMeetingState();
    expect(twoMemberState.participants.map((participant) => participant.displayName)).toEqual([
      "Alice",
      "Bob",
    ]);

    first.close();

    const afterDisconnect = await second.nextMeetingState();
    expect(afterDisconnect.participants.map((participant) => participant.displayName)).toEqual([
      "Bob",
    ]);

    second.close();
  });

  test("broadcasts audio activity when the active speaker sends audio", async () => {
    const app = startTestApp();
    runningApps.push(app);

    const port = app.server?.port;
    expect(port).toBeNumber();

    const meetingId = `ws-activity-${Date.now()}`;
    const createResponse = await fetch(`http://localhost:${port}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        hostName: "Host",
        hostLanguage: "zh-Hans",
        empty: true,
      }),
    });
    expect(createResponse.status).toBe(200);

    const first = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Alice",
      language: "zh-Hans",
    });
    const second = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Bob",
      language: "en",
    });
    await second.nextMeetingState();

    first.send({ type: "start_speaking" });
    first.sendBinary(new Uint8Array([1, 2, 3, 4]));

    const activity = await second.nextMessage("audio_activity");
    expect(activity).toMatchObject({
      type: "audio_activity",
      speakerId: first.participantId,
    });

    first.close();
    second.close();
  });

  test("ignores stop_speaking from a participant who is not the active speaker", async () => {
    const app = startTestApp();
    runningApps.push(app);

    const port = app.server?.port;
    expect(port).toBeNumber();

    const meetingId = `ws-stop-ignore-${Date.now()}`;
    const createResponse = await fetch(`http://localhost:${port}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        hostName: "Host",
        hostLanguage: "zh-Hans",
        empty: true,
      }),
    });
    expect(createResponse.status).toBe(200);

    const first = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Alice",
      language: "zh-Hans",
    });
    const second = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Bob",
      language: "en",
    });
    await second.nextMeetingState();

    first.send({ type: "start_speaking" });
    await second.nextMessage("speaker_changed");
    second.send({ type: "stop_speaking" });

    expect(await second.hasMessageWithin("speaker_changed", 120)).toBe(false);
    first.sendBinary(new Uint8Array([1, 2, 3, 4]));
    const activity = await second.nextMessage("audio_activity");
    expect(activity).toMatchObject({
      type: "audio_activity",
      speakerId: first.participantId,
    });

    first.close();
    second.close();
  });

  test("delays face-to-face translated transcript until the speaker stops", async () => {
    const factory: LiveTranslateFactory = {
      create: async ({ callbacks, targetLanguage }) => ({
        sendAudio: async () => {
          callbacks.onTranscript?.({
            targetLanguage,
            sourceText: "你好",
            translatedText: "Hello",
          });
        },
        close: async () => undefined,
      }),
    };
    const app = startTestApp(factory);
    runningApps.push(app);

    const port = app.server?.port;
    expect(port).toBeNumber();

    const meetingId = `ws-face-${Date.now()}`;
    const createResponse = await fetch(`http://localhost:${port}/api/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meetingId,
        hostName: "Host",
        hostLanguage: "zh-Hans",
        empty: true,
      }),
    });
    expect(createResponse.status).toBe(200);

    const first = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Alice",
      language: "zh-Hans",
    });
    const second = await connectParticipant({
      url: `ws://localhost:${port}/ws/meetings/${meetingId}`,
      displayName: "Bob",
      language: "en",
    });
    await second.nextMeetingState();

    first.send({ type: "set_mode", mode: "face_to_face" });
    await second.nextMessage("mode_changed");
    first.send({ type: "start_speaking" });
    first.sendBinary(new Uint8Array([1, 2, 3]));

    expect(await second.hasMessageWithin("transcript", 120)).toBe(false);

    first.send({ type: "stop_speaking" });
    const playbackStarted = await second.nextMessage("playback_started");
    expect(playbackStarted).toMatchObject({
      type: "playback_started",
      speakerId: first.participantId,
    });

    const transcript = await second.nextMessage("transcript");
    expect(transcript).toMatchObject({
      type: "transcript",
      speakerId: first.participantId,
      language: "en",
      translatedText: "Hello",
    });

    first.close();
    second.close();
  });
});

function startTestApp(liveTranslateFactory?: LiveTranslateFactory): ReturnType<typeof createServerApp> {
  let lastError: unknown;
  const factory =
    liveTranslateFactory ??
    ({
      create: async () => ({
        sendAudio: async () => undefined,
        close: async () => undefined,
      }),
    } satisfies LiveTranslateFactory);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = 19000 + Math.floor(Math.random() * 1000);
    try {
      return createServerApp({
        meetingStore: createMeetingStore(),
        liveTranslateFactory: factory,
      }).listen(port);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("failed_to_start_test_server");
}

async function joinMeeting(url: string): Promise<Extract<ServerMessage, { type: "joined" }>> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("websocket_join_timeout"));
    }, 3000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          displayName: "Probe",
          language: "zh-Hans",
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      clearTimeout(timeout);
      ws.close();
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type !== "joined") {
        reject(new Error(`expected_joined_received_${message.type}`));
        return;
      }
      resolve(message);
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket_error"));
    });
  });
}

async function sendBracePrefixedAudio(
  url: string,
): Promise<{ invalidMessageReceived: boolean }> {
  return await sendBinaryFrameAfterJoin({
    url,
    frame: new Uint8Array([123, 0, 1, 2, 3, 4, 5]),
  });
}

async function sendBinaryFrameAfterJoin(input: {
  url: string;
  frame: Uint8Array;
}): Promise<{ invalidMessageReceived: boolean }> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(input.url);
    let joined = false;
    let invalidMessageReceived = false;
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ invalidMessageReceived });
    }, 300);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          displayName: "Probe",
          language: "zh-Hans",
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "joined" && !joined) {
        joined = true;
        ws.send(input.frame);
        return;
      }

      if (message.type === "error") {
        invalidMessageReceived = true;
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket_error"));
    });
  });
}

async function connectParticipant(input: {
  url: string;
  displayName: string;
  language: "zh-Hans" | "en" | "ru";
}): Promise<{
  close(): void;
  participantId: string;
  send(message: unknown): void;
  sendBinary(frame: Uint8Array): void;
  hasMessageWithin<T extends ServerMessage["type"]>(type: T, timeoutMs: number): Promise<boolean>;
  nextMessage<T extends ServerMessage["type"]>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  nextMeetingState(): Promise<import("../src/server/meeting-store").Meeting>;
}> {
  const ws = new WebSocket(input.url);
  let participantId = "";
  const messageQueue: ServerMessage[] = [];
  const meetingStateQueue: Array<import("../src/server/meeting-store").Meeting> = [];
  const messageWaiters: Array<{
    type: ServerMessage["type"];
    resolve(message: ServerMessage): void;
  }> = [];
  const waiters: Array<(meeting: import("../src/server/meeting-store").Meeting) => void> = [];

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("websocket_join_timeout"));
    }, 3000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "join",
          displayName: input.displayName,
          language: input.language,
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.type === "joined") {
        participantId = message.participantId;
        clearTimeout(timeout);
        resolve();
        return;
      }

      if (message.type === "meeting_state") {
        const meeting = message.meeting as import("../src/server/meeting-store").Meeting;
        const waiter = waiters.shift();
        if (waiter) {
          waiter(meeting);
        } else {
          meetingStateQueue.push(meeting);
        }
        return;
      }

      const waiterIndex = messageWaiters.findIndex((waiter) => waiter.type === message.type);
      if (waiterIndex >= 0) {
        const [waiter] = messageWaiters.splice(waiterIndex, 1);
        waiter?.resolve(message);
        return;
      }

      messageQueue.push(message);
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("websocket_error"));
    });
  });

  return {
    participantId,
    close() {
      ws.close();
    },
    send(message) {
      ws.send(JSON.stringify(message));
    },
    sendBinary(frame) {
      ws.send(frame);
    },
    async hasMessageWithin(type, timeoutMs) {
      const existingIndex = messageQueue.findIndex((message) => message.type === type);
      if (existingIndex >= 0) {
        messageQueue.splice(existingIndex, 1);
        return true;
      }

      return await new Promise((resolve) => {
        const waiter = {
          type,
          resolve() {
            clearTimeout(timeout);
            resolve(true);
          },
        };
        const timeout = setTimeout(() => {
          const waiterIndex = messageWaiters.indexOf(waiter);
          if (waiterIndex >= 0) {
            messageWaiters.splice(waiterIndex, 1);
          }
          resolve(false);
        }, timeoutMs);
        messageWaiters.push(waiter);
      });
    },
    async nextMessage(type) {
      const existingIndex = messageQueue.findIndex((message) => message.type === type);
      if (existingIndex >= 0) {
        const [message] = messageQueue.splice(existingIndex, 1);
        return message as Extract<ServerMessage, { type: typeof type }>;
      }

      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`${type}_timeout`)), 3000);
        messageWaiters.push({
          type,
          resolve(message) {
            clearTimeout(timeout);
            resolve(message as Extract<ServerMessage, { type: typeof type }>);
          },
        });
      });
    },
    async nextMeetingState() {
      const existing = meetingStateQueue.shift();
      if (existing) return existing;

      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("meeting_state_timeout")), 3000);
        waiters.push((meeting) => {
          clearTimeout(timeout);
          resolve(meeting);
        });
      });
    },
  };
}
