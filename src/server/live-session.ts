import { type LanguageCode } from "../shared/languages";
import { type createMeetingStore } from "./meeting-store";

export type LiveTranslateCallbacks = {
  onTranscript?: (event: {
    meetingId?: string;
    speakerId?: string;
    speakerName?: string;
    sourceText?: string;
    translatedText?: string;
    targetLanguage: LanguageCode;
  }) => void;
  onAudio?: (event: {
    meetingId?: string;
    speakerId?: string;
    audio: Uint8Array;
    targetLanguage: LanguageCode;
  }) => void;
  onError?: (event: {
    meetingId?: string;
    speakerId?: string;
    targetLanguage: LanguageCode;
    message: string;
  }) => void;
  onStatus?: (event: {
    meetingId?: string;
    speakerId?: string;
    targetLanguage: LanguageCode;
    code: "live_session_starting" | "live_session_ready" | "live_session_error";
    message: string;
  }) => void;
};

export type LiveTranslateSession = {
  sendAudio(audio: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

export type LiveTranslateFactory = {
  create(input: {
    targetLanguage: LanguageCode;
    callbacks: LiveTranslateCallbacks;
  }): Promise<LiveTranslateSession>;
};

type MeetingLiveCoordinatorDependencies = {
  store: ReturnType<typeof createMeetingStore>;
  factory: LiveTranslateFactory;
  callbacks?: LiveTranslateCallbacks;
  now?: () => number;
  sessionMaxAgeMs?: number;
  rotationIdleMs?: number;
};

const defaultSessionMaxAgeMs = 90_000;
const defaultRotationIdleMs = 1_200;

type SessionInfo = {
  createdAt: number;
  lastAudioAt?: number;
};

export function createMeetingLiveCoordinator({
  store,
  factory,
  callbacks = {},
  now = Date.now,
  sessionMaxAgeMs = defaultSessionMaxAgeMs,
  rotationIdleMs = defaultRotationIdleMs,
}: MeetingLiveCoordinatorDependencies) {
  const sessions = new Map<string, Promise<LiveTranslateSession>>();
  const sessionInfos = new Map<string, SessionInfo>();
  const failedSessions = new Set<string>();
  const audioFrameCounts = new Map<string, number>();

  function sessionKey(meetingId: string, speakerId: string, targetLanguage: LanguageCode): string {
    return `${meetingId}:${speakerId}:${targetLanguage}`;
  }

  async function getSession(
    meetingId: string,
    speakerId: string,
    targetLanguage: LanguageCode,
  ): Promise<LiveTranslateSession> {
    const key = sessionKey(meetingId, speakerId, targetLanguage);
    if (failedSessions.has(key)) {
      throw new Error(`live_session_unavailable_${targetLanguage}`);
    }

    const existing = sessions.get(key);
    if (existing) {
      return await existing;
    }

    const speakerName =
      store
        .getMeeting(meetingId)
        .participants.find((participant) => participant.id === speakerId)?.displayName ??
      "Speaker";

    logLive("session_starting", { meetingId, speakerId, speakerName, targetLanguage });
    callbacks.onStatus?.({
      meetingId,
      speakerId,
      targetLanguage,
      code: "live_session_starting",
      message: `Starting Live Translate session for ${targetLanguage}.`,
    });

    const sessionPromise = factory
      .create({
        targetLanguage,
        callbacks: {
          onTranscript: (event) =>
            callbacks.onTranscript?.({
              ...event,
              meetingId,
              speakerId,
              speakerName,
            }),
          onAudio: (event) =>
            callbacks.onAudio?.({
              ...event,
              meetingId,
              speakerId,
            }),
          onError: (event) =>
            callbacks.onError?.({
              ...event,
              meetingId,
              speakerId,
            }),
        },
      })
      .then((session) => {
        logLive("session_ready", { meetingId, speakerId, targetLanguage });
        callbacks.onStatus?.({
          meetingId,
          speakerId,
          targetLanguage,
          code: "live_session_ready",
          message: `Live Translate session is ready for ${targetLanguage}.`,
        });
        return session;
      })
      .catch((error) => {
        sessions.delete(key);
        failedSessions.add(key);
        logLive("session_error", {
          meetingId,
          speakerId,
          targetLanguage,
          error: error instanceof Error ? error.message : String(error),
        });
        callbacks.onStatus?.({
          meetingId,
          speakerId,
          targetLanguage,
          code: "live_session_error",
          message: error instanceof Error ? error.message : "Live Translate session failed.",
        });
        throw error;
      });

    sessions.set(key, sessionPromise);
    sessionInfos.set(key, { createdAt: now() });
    return await sessionPromise;
  }

  function closeUnusedTargetSessions(
    meetingId: string,
    speakerId: string,
    activeTargetLanguages: Set<LanguageCode>,
  ): Promise<void> | undefined {
    const prefix = `${meetingId}:${speakerId}:`;
    const closeTasks: Promise<void>[] = [];

    for (const [key, session] of sessions) {
      if (!key.startsWith(prefix)) continue;

      const targetLanguage = key.slice(prefix.length) as LanguageCode;
      if (activeTargetLanguages.has(targetLanguage)) continue;

      sessions.delete(key);
      sessionInfos.delete(key);
      failedSessions.delete(key);
      logLive("session_pruned", { meetingId, speakerId, targetLanguage });
      closeTasks.push(session.then((resolved) => resolved.close()));
    }

    for (const key of failedSessions) {
      if (!key.startsWith(prefix)) continue;

      const targetLanguage = key.slice(prefix.length) as LanguageCode;
      if (!activeTargetLanguages.has(targetLanguage)) {
        failedSessions.delete(key);
      }
    }

    if (closeTasks.length === 0) return undefined;

    return Promise.all(closeTasks).then(() => undefined);
  }

  function closeExpiredIdleSessions(
    meetingId: string,
    speakerId: string,
    activeTargetLanguages: Set<LanguageCode>,
  ): Promise<void> | undefined {
    const prefix = `${meetingId}:${speakerId}:`;
    const timestamp = now();
    const closeTasks: Promise<void>[] = [];

    for (const [key, session] of sessions) {
      if (!key.startsWith(prefix)) continue;

      const targetLanguage = key.slice(prefix.length) as LanguageCode;
      if (!activeTargetLanguages.has(targetLanguage)) continue;

      const info = sessionInfos.get(key);
      if (!info || info.lastAudioAt === undefined) continue;
      if (timestamp - info.createdAt < sessionMaxAgeMs) continue;
      if (timestamp - info.lastAudioAt < rotationIdleMs) continue;

      sessions.delete(key);
      sessionInfos.delete(key);
      failedSessions.delete(key);
      logLive("session_rotating", {
        meetingId,
        speakerId,
        targetLanguage,
        ageMs: timestamp - info.createdAt,
        idleMs: timestamp - info.lastAudioAt,
      });
      closeTasks.push(session.then((resolved) => resolved.close()));
    }

    if (closeTasks.length === 0) return undefined;

    return Promise.all(closeTasks).then(() => undefined);
  }

  return {
    async handleSpeakerAudio(
      meetingId: string,
      participantId: string,
      audio: Uint8Array,
    ): Promise<void> {
      const meeting = store.getMeeting(meetingId);
      if (meeting.activeSpeakerId !== participantId) {
        logLive("audio_ignored_inactive_speaker", { meetingId, participantId });
        return;
      }

      const speaker = meeting.participants.find((participant) => participant.id === participantId);
      if (!speaker) {
        logLive("audio_ignored_missing_speaker", { meetingId, participantId });
        return;
      }

      const targetLanguages = new Set(
        meeting.participants.map((participant) => participant.language),
      );
      const closeUnusedTargets = closeUnusedTargetSessions(meetingId, participantId, targetLanguages);
      if (closeUnusedTargets) {
        await closeUnusedTargets;
      }
      const closeExpiredIdleTargets = closeExpiredIdleSessions(
        meetingId,
        participantId,
        targetLanguages,
      );
      if (closeExpiredIdleTargets) {
        await closeExpiredIdleTargets;
      }

      const targets = [...targetLanguages];
      const audioTimestamp = now();
      const frameKey = `${meetingId}:${participantId}`;
      const frameCount = (audioFrameCounts.get(frameKey) ?? 0) + 1;
      audioFrameCounts.set(frameKey, frameCount);
      if (frameCount === 1 || frameCount % 500 === 0) {
        logLive("audio_frame", {
          meetingId,
          participantId,
          bytes: audio.byteLength,
          frameCount,
          targetLanguages: targets.join(","),
        });
      }

      await Promise.all(
        targets.map(async (targetLanguage) => {
          const key = sessionKey(meetingId, participantId, targetLanguage);
          if (failedSessions.has(key)) return;

          const session = await getSession(meetingId, participantId, targetLanguage);
          await session.sendAudio(audio);
          sessionInfos.set(key, {
            createdAt: sessionInfos.get(key)?.createdAt ?? audioTimestamp,
            lastAudioAt: audioTimestamp,
          });
        }),
      );
    },

    async stopSpeaker(meetingId: string, participantId: string): Promise<void> {
      const prefix = `${meetingId}:${participantId}:`;
      const closeTasks: Promise<void>[] = [];
      audioFrameCounts.delete(`${meetingId}:${participantId}`);

      for (const [key, session] of sessions) {
        if (key.startsWith(prefix)) {
          sessions.delete(key);
          sessionInfos.delete(key);
          failedSessions.delete(key);
          logLive("session_closing", { meetingId, participantId, sessionKey: key });
          closeTasks.push(session.then((resolved) => resolved.close()));
        }
      }

      for (const key of failedSessions) {
        if (key.startsWith(prefix)) {
          failedSessions.delete(key);
        }
      }

      store.releaseSpeaker(meetingId, participantId);
      await Promise.all(closeTasks);
    },
  };
}

function logLive(event: string, fields: Record<string, unknown>): void {
  console.info(`[live] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
