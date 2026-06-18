import { describe, expect, test } from "bun:test";
import { createMeetingStore } from "../src/server/meeting-store";

describe("meeting store", () => {
  test("creates a meeting with a host participant", () => {
    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });

    expect(meeting.id).toHaveLength(8);
    expect(meeting.participants).toHaveLength(1);
    expect(meeting.participants[0]).toMatchObject({
      displayName: "Host",
      language: "zh-Hans",
      role: "host",
    });
  });

  test("can create an empty room before a participant joins", () => {
    const store = createMeetingStore();
    const meeting = store.createMeeting({
      meetingId: "room-before-join",
      hostName: "Host",
      hostLanguage: "zh-Hans",
      empty: true,
    });

    expect(meeting.participants).toHaveLength(0);
    expect(store.getMeeting("room-before-join").participants).toHaveLength(0);
  });

  test("joins participants and updates their language", () => {
    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const participant = store.joinMeeting(meeting.id, {
      displayName: "Listener",
      language: "ru",
    });

    expect(participant.role).toBe("listener");
    expect(store.updateParticipantLanguage(meeting.id, participant.id, "en").language).toBe(
      "en",
    );
  });

  test("allows only one active speaker at a time", () => {
    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];
    const listener = store.joinMeeting(meeting.id, {
      displayName: "Listener",
      language: "ru",
    });

    expect(store.acquireSpeaker(meeting.id, host.id)).toEqual({
      ok: true,
      speakerId: host.id,
    });
    expect(store.acquireSpeaker(meeting.id, listener.id)).toEqual({
      ok: false,
      speakerId: host.id,
      reason: "speaker_busy",
    });

    store.releaseSpeaker(meeting.id, host.id);
    expect(store.acquireSpeaker(meeting.id, listener.id)).toEqual({
      ok: true,
      speakerId: listener.id,
    });
  });

  test("tracks meeting mode and blocks speaking during playback", () => {
    const store = createMeetingStore();
    const meeting = store.createMeeting({
      hostName: "Host",
      hostLanguage: "zh-Hans",
    });
    const host = meeting.participants[0];

    expect(store.getMeeting(meeting.id).mode).toBe("simultaneous");
    expect(store.setMode(meeting.id, "face_to_face").mode).toBe("face_to_face");
    expect(store.setPlaybackActive(meeting.id, true).playbackActive).toBe(true);
    expect(store.acquireSpeaker(meeting.id, host.id)).toEqual({
      ok: false,
      speakerId: host.id,
      reason: "speaker_busy",
    });
  });

  test("deletes an empty meeting after the last participant leaves", () => {
    const store = createMeetingStore();
    const meeting = store.createMeeting({
      meetingId: "cleanup-room",
      hostName: "Host",
      hostLanguage: "zh-Hans",
      empty: true,
    });
    const participant = store.joinMeeting(meeting.id, {
      displayName: "Guest",
      language: "en",
    });

    expect(store.removeParticipant(meeting.id, participant.id)).toBeNull();
    expect(() => store.getMeeting(meeting.id)).toThrow("meeting_not_found");
  });
});
