import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Elysia } from "elysia";
import { isSupportedLanguage, type LanguageCode } from "../shared/languages";
import { parseClientMessage, type ServerMessage } from "../shared/ws-protocol";
import { createGeminiTranslator } from "./gemini";
import { createGeminiLiveTranslateFactory } from "./gemini-live";
import {
  createMeetingLiveCoordinator,
  type LiveTranslateFactory,
  type LiveTranslateSession,
} from "./live-session";
import { createMeetingStore } from "./meeting-store";
import { type Translator } from "./translator";

type ServerAppDependencies = {
  translator?: Translator;
  meetingStore?: ReturnType<typeof createMeetingStore>;
  liveTranslateFactory?: LiveTranslateFactory;
  clientDistDir?: string;
};

const defaultClientDistDir = fileURLToPath(new URL("../../dist", import.meta.url));

export function createServerApp(dependencies: ServerAppDependencies = {}) {
  const translator = dependencies.translator ?? createGeminiTranslator();
  const meetingStore = dependencies.meetingStore ?? createMeetingStore();
  const liveTranslateFactory =
    dependencies.liveTranslateFactory ?? createGeminiLiveTranslateFactory();
  const clientDistDir = dependencies.clientDistDir ?? defaultClientDistDir;
  const meetingClients = new Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >();
  const faceToFaceBuffers = new Map<string, FaceToFaceBuffer>();
  const personalSessions = new WeakMap<WebSocketLike, Promise<LiveTranslateSession>>();
  const meetingLive = createMeetingLiveCoordinator({
    store: meetingStore,
    factory: liveTranslateFactory,
    callbacks: {
      onTranscript(event) {
        if (!event.meetingId) return;
        if (shouldBufferFaceToFaceEvent(meetingStore, event.meetingId)) {
          getFaceToFaceBuffer(faceToFaceBuffers, event.meetingId, event.speakerId).transcripts.push({
            type: "transcript",
            id: createEventId(),
            timestamp: new Date().toISOString(),
            speakerId: event.speakerId,
            speakerName: event.speakerName,
            language: event.targetLanguage,
            sourceText: event.sourceText,
            translatedText: event.translatedText,
            targetLanguage: event.targetLanguage,
          });
          return;
        }
        logMeeting("transcript", {
          meetingId: event.meetingId,
          speakerId: event.speakerId,
          targetLanguage: event.targetLanguage,
          sourceChars: event.sourceText?.length ?? 0,
          translatedChars: event.translatedText?.length ?? 0,
        });
        broadcastToLanguage(meetingClients, event.meetingId, event.targetLanguage, {
          type: "transcript",
          id: createEventId(),
          timestamp: new Date().toISOString(),
          speakerId: event.speakerId,
          speakerName: event.speakerName,
          language: event.targetLanguage,
          sourceText: event.sourceText,
          translatedText: event.translatedText,
        });
      },
      onAudio(event) {
        if (!event.meetingId) return;
        if (shouldBufferFaceToFaceEvent(meetingStore, event.meetingId)) {
          getFaceToFaceBuffer(faceToFaceBuffers, event.meetingId, event.speakerId).audio.push({
            targetLanguage: event.targetLanguage,
            audio: event.audio,
          });
          return;
        }
        logMeeting("translated_audio", {
          meetingId: event.meetingId,
          speakerId: event.speakerId,
          targetLanguage: event.targetLanguage,
          bytes: event.audio.byteLength,
        });
        broadcastAudioToLanguage(
          meetingClients,
          event.meetingId,
          event.targetLanguage,
          event.audio,
        );
      },
      onError(event) {
        if (!event.meetingId) return;
        logMeeting("live_error", {
          meetingId: event.meetingId,
          speakerId: event.speakerId,
          targetLanguage: event.targetLanguage,
          message: event.message,
        });
        broadcastToMeeting(meetingClients, event.meetingId, {
          type: "error",
          code: "live_translate_upstream_error",
          message: event.message,
        });
      },
      onStatus(event) {
        if (!event.meetingId) return;
        logMeeting("live_status", {
          meetingId: event.meetingId,
          speakerId: event.speakerId,
          targetLanguage: event.targetLanguage,
          code: event.code,
        });
        broadcastToMeeting(meetingClients, event.meetingId, {
          type: "live_status",
          code: event.code,
          message: event.message,
          speakerId: event.speakerId,
          targetLanguage: event.targetLanguage,
          timestamp: new Date().toISOString(),
        });
      },
    },
  });

  return new Elysia()
    .get("/api/health", () => ({ ok: true }))
    .post("/api/translate/text", async ({ body, set }) => {
      const parsed = parseTextTranslationBody(body);
      if (!parsed.ok) {
        set.status = 400;
        return invalidRequest(parsed.message);
      }

      try {
        return await translator.translateText(parsed.input);
      } catch (error) {
        set.status = 502;
        return upstreamError(error);
      }
    })
    .post("/api/translate/text-stream", ({ body, set }) => {
      const parsed = parseTextTranslationBody(body);
      if (!parsed.ok) {
        set.status = 400;
        return invalidRequest(parsed.message);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of translator.translateTextStream(parsed.input)) {
              controller.enqueue(encoder.encode(toNdjson({ type: "chunk", text: chunk })));
            }
            controller.enqueue(encoder.encode(toNdjson({ type: "done" })));
            controller.close();
          } catch (error) {
            controller.enqueue(
              encoder.encode(
                toNdjson({
                  type: "error",
                  message:
                    error instanceof Error ? error.message : "Text translation stream failed.",
                }),
              ),
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    })
    .post("/api/translate/tts", async ({ body, set }) => {
      const parsed = parseTtsBody(body);
      if (!parsed.ok) {
        set.status = 400;
        return invalidRequest(parsed.message);
      }

      try {
        const audio = await translator.synthesizeSpeech(parsed.input);
        const body = new ArrayBuffer(audio.byteLength);
        new Uint8Array(body).set(audio);
        return new Response(body, {
          headers: {
            "content-type": "audio/pcm;rate=24000",
            "cache-control": "no-store",
          },
        });
      } catch (error) {
        set.status = 502;
        return upstreamError(error);
      }
    })
    .post("/api/meetings", ({ body, set }) => {
      const parsed = parseCreateMeetingBody(body);
      if (!parsed.ok) {
        set.status = 400;
        return invalidRequest(parsed.message);
      }

      const meeting = meetingStore.createMeeting(parsed.input);
      logMeeting("created", {
        meetingId: meeting.id,
        empty: parsed.input.empty === true,
        hostLanguage: parsed.input.hostLanguage,
      });
      return { meeting };
    })
    .get("/api/meetings/:id", ({ params, set }) => {
      try {
        return { meeting: meetingStore.getMeeting(params.id) };
      } catch {
        set.status = 404;
        return {
          code: "meeting_not_found",
          message: "Meeting was not found.",
        };
      }
    })
    .ws("/ws/interpret/:targetLanguage", {
      async open(ws) {
        const targetLanguage = ws.data.params?.targetLanguage;
        if (!isSupportedLanguage(targetLanguage)) {
          sendJson(ws, {
            type: "error",
            code: "unsupported_language",
            message: "Unsupported language.",
          });
          ws.close();
          return;
        }

        try {
          const session = await liveTranslateFactory.create({
            targetLanguage,
            callbacks: {
              onTranscript(event) {
                sendJson(ws, {
                  type: "transcript",
                  language: event.targetLanguage,
                  sourceText: event.sourceText,
                  translatedText: event.translatedText,
                });
              },
              onAudio(event) {
                ws.send(event.audio);
              },
            },
          });
          personalSessions.set(ws, Promise.resolve(session));
        } catch (error) {
          sendJson(ws, {
            type: "error",
            code: "live_translate_unavailable",
            message: error instanceof Error ? error.message : "Live translation is unavailable.",
          });
          ws.close();
        }
      },
      async message(ws, message) {
        const control = parseWsControlMessage(message);
        if (control) {
          if (control.ok && control.message.type === "ping") {
            sendJson(ws, { type: "pong" });
          }
          return;
        }

        const session = await personalSessions.get(ws);
        if (session) {
          await session.sendAudio(toUint8Array(message));
        }
      },
      async close(ws) {
        const session = await personalSessions.get(ws);
        await session?.close();
        personalSessions.delete(ws);
      },
    })
    .ws("/ws/meetings/:id", {
      message(ws, message) {
        const meetingId = ws.data.params?.id ?? "";
        const client = findMeetingClient(meetingClients, meetingId, ws);
        const parsed = parseWsControlMessage(message);

        if (!parsed) {
          if (client) {
            const audio = toUint8Array(message);
            logAudioFrame(meetingId, client.participantId, audio.byteLength);
            const meeting = meetingStore.getMeeting(meetingId);
            if (meeting.activeSpeakerId === client.participantId) {
              broadcastToMeeting(meetingClients, meetingId, {
                type: "audio_activity",
                speakerId: client.participantId,
                timestamp: new Date().toISOString(),
              });
            }
            void meetingLive.handleSpeakerAudio(
              meetingId,
              client.participantId,
              audio,
            ).catch((error) => {
              sendJson(ws, {
                type: "error",
                code: "live_translate_unavailable",
                message:
                  error instanceof Error ? error.message : "Live translation is unavailable.",
              });
            });
          }
          return;
        }

        if (!parsed.ok) {
          sendJson(ws, {
            type: "error",
            code: parsed.error,
            message: "Invalid WebSocket message.",
          });
          return;
        }

        if (parsed.message.type === "join") {
          try {
            const participant = joinOrReuseHost(meetingStore, meetingClients, meetingId, {
              displayName: parsed.message.displayName,
              language: parsed.message.language,
            });
            const clients = getMeetingClients(meetingClients, meetingId);
            clients.add({
              ws: getStableSocket(ws),
              participantId: participant.id,
              language: participant.language,
            });
            sendJson(ws, {
              type: "joined",
              meetingId,
              participantId: participant.id,
            });
            logMeeting("joined", {
              meetingId,
              participantId: participant.id,
              language: participant.language,
              clients: clients.size,
            });
            broadcastMeetingState(meetingClients, meetingId, meetingStore.getMeeting(meetingId));
          } catch {
            logMeeting("join_failed", { meetingId });
            sendJson(ws, {
              type: "error",
              code: "meeting_not_found",
              message: "Meeting was not found.",
            });
          }
        }

        if (parsed.message.type === "set_language") {
          if (!client) return;
          meetingStore.updateParticipantLanguage(
            meetingId,
            client.participantId,
            parsed.message.language,
          );
          client.language = parsed.message.language;
          logMeeting("language_changed", {
            meetingId,
            participantId: client.participantId,
            language: client.language,
          });
          broadcastMeetingState(meetingClients, meetingId, meetingStore.getMeeting(meetingId));
        }

        if (parsed.message.type === "set_mode") {
          if (!client) return;
          const meeting = meetingStore.setMode(meetingId, parsed.message.mode);
          faceToFaceBuffers.delete(meetingId);
          logMeeting("mode_changed", {
            meetingId,
            participantId: client.participantId,
            mode: parsed.message.mode,
          });
          broadcastToMeeting(meetingClients, meetingId, {
            type: "mode_changed",
            mode: parsed.message.mode,
          });
          broadcastMeetingState(meetingClients, meetingId, meeting);
        }

        if (parsed.message.type === "start_speaking") {
          if (!client) return;
          const result = meetingStore.acquireSpeaker(meetingId, client.participantId);
          if (!result.ok) {
            logMeeting("speaker_rejected", {
              meetingId,
              participantId: client.participantId,
              reason: result.reason,
            });
            sendJson(ws, {
              type: "error",
              code: result.reason,
              message: "Another participant is speaking.",
            });
            return;
          }
          logMeeting("speaker_started", {
            meetingId,
            participantId: client.participantId,
          });
          broadcastToMeeting(meetingClients, meetingId, {
            type: "speaker_changed",
            speakerId: result.speakerId,
          });
        }

        if (parsed.message.type === "stop_speaking") {
          if (!client) return;
          const meetingBeforeStop = meetingStore.getMeeting(meetingId);
          if (meetingBeforeStop.activeSpeakerId !== client.participantId) {
            logMeeting("speaker_stop_ignored", {
              meetingId,
              participantId: client.participantId,
              activeSpeakerId: meetingBeforeStop.activeSpeakerId ?? "none",
            });
            return;
          }
          const shouldFlushFaceToFace =
            meetingBeforeStop.mode === "face_to_face" &&
            meetingBeforeStop.activeSpeakerId === client.participantId;
          logMeeting("speaker_stopped", {
            meetingId,
            participantId: client.participantId,
          });
          audioFrameLogCounts.delete(`${meetingId}:${client.participantId}`);
          if (shouldFlushFaceToFace) {
            void meetingLive
              .stopSpeaker(meetingId, client.participantId)
              .then(() =>
                flushFaceToFaceBuffer({
                  buffers: faceToFaceBuffers,
                  clientsByMeeting: meetingClients,
                  meetingStore,
                  meetingId,
                  speakerId: client.participantId,
                }),
              );
          } else {
            void meetingLive.stopSpeaker(meetingId, client.participantId);
          }
          broadcastToMeeting(meetingClients, meetingId, {
            type: "speaker_changed",
            speakerId: null,
          });
        }

        if (parsed.message.type === "chat_message") {
          if (!client) return;
          const meeting = meetingStore.getMeeting(meetingId);
          const participant = meeting.participants.find((item) => item.id === client.participantId);
          broadcastToMeeting(meetingClients, meetingId, {
            type: "chat_message",
            id: createEventId(),
            participantId: client.participantId,
            displayName: participant?.displayName ?? "Guest",
            text: parsed.message.text,
            timestamp: new Date().toISOString(),
          });
        }

        if (parsed.message.type === "ping") {
          sendJson(ws, { type: "pong" });
        }
      },
      close(ws) {
        const meetingId = ws.data.params?.id ?? "";
        const client = findMeetingClient(meetingClients, meetingId, ws);
        if (!client) return;

        logMeeting("disconnected", {
          meetingId,
          participantId: client.participantId,
        });
        audioFrameLogCounts.delete(`${meetingId}:${client.participantId}`);
        deleteFaceToFaceSpeakerBuffer(faceToFaceBuffers, meetingId, client.participantId);
        void meetingLive.stopSpeaker(meetingId, client.participantId);
        const meeting = meetingStore.removeParticipant(meetingId, client.participantId);
        getMeetingClients(meetingClients, meetingId).delete(client);
        if (meeting) {
          broadcastMeetingState(meetingClients, meetingId, meeting);
        } else {
          logMeeting("deleted_empty_room", { meetingId });
          meetingClients.delete(meetingId);
          faceToFaceBuffers.delete(meetingId);
        }
      },
    })
    .get("/", ({ request }) => serveClientAsset(request, clientDistDir))
    .get("/*", ({ request }) => serveClientAsset(request, clientDistDir));
}

type SocketLike = {
  send(data: string | Uint8Array): void;
  close(): void;
};

type WebSocketLike = SocketLike & {
  raw?: SocketLike;
  data: {
    params?: Record<string, string>;
  };
};

type FaceToFaceTranscript = Extract<ServerMessage, { type: "transcript" }> & {
  targetLanguage: LanguageCode;
};

type FaceToFaceAudio = {
  targetLanguage: LanguageCode;
  audio: Uint8Array;
};

type FaceToFaceSpeakerBuffer = {
  transcripts: FaceToFaceTranscript[];
  audio: FaceToFaceAudio[];
};

type FaceToFaceBuffer = Map<string, FaceToFaceSpeakerBuffer>;

type ParseResult<T> =
  | {
      ok: true;
      input: T;
    }
  | {
      ok: false;
      message: string;
    };

function parseTextTranslationBody(body: unknown): ParseResult<{
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}> {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object." };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.text !== "string" || record.text.trim().length === 0) {
    return { ok: false, message: "Text is required." };
  }
  if (!isSupportedLanguage(record.sourceLanguage) || !isSupportedLanguage(record.targetLanguage)) {
    return { ok: false, message: "Unsupported language." };
  }

  return {
    ok: true,
    input: {
      text: record.text.trim(),
      sourceLanguage: record.sourceLanguage,
      targetLanguage: record.targetLanguage,
    },
  };
}

function parseTtsBody(body: unknown): ParseResult<{
  text: string;
  language: LanguageCode;
}> {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object." };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.text !== "string" || record.text.trim().length === 0) {
    return { ok: false, message: "Text is required." };
  }
  if (!isSupportedLanguage(record.language)) {
    return { ok: false, message: "Unsupported language." };
  }

  return {
    ok: true,
    input: {
      text: record.text.trim(),
      language: record.language,
    },
  };
}

function parseCreateMeetingBody(body: unknown): ParseResult<{
  meetingId?: string;
  hostName: string;
  hostLanguage: LanguageCode;
  empty?: boolean;
}> {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be an object." };
  }

  const record = body as Record<string, unknown>;
  if (!isSupportedLanguage(record.hostLanguage)) {
    return { ok: false, message: "Unsupported language." };
  }

  return {
    ok: true,
    input: {
      meetingId: parseMeetingId(record.meetingId),
      hostName: typeof record.hostName === "string" ? record.hostName.trim() : "Host",
      hostLanguage: record.hostLanguage,
      empty: record.empty === true,
    },
  };
}

function parseMeetingId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const roomId = value.trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(roomId)) return undefined;
  return roomId;
}

function invalidRequest(message: string) {
  return {
    code: "invalid_request",
    message,
  };
}

async function serveClientAsset(request: Request, distDir: string): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return jsonNotFound("API route was not found.");
  }
  if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
    return jsonNotFound("WebSocket route was not found.");
  }

  const assetPath = resolveClientAssetPath(distDir, url.pathname);
  if (!assetPath) {
    return new Response("Not found", { status: 404 });
  }

  const asset = Bun.file(assetPath);
  if (await asset.exists()) {
    return fileResponse(assetPath, asset);
  }

  if (extname(url.pathname) !== "") {
    return new Response("Not found", { status: 404 });
  }

  const indexPath = resolveClientAssetPath(distDir, "/index.html");
  if (!indexPath) {
    return new Response("Not found", { status: 404 });
  }

  const index = Bun.file(indexPath);
  if (!(await index.exists())) {
    return new Response("Client build was not found. Run `bun run build` first.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return fileResponse(indexPath, index);
}

function resolveClientAssetPath(distDir: string, pathname: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
  const candidate = resolve(distDir, relativePath);
  const relativeToDist = relative(distDir, candidate);
  if (relativeToDist.startsWith("..") || isAbsolute(relativeToDist)) {
    return null;
  }

  return candidate;
}

function fileResponse(path: string, file: Bun.BunFile): Response {
  const headers = new Headers();
  const contentType = contentTypeForPath(path);
  if (contentType) {
    headers.set("content-type", contentType);
  }
  headers.set(
    "cache-control",
    path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  );
  return new Response(file, { headers });
}

function contentTypeForPath(path: string): string | undefined {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".webmanifest":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    default:
      return undefined;
  }
}

function jsonNotFound(message: string): Response {
  return new Response(
    JSON.stringify({
      code: "not_found",
      message,
    }),
    {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

function upstreamError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown upstream error.";
  return {
    code: "upstream_error",
    message,
  };
}

function toNdjson(event: Record<string, unknown>): string {
  return `${JSON.stringify(event)}\n`;
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function parseWsControlMessage(message: unknown): ReturnType<typeof parseClientMessage> | null {
  if (typeof message === "string") {
    return parseClientMessage(safeParseJson(message));
  }

  if (isBinaryFrame(message)) {
    const control = parseBinaryJsonControlFrame(message);
    if (!isLikelyControlMessage(control)) return null;
    return parseClientMessage(control);
  }

  return parseClientMessage(message);
}

function isLikelyControlMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;

  const type = (message as Record<string, unknown>).type;
  return (
    type === "join" ||
    type === "set_language" ||
    type === "start_speaking" ||
    type === "stop_speaking" ||
    type === "chat_message" ||
    type === "ping"
  );
}

function isBinaryFrame(message: unknown): boolean {
  return (
    message instanceof Uint8Array ||
    message instanceof ArrayBuffer ||
    ArrayBuffer.isView(message)
  );
}

function toUint8Array(message: unknown): Uint8Array {
  if (message instanceof Uint8Array) return message;
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }
  return new Uint8Array();
}

function decodeJsonTextFrame(message: unknown): string | null {
  const bytes = toUint8Array(message);
  if (bytes.byteLength === 0) return null;

  const text = new TextDecoder().decode(bytes).trim();
  if (!text.startsWith("{")) return null;
  return text;
}

function parseBinaryJsonControlFrame(message: unknown): unknown | undefined {
  const text = decodeJsonTextFrame(message);
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sendJson(ws: SocketLike, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function getMeetingClients(
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >,
  meetingId: string,
) {
  let clients = clientsByMeeting.get(meetingId);
  if (!clients) {
    clients = new Set();
    clientsByMeeting.set(meetingId, clients);
  }
  return clients;
}

function findMeetingClient(
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >,
  meetingId: string,
  ws: WebSocketLike,
) {
  const stableSocket = getStableSocket(ws);
  return [...getMeetingClients(clientsByMeeting, meetingId)].find(
    (client) => client.ws === stableSocket,
  );
}

function getStableSocket(ws: WebSocketLike): SocketLike {
  return ws.raw ?? ws;
}

function joinOrReuseHost(
  meetingStore: ReturnType<typeof createMeetingStore>,
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >,
  meetingId: string,
  input: { displayName: string; language: LanguageCode },
) {
  const meeting = meetingStore.getMeeting(meetingId);
  const existingClients = getMeetingClients(clientsByMeeting, meetingId);
  const hostIsConnected = [...existingClients].some(
    (client) => client.participantId === meeting.hostId,
  );
  const host = meeting.hostId
    ? meeting.participants.find((participant) => participant.id === meeting.hostId)
    : null;

  if (!hostIsConnected && host?.displayName === input.displayName) {
    return meetingStore.updateParticipantLanguage(meetingId, host.id, input.language);
  }

  return meetingStore.joinMeeting(meetingId, input);
}

function broadcastToMeeting(
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >,
  meetingId: string,
  message: ServerMessage,
): void {
  for (const client of getMeetingClients(clientsByMeeting, meetingId)) {
    sendJson(client.ws, message);
  }
}

function broadcastMeetingState(
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >,
  meetingId: string,
  meeting: unknown,
): void {
  broadcastToMeeting(clientsByMeeting, meetingId, {
    type: "meeting_state",
    meeting,
  });
}

function broadcastToLanguage(
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >,
  meetingId: string,
  language: LanguageCode,
  message: ServerMessage,
): void {
  for (const client of getMeetingClients(clientsByMeeting, meetingId)) {
    if (client.language === language) {
      sendJson(client.ws, message);
    }
  }
}

function broadcastAudioToLanguage(
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >,
  meetingId: string,
  language: LanguageCode,
  audio: Uint8Array,
): void {
  for (const client of getMeetingClients(clientsByMeeting, meetingId)) {
    if (client.language === language) {
      client.ws.send(audio);
    }
  }
}

function shouldBufferFaceToFaceEvent(
  meetingStore: ReturnType<typeof createMeetingStore>,
  meetingId: string,
): boolean {
  try {
    const meeting = meetingStore.getMeeting(meetingId);
    return meeting.mode === "face_to_face" && Boolean(meeting.activeSpeakerId);
  } catch {
    return false;
  }
}

function getFaceToFaceBuffer(
  buffers: Map<string, FaceToFaceBuffer>,
  meetingId: string,
  speakerId?: string,
): FaceToFaceSpeakerBuffer {
  const participantKey = speakerId ?? "unknown";
  let meetingBuffer = buffers.get(meetingId);
  if (!meetingBuffer) {
    meetingBuffer = new Map();
    buffers.set(meetingId, meetingBuffer);
  }

  let speakerBuffer = meetingBuffer.get(participantKey);
  if (!speakerBuffer) {
    speakerBuffer = { transcripts: [], audio: [] };
    meetingBuffer.set(participantKey, speakerBuffer);
  }

  return speakerBuffer;
}

function deleteFaceToFaceSpeakerBuffer(
  buffers: Map<string, FaceToFaceBuffer>,
  meetingId: string,
  speakerId: string,
): void {
  const meetingBuffer = buffers.get(meetingId);
  if (!meetingBuffer) return;
  meetingBuffer.delete(speakerId);
  if (meetingBuffer.size === 0) {
    buffers.delete(meetingId);
  }
}

function flushFaceToFaceBuffer(input: {
  buffers: Map<string, FaceToFaceBuffer>;
  clientsByMeeting: Map<
    string,
    Set<{ ws: SocketLike; participantId: string; language: LanguageCode }>
  >;
  meetingStore: ReturnType<typeof createMeetingStore>;
  meetingId: string;
  speakerId: string;
}): void {
  const meetingBuffer = input.buffers.get(input.meetingId);
  const buffer = meetingBuffer?.get(input.speakerId);
  if (!buffer || (buffer.transcripts.length === 0 && buffer.audio.length === 0)) {
    deleteFaceToFaceSpeakerBuffer(input.buffers, input.meetingId, input.speakerId);
    return;
  }

  let totalAudioBytes = 0;
  try {
    input.meetingStore.setPlaybackActive(input.meetingId, true);
    broadcastToMeeting(input.clientsByMeeting, input.meetingId, {
      type: "playback_started",
      speakerId: input.speakerId,
      timestamp: new Date().toISOString(),
    });
    broadcastMeetingState(
      input.clientsByMeeting,
      input.meetingId,
      input.meetingStore.getMeeting(input.meetingId),
    );

    for (const transcript of buffer.transcripts) {
      const { targetLanguage, ...message } = transcript;
      broadcastToLanguage(input.clientsByMeeting, input.meetingId, targetLanguage, message);
    }

    for (const item of buffer.audio) {
      totalAudioBytes += item.audio.byteLength;
      broadcastAudioToLanguage(
        input.clientsByMeeting,
        input.meetingId,
        item.targetLanguage,
        item.audio,
      );
    }
  } finally {
    deleteFaceToFaceSpeakerBuffer(input.buffers, input.meetingId, input.speakerId);
  }

  const playbackMs = estimatePlaybackDurationMs(totalAudioBytes);
  setTimeout(() => {
    try {
      input.meetingStore.setPlaybackActive(input.meetingId, false);
      broadcastToMeeting(input.clientsByMeeting, input.meetingId, {
        type: "playback_finished",
        timestamp: new Date().toISOString(),
      });
      broadcastMeetingState(
        input.clientsByMeeting,
        input.meetingId,
        input.meetingStore.getMeeting(input.meetingId),
      );
    } catch {
      input.buffers.delete(input.meetingId);
    }
  }, playbackMs);
}

function estimatePlaybackDurationMs(totalAudioBytes: number): number {
  if (totalAudioBytes <= 0) return 800;
  const pcmBytesPerSecond = 24_000 * 2;
  return Math.min(8_000, Math.max(800, Math.ceil((totalAudioBytes / pcmBytesPerSecond) * 1000)));
}

function createEventId(): string {
  return crypto.randomUUID();
}

const audioFrameLogCounts = new Map<string, number>();

function logAudioFrame(meetingId: string, participantId: string, bytes: number): void {
  const key = `${meetingId}:${participantId}`;
  const count = (audioFrameLogCounts.get(key) ?? 0) + 1;
  audioFrameLogCounts.set(key, count);

  if (count === 1 || count % 500 === 0) {
    logMeeting("ws_audio_frame", {
      meetingId,
      participantId,
      bytes,
      frameCount: count,
    });
  }
}

function logMeeting(event: string, fields: Record<string, unknown>): void {
  console.info(`[meeting] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
