import { describe, expect, test } from "bun:test";
import { createMeetingLiveCoordinator, type LiveTranslateFactory } from "../src/server/live-session";
import { createMeetingStore } from "../src/server/meeting-store";

describe("meeting live coordinator", () => {
  test("routes speaker audio to one live session per listener target language", async () => {
    const createdTargets: string[] = [];
    const sentAudioSizes: number[] = [];
    const factory: LiveTranslateFactory = {
      create: async ({ targetLanguage }) => {
        createdTargets.push(targetLanguage);
        return {
          sendAudio: async (audio) => {
            sentAudioSizes.push(audio.byteLength);
          },
          close: async () => undefined,
        };
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    store.joinMeeting(meeting.id, { displayName: "English", language: "en" });
    store.joinMeeting(meeting.id, { displayName: "Russian", language: "ru" });
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({ store, factory });
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1, 2, 3]));

    expect(createdTargets.sort()).toEqual(["en", "ru", "zh-Hans"]);
    expect(sentAudioSizes).toEqual([3, 3, 3]);
  });

  test("does not send audio when participant is not the active speaker", async () => {
    let sent = 0;
    const factory: LiveTranslateFactory = {
      create: async () => ({
        sendAudio: async () => {
          sent += 1;
        },
        close: async () => undefined,
      }),
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    const listener = store.joinMeeting(meeting.id, {
      displayName: "Listener",
      language: "en",
    });
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({ store, factory });
    await coordinator.handleSpeakerAudio(meeting.id, listener.id, new Uint8Array([1]));

    expect(sent).toBe(0);
  });

  test("routes audio to listeners even when their target language matches the speaker setting", async () => {
    const createdTargets: string[] = [];
    const factory: LiveTranslateFactory = {
      create: async ({ targetLanguage }) => {
        createdTargets.push(targetLanguage);
        return {
          sendAudio: async () => undefined,
          close: async () => undefined,
        };
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "en",
    });
    const host = meeting.participants[0];
    store.joinMeeting(meeting.id, { displayName: "Listener", language: "en" });
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({ store, factory });
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));

    expect(createdTargets).toEqual(["en"]);
  });

  test("routes audio to the speaker language when the speaker is alone", async () => {
    const createdTargets: string[] = [];
    const sentAudioSizes: number[] = [];
    const factory: LiveTranslateFactory = {
      create: async ({ targetLanguage }) => {
        createdTargets.push(targetLanguage);
        return {
          sendAudio: async (audio) => {
            sentAudioSizes.push(audio.byteLength);
          },
          close: async () => undefined,
        };
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({ store, factory });
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1, 2, 3]));

    expect(createdTargets).toEqual(["zh-Hans"]);
    expect(sentAudioSizes).toEqual([3]);
  });

  test("reuses an in-flight live session while audio chunks arrive quickly", async () => {
    let createCount = 0;
    const createGate: { release?: () => void } = {};
    const statusCodes: string[] = [];
    const sentAudioSizes: number[] = [];
    const factory: LiveTranslateFactory = {
      create: async () => {
        createCount += 1;
        await new Promise<void>((resolve) => {
          createGate.release = resolve;
        });
        return {
          sendAudio: async (audio) => {
            sentAudioSizes.push(audio.byteLength);
          },
          close: async () => undefined,
        };
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "en",
    });
    const host = meeting.participants[0];
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({
      store,
      factory,
      callbacks: {
        onStatus(event) {
          statusCodes.push(event.code);
        },
      },
    });

    const first = coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));
    const second = coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([2, 3]));
    await Promise.resolve();

    expect(createCount).toBe(1);
    expect(statusCodes).toEqual(["live_session_starting"]);

    createGate.release?.();
    await Promise.all([first, second]);

    expect(createCount).toBe(1);
    expect(statusCodes).toEqual(["live_session_starting", "live_session_ready"]);
    expect(sentAudioSizes).toEqual([1, 2]);
  });

  test("closes target sessions when the speaker stops", async () => {
    let closed = 0;
    const factory: LiveTranslateFactory = {
      create: async () => ({
        sendAudio: async () => undefined,
        close: async () => {
          closed += 1;
        },
      }),
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    store.joinMeeting(meeting.id, { displayName: "English", language: "en" });
    store.joinMeeting(meeting.id, { displayName: "Russian", language: "ru" });
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({ store, factory });
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));
    await coordinator.stopSpeaker(meeting.id, host.id);

    expect(closed).toBe(3);
    expect(store.getMeeting(meeting.id).activeSpeakerId).toBeNull();
  });

  test("closes unused target sessions when listener languages change", async () => {
    const createdTargets: string[] = [];
    const closedTargets: string[] = [];
    const sentTargets: string[] = [];
    const factory: LiveTranslateFactory = {
      create: async ({ targetLanguage }) => {
        createdTargets.push(targetLanguage);
        return {
          sendAudio: async () => {
            sentTargets.push(targetLanguage);
          },
          close: async () => {
            closedTargets.push(targetLanguage);
          },
        };
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    const listener = store.joinMeeting(meeting.id, {
      displayName: "Listener",
      language: "en",
    });
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({ store, factory });
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));

    store.updateParticipantLanguage(meeting.id, listener.id, "ja");
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([2]));

    expect(createdTargets).toEqual(["zh-Hans", "en", "ja"]);
    expect(closedTargets).toEqual(["en"]);
    expect(sentTargets).toEqual(["zh-Hans", "en", "zh-Hans", "ja"]);
  });

  test("does not rotate an expired session while audio is continuous", async () => {
    let currentTime = 0;
    let createCount = 0;
    let closeCount = 0;
    const factory: LiveTranslateFactory = {
      create: async () => {
        createCount += 1;
        return {
          sendAudio: async () => undefined,
          close: async () => {
            closeCount += 1;
          },
        };
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "en",
    });
    const host = meeting.participants[0];
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({
      store,
      factory,
      now: () => currentTime,
      sessionMaxAgeMs: 1_000,
      rotationIdleMs: 500,
    });

    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));
    currentTime = 800;
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([2]));
    currentTime = 1_100;
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([3]));

    expect(createCount).toBe(1);
    expect(closeCount).toBe(0);
  });

  test("rotates an expired session only after an idle gap", async () => {
    let currentTime = 0;
    let createCount = 0;
    let closeCount = 0;
    const sentSessionIds: number[] = [];
    const factory: LiveTranslateFactory = {
      create: async () => {
        createCount += 1;
        const sessionId = createCount;
        return {
          sendAudio: async () => {
            sentSessionIds.push(sessionId);
          },
          close: async () => {
            closeCount += 1;
          },
        };
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "en",
    });
    const host = meeting.participants[0];
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({
      store,
      factory,
      now: () => currentTime,
      sessionMaxAgeMs: 1_000,
      rotationIdleMs: 500,
    });

    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));
    currentTime = 1_600;
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([2]));

    expect(createCount).toBe(2);
    expect(closeCount).toBe(1);
    expect(sentSessionIds).toEqual([1, 2]);
  });

  test("does not retry a failed live session until the speaker stops", async () => {
    let createCount = 0;
    const statusCodes: string[] = [];
    const factory: LiveTranslateFactory = {
      create: async () => {
        createCount += 1;
        throw new Error("connect_timeout");
      },
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "en",
    });
    const host = meeting.participants[0];
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({
      store,
      factory,
      callbacks: {
        onStatus(event) {
          statusCodes.push(event.code);
        },
      },
    });

    await expect(
      coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1])),
    ).rejects.toThrow("connect_timeout");
    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([2]));

    expect(createCount).toBe(1);
    expect(statusCodes).toEqual(["live_session_starting", "live_session_error"]);

    await coordinator.stopSpeaker(meeting.id, host.id);
    store.acquireSpeaker(meeting.id, host.id);
    await expect(
      coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([3])),
    ).rejects.toThrow("connect_timeout");

    expect(createCount).toBe(2);
  });

  test("adds speaker identity to transcript callbacks", async () => {
    const transcriptEvents: Array<{
      speakerId?: string;
      speakerName?: string;
      translatedText?: string;
    }> = [];
    const factory: LiveTranslateFactory = {
      create: async ({ callbacks }) => ({
        sendAudio: async () => {
          callbacks.onTranscript?.({
            translatedText: "Hello everyone",
            targetLanguage: "en",
          });
        },
        close: async () => undefined,
      }),
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "主持人",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    store.joinMeeting(meeting.id, { displayName: "Listener", language: "en" });
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({
      store,
      factory,
      callbacks: {
        onTranscript(event) {
          transcriptEvents.push(event);
        },
      },
    });

    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));

    expect(transcriptEvents).toHaveLength(2);
    expect(transcriptEvents[0]).toMatchObject({
      speakerId: host.id,
      speakerName: "主持人",
      translatedText: "Hello everyone",
    });
  });

  test("forwards upstream live errors with speaker identity", async () => {
    const errors: Array<{
      meetingId?: string;
      speakerId?: string;
      targetLanguage: string;
      message: string;
    }> = [];
    const factory: LiveTranslateFactory = {
      create: async ({ callbacks, targetLanguage }) => ({
        sendAudio: async () => {
          callbacks.onError?.({
            targetLanguage,
            message: "upstream failed",
          });
        },
        close: async () => undefined,
      }),
    };

    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "主持人",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    store.joinMeeting(meeting.id, { displayName: "Listener", language: "en" });
    store.acquireSpeaker(meeting.id, host.id);

    const coordinator = createMeetingLiveCoordinator({
      store,
      factory,
      callbacks: {
        onError(event) {
          errors.push(event);
        },
      },
    });

    await coordinator.handleSpeakerAudio(meeting.id, host.id, new Uint8Array([1]));

    expect(errors.sort((left, right) => left.targetLanguage.localeCompare(right.targetLanguage))).toEqual([
      {
        meetingId: meeting.id,
        speakerId: host.id,
        targetLanguage: "en",
        message: "upstream failed",
      },
      {
        meetingId: meeting.id,
        speakerId: host.id,
        targetLanguage: "zh-Hans",
        message: "upstream failed",
      },
    ]);
  });
});
