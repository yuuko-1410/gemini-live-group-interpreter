import { createHash, randomBytes } from "node:crypto";
import { connect as connectTcp, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { type LanguageCode } from "../shared/languages";
import { type LiveTranslateFactory } from "./live-session";

const LIVE_TRANSLATE_MODEL =
  process.env.GEMINI_LIVE_TRANSLATE_MODEL ?? "gemini-3.5-live-translate-preview";
const LIVE_CONNECT_TIMEOUT_MS = parsePositiveInteger(
  process.env.GEMINI_LIVE_CONNECT_TIMEOUT_MS,
  10000,
);
const LIVE_DRAIN_MIN_MS = parsePositiveInteger(process.env.GEMINI_LIVE_DRAIN_MIN_MS, 700);
const LIVE_DRAIN_IDLE_MS = parsePositiveInteger(process.env.GEMINI_LIVE_DRAIN_IDLE_MS, 600);
const LIVE_DRAIN_MAX_MS = parsePositiveInteger(process.env.GEMINI_LIVE_DRAIN_MAX_MS, 3000);
const LIVE_WEBSOCKET_BASE_URL =
  process.env.GEMINI_LIVE_WEBSOCKET_BASE_URL ??
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

type GeminiLiveMessage = {
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    inputTranscription?: {
      text?: string;
      languageCode?: string;
    };
    outputTranscription?: {
      text?: string;
      languageCode?: string;
    };
    modelTurn?: {
      parts?: Array<{
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
      }>;
    };
  };
};

type GeminiLiveSocket = {
  readonly isOpen: boolean;
  send(data: string): void;
  close(): void;
  onMessage(listener: (data: string) => void): void;
  onError(listener: (error: unknown) => void): void;
  onClose(listener: (event: { code: number; reason: string }) => void): void;
};

export function createGeminiLiveTranslateFactory(): LiveTranslateFactory {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      async create() {
        throw new Error("missing_gemini_api_key");
      },
    };
  }

  return {
    async create({ targetLanguage, callbacks }) {
      let inputTranscriptCount = 0;
      let outputTranscriptCount = 0;
      let outputAudioChunkCount = 0;
      let inputAudioFrameCount = 0;
      let serverMessageCount = 0;
      let lastServerMessageAt = Date.now();
      const url = createGeminiLiveWebSocketUrl(apiKey);
      const proxyUrl = getProxyUrl();

      logGemini("connecting", {
        targetLanguage,
        model: LIVE_TRANSLATE_MODEL,
        websocketBaseUrl: LIVE_WEBSOCKET_BASE_URL,
        proxy: proxyUrl ? sanitizeProxyUrl(proxyUrl) : "none",
        timeoutMs: LIVE_CONNECT_TIMEOUT_MS,
      });

      const socket = await connectGeminiLiveWebSocket(url, LIVE_CONNECT_TIMEOUT_MS, proxyUrl);
      logGemini("opened", { targetLanguage });

      let markSetupComplete: (() => void) | undefined;
      const setupComplete = new Promise<void>((resolve) => {
        markSetupComplete = resolve;
      });

      socket.onMessage((data) => {
        lastServerMessageAt = Date.now();
        const message = parseGeminiLiveMessage(data);
        if (!message) {
          logGemini("server_message_parse_failed", {
            targetLanguage,
            bytes: data.length,
            preview: redactSensitiveUrlParts(data).slice(0, 300),
          });
          return;
        }
        serverMessageCount += 1;
        logGeminiServerMessage(message, targetLanguage, serverMessageCount);

        if (message.setupComplete) {
          logGemini("setup_complete", { targetLanguage });
          markSetupComplete?.();
        }

        const content = message.serverContent;
        const sourceText = content?.inputTranscription?.text;
        const translatedText = content?.outputTranscription?.text;

        if (sourceText || translatedText) {
          if (sourceText) inputTranscriptCount += 1;
          if (translatedText) outputTranscriptCount += 1;
          logGemini("transcript", {
            targetLanguage,
            inputTranscriptCount,
            outputTranscriptCount,
            sourceChars: sourceText?.length ?? 0,
            translatedChars: translatedText?.length ?? 0,
          });
          callbacks.onTranscript?.({
            sourceText,
            translatedText,
            targetLanguage,
          });
        }

        for (const part of content?.modelTurn?.parts ?? []) {
          const data = part.inlineData?.data;
          if (!data) continue;

          outputAudioChunkCount += 1;
          if (outputAudioChunkCount === 1 || outputAudioChunkCount % 25 === 0) {
            logGemini("audio_chunk", {
              targetLanguage,
              chunkCount: outputAudioChunkCount,
              base64Bytes: data.length,
            });
          }
          callbacks.onAudio?.({
            audio: Uint8Array.from(Buffer.from(data, "base64")),
            targetLanguage,
          });
        }
      });

      socket.onError((error) => {
        const message = formatGeminiLiveError(error);
        console.error(`[gemini-live] error ${message}`);
        callbacks.onError?.({
          targetLanguage,
          message,
        });
      });

      socket.onClose((event) => {
        logGemini("closed", {
          targetLanguage,
          code: event.code,
          reason: event.reason,
        });
        if (event.code !== 1000) {
          callbacks.onError?.({
            targetLanguage,
            message: `Gemini Live closed: code=${event.code} reason=${event.reason}`,
          });
        }
      });

      socket.send(JSON.stringify(createSetupMessage(targetLanguage)));
      logGemini("setup_sent", { targetLanguage });
      await withTimeout(
        setupComplete,
        LIVE_CONNECT_TIMEOUT_MS,
        `gemini_live_setup_timeout_${LIVE_CONNECT_TIMEOUT_MS}ms`,
      );

      return {
        async sendAudio(audio: Uint8Array) {
          if (!socket.isOpen) {
            throw new Error("gemini_live_socket_not_open");
          }

          inputAudioFrameCount += 1;
          if (inputAudioFrameCount === 1 || inputAudioFrameCount % 50 === 0) {
            logGemini("send_audio", {
              targetLanguage,
              frameCount: inputAudioFrameCount,
              bytes: audio.byteLength,
            });
          }

          socket.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  data: Buffer.from(audio).toString("base64"),
                  mimeType: "audio/pcm;rate=16000",
                },
              },
            }),
          );
        },
        async close() {
          if (socket.isOpen) {
            socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
            await waitForGeminiLiveDrain(() => lastServerMessageAt, {
              minMs: LIVE_DRAIN_MIN_MS,
              idleMs: LIVE_DRAIN_IDLE_MS,
              maxMs: LIVE_DRAIN_MAX_MS,
            });
          }
          socket.close();
        },
      };
    },
  };
}

export async function waitForGeminiLiveDrain(
  getLastServerMessageAt: () => number,
  options: { minMs: number; idleMs: number; maxMs: number },
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.maxMs) {
    const elapsedMs = Date.now() - startedAt;
    const idleMs = Date.now() - getLastServerMessageAt();
    if (elapsedMs >= options.minMs && idleMs >= options.idleMs) {
      return;
    }
    await delay(Math.min(100, Math.max(10, options.idleMs - idleMs)));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGeminiLiveWebSocketUrl(apiKey: string): string {
  return `${removeTrailingSlash(LIVE_WEBSOCKET_BASE_URL)}?key=${encodeURIComponent(apiKey)}`;
}

export function createSetupMessage(targetLanguage: LanguageCode): Record<string, unknown> {
  return {
    setup: {
      model: `models/${LIVE_TRANSLATE_MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        translationConfig: {
          targetLanguageCode: targetLanguage,
          echoTargetLanguage: true,
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

export async function connectGeminiLiveWebSocket(
  url: string,
  timeoutMs: number,
  proxyUrl = getProxyUrl(),
): Promise<GeminiLiveSocket> {
  if (proxyUrl) {
    return await connectProxiedWebSocket(url, proxyUrl, timeoutMs);
  }

  const socket = new WebSocket(url);

  return await new Promise<GeminiLiveSocket>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      try {
        socket.close();
      } catch {
        // The socket may already be closed by the runtime.
      }
      reject(new Error(`gemini_live_connect_timeout_${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    }

    function onOpen() {
      cleanup();
      resolve(new NativeGeminiLiveSocket(socket));
    }

    function onError(error: Event) {
      cleanup();
      reject(new Error(formatGeminiLiveError(error)));
    }

    function onClose(event: CloseEvent) {
      cleanup();
      reject(
        new Error(
          `Gemini Live closed before open: code=${event.code} reason=${event.reason ?? ""}`,
        ),
      );
    }

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

class NativeGeminiLiveSocket implements GeminiLiveSocket {
  constructor(private readonly socket: WebSocket) {}

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  onMessage(listener: (data: string) => void): void {
    this.socket.addEventListener("message", async (event) => {
      if (typeof event.data === "string") {
        listener(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        listener(Buffer.from(event.data).toString("utf8"));
        return;
      }
      if (event.data instanceof Uint8Array) {
        listener(Buffer.from(event.data).toString("utf8"));
        return;
      }
      if (event.data instanceof Blob) {
        listener(await event.data.text());
      }
    });
  }

  onError(listener: (error: unknown) => void): void {
    this.socket.addEventListener("error", listener);
  }

  onClose(listener: (event: { code: number; reason: string }) => void): void {
    this.socket.addEventListener("close", (event) => {
      listener({ code: event.code, reason: event.reason ?? "" });
    });
  }
}

class ProxiedGeminiLiveSocket implements GeminiLiveSocket {
  private messageListeners: Array<(data: string) => void> = [];
  private errorListeners: Array<(error: unknown) => void> = [];
  private closeListeners: Array<(event: { code: number; reason: string }) => void> = [];
  private buffer = Buffer.alloc(0);
  private fragmentedMessage: { opcode: number; chunks: Buffer[] } | null = null;
  private open = true;

  constructor(private readonly socket: TLSSocket) {
    socket.on("data", (data) => this.handleData(Buffer.from(data)));
    socket.on("error", (error) => this.emitError(error));
    socket.on("close", () => {
      if (!this.open) return;
      this.open = false;
      this.emitClose({ code: 1006, reason: "socket_closed" });
    });
  }

  get isOpen(): boolean {
    return this.open && !this.socket.destroyed;
  }

  send(data: string): void {
    if (!this.isOpen) throw new Error("gemini_live_socket_not_open");
    this.socket.write(encodeWebSocketFrame(Buffer.from(data), 0x1));
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    try {
      this.socket.write(encodeWebSocketFrame(Buffer.alloc(0), 0x8));
    } finally {
      this.socket.end();
    }
  }

  onMessage(listener: (data: string) => void): void {
    this.messageListeners.push(listener);
  }

  onError(listener: (error: unknown) => void): void {
    this.errorListeners.push(listener);
  }

  onClose(listener: (event: { code: number; reason: string }) => void): void {
    this.closeListeners.push(listener);
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (true) {
      const frame = decodeWebSocketFrame(this.buffer);
      if (!frame) return;

      this.buffer = this.buffer.subarray(frame.bytesRead);
      if (frame.opcode === 0x0) {
        if (!this.fragmentedMessage) continue;
        this.fragmentedMessage.chunks.push(frame.payload);
        if (frame.final) {
          this.emitMessageFromFrame(
            this.fragmentedMessage.opcode,
            Buffer.concat(this.fragmentedMessage.chunks),
          );
          this.fragmentedMessage = null;
        }
        continue;
      }

      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        if (!frame.final) {
          this.fragmentedMessage = { opcode: frame.opcode, chunks: [frame.payload] };
          continue;
        }
        this.emitMessageFromFrame(frame.opcode, frame.payload);
        continue;
      }

      if (frame.opcode === 0x8) {
        this.open = false;
        const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1000;
        const reason = frame.payload.length > 2 ? frame.payload.subarray(2).toString("utf8") : "";
        this.emitClose({ code, reason });
        this.socket.end();
        return;
      }

      if (frame.opcode === 0x9) {
        this.socket.write(encodeWebSocketFrame(frame.payload, 0xa));
      }
    }
  }

  private emitError(error: unknown): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private emitMessageFromFrame(opcode: number, payload: Buffer): void {
    if (opcode === 0x1) {
      const text = payload.toString("utf8");
      for (const listener of this.messageListeners) listener(text);
      return;
    }

    const text = payload.toString("utf8");
    for (const listener of this.messageListeners) listener(text);
  }

  private emitClose(event: { code: number; reason: string }): void {
    for (const listener of this.closeListeners) listener(event);
  }
}

async function connectProxiedWebSocket(
  websocketUrl: string,
  proxyUrl: string,
  timeoutMs: number,
): Promise<GeminiLiveSocket> {
  return await withTimeout(
    connectProxiedWebSocketWithoutTimeout(websocketUrl, proxyUrl),
    timeoutMs,
    `gemini_live_connect_timeout_${timeoutMs}ms`,
  );
}

async function connectProxiedWebSocketWithoutTimeout(
  websocketUrl: string,
  proxyUrl: string,
): Promise<GeminiLiveSocket> {
  const target = new URL(websocketUrl);
  const proxy = new URL(proxyUrl);
  if (target.protocol !== "wss:") {
    throw new Error(`unsupported_gemini_live_protocol_${target.protocol}`);
  }
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new Error(`unsupported_gemini_live_proxy_protocol_${proxy.protocol}`);
  }

  const proxySocket = await connectTcpSocket(proxy.hostname, Number(proxy.port || 80));
  const targetPort = Number(target.port || 443);
  const connectRequest = [
    `CONNECT ${target.hostname}:${targetPort} HTTP/1.1`,
    `Host: ${target.hostname}:${targetPort}`,
    "Proxy-Connection: Keep-Alive",
    "",
    "",
  ].join("\r\n");

  proxySocket.write(connectRequest);
  await readHttpHeaders(proxySocket, "proxy CONNECT");

  const tlsSocket = await connectTlsSocket(proxySocket, target.hostname);
  const key = randomBytes(16).toString("base64");
  const path = `${target.pathname}${target.search}`;
  const handshakeRequest = [
    `GET ${path} HTTP/1.1`,
    `Host: ${target.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");

  tlsSocket.write(handshakeRequest);
  const headers = await readHttpHeaders(tlsSocket, "websocket upgrade");
  const accept = headers.find((line) => line.toLowerCase().startsWith("sec-websocket-accept:"));
  const expectedAccept = createWebSocketAccept(key);
  if (!accept?.toLowerCase().includes(expectedAccept.toLowerCase())) {
    throw new Error("gemini_live_invalid_websocket_accept");
  }

  return new ProxiedGeminiLiveSocket(tlsSocket);
}

function connectTcpSocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectTcp({ host, port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

function connectTlsSocket(socket: Socket, servername: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = connectTls({ socket, servername }, () => resolve(tlsSocket));
    tlsSocket.once("error", reject);
  });
}

function readHttpHeaders(
  socket: Socket | TLSSocket,
  label: string,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    function onData(data: Buffer) {
      buffer = Buffer.concat([buffer, data]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      cleanup();
      const text = buffer.subarray(0, headerEnd).toString("utf8");
      const lines = text.split("\r\n");
      const statusLine = lines[0] ?? "";
      if (!/^HTTP\/1\.[01] (101|200)\b/.test(statusLine)) {
        reject(new Error(`gemini_live_${label.replace(/\s+/g, "_")}_failed_${statusLine}`));
        return;
      }
      resolve(lines);
    }

    function onError(error: Error) {
      cleanup();
      reject(error);
    }

    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
    }

    socket.on("data", onData);
    socket.once("error", onError);
  });
}

function encodeWebSocketFrame(payload: Buffer, opcode: number): Buffer {
  const mask = randomBytes(4);
  const length = payload.length;
  const headerLength = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + length);
  frame[0] = 0x80 | opcode;

  if (length < 126) {
    frame[1] = 0x80 | length;
    mask.copy(frame, 2);
    writeMaskedPayload(payload, mask, frame, 6);
    return frame;
  }

  if (length <= 0xffff) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
    mask.copy(frame, 4);
    writeMaskedPayload(payload, mask, frame, 8);
    return frame;
  }

  frame[1] = 0x80 | 127;
  frame.writeBigUInt64BE(BigInt(length), 2);
  mask.copy(frame, 10);
  writeMaskedPayload(payload, mask, frame, 14);
  return frame;
}

function writeMaskedPayload(payload: Buffer, mask: Buffer, frame: Buffer, offset: number): void {
  for (let index = 0; index < payload.length; index += 1) {
    frame[offset + index] = payload[index] ^ mask[index % 4];
  }
}

function decodeWebSocketFrame(buffer: Buffer):
  | {
      final: boolean;
      opcode: number;
      payload: Buffer;
      bytesRead: number;
    }
  | null {
  if (buffer.length < 2) return null;

  const final = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const longLength = buffer.readBigUInt64BE(2);
    if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("gemini_live_websocket_frame_too_large");
    }
    length = Number(longLength);
    offset = 10;
  }

  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    final,
    opcode,
    payload,
    bytesRead: offset + length,
  };
}

function createWebSocketAccept(key: string): string {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseGeminiLiveMessage(data: unknown): GeminiLiveMessage | null {
  if (typeof data !== "string") return null;

  try {
    return JSON.parse(data) as GeminiLiveMessage;
  } catch {
    return null;
  }
}

function logGeminiServerMessage(
  message: Record<string, unknown>,
  targetLanguage: LanguageCode,
  serverMessageCount: number,
): void {
  const content = message.serverContent as
    | {
        inputTranscription?: unknown;
        outputTranscription?: unknown;
        modelTurn?: { parts?: unknown[] };
      }
    | undefined;

  if (serverMessageCount <= 10 || serverMessageCount % 50 === 0) {
    logGemini("server_message", {
      targetLanguage,
      messageCount: serverMessageCount,
      keys: Object.keys(message).join(","),
      serverContentKeys:
        content && typeof content === "object" ? Object.keys(content).join(",") : "",
      text: summarizeGeminiMessage(message),
    });
  }

  if (content?.inputTranscription || content?.outputTranscription || content?.modelTurn) {
    return;
  }

}

function summarizeGeminiMessage(message: Record<string, unknown>): string {
  try {
    return redactSensitiveUrlParts(JSON.stringify(message)).slice(0, 600);
  } catch {
    return "[unserializable]";
  }
}

function logGemini(event: string, fields: Record<string, unknown>): void {
  console.info(`[gemini-live] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${redactSensitiveUrlParts(String(value))}`)
    .join(" ");
}

export function formatGeminiLiveError(error: unknown): string {
  if (error instanceof Error) {
    return redactSensitiveUrlParts(error.message);
  }

  if (!error || typeof error !== "object") {
    return `Gemini Live Translate error: ${redactSensitiveUrlParts(String(error))}`;
  }

  const record = error as Record<string, unknown>;
  const parts = [
    formatField("type", record.type),
    formatField("code", record.code),
    formatField("reason", record.reason),
    formatField("message", record.message),
  ].filter(Boolean);

  const enumerable = Object.entries(record)
    .filter(([key]) => !["type", "code", "reason", "message"].includes(key))
    .map(([key, value]) => formatField(key, value))
    .filter(Boolean);

  const detail = [...parts, ...enumerable].join("; ");
  return detail ? `Gemini Live Translate error: ${detail}` : "Gemini Live Translate error.";
}

function formatField(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${key}=${redactSensitiveUrlParts(String(value))}`;
  }

  try {
    return `${key}=${redactSensitiveUrlParts(JSON.stringify(value))}`;
  } catch {
    return `${key}=${redactSensitiveUrlParts(String(value))}`;
  }
}

function redactSensitiveUrlParts(value: string): string {
  return value.replace(/([?&]key=)[^&\s"']+/g, "$1[REDACTED]");
}

function removeTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getProxyUrl(): string | undefined {
  const value =
    process.env.GEMINI_LIVE_PROXY_URL ??
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy;
  if (!value) return undefined;

  if (value.startsWith("socks5://")) {
    return `http://${value.slice("socks5://".length)}`;
  }
  return value;
}

function sanitizeProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "[REDACTED]";
      url.password = "[REDACTED]";
    }
    return url.toString();
  } catch {
    return redactSensitiveUrlParts(value);
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
