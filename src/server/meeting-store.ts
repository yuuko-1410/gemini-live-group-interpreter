import { type LanguageCode } from "../shared/languages";
import { type MeetingMode } from "../shared/ws-protocol";

export type ParticipantRole = "host" | "listener";

export type Participant = {
  id: string;
  displayName: string;
  language: LanguageCode;
  role: ParticipantRole;
  connectedAt: string;
};

export type Meeting = {
  id: string;
  createdAt: string;
  status: "active";
  hostId: string | null;
  activeSpeakerId: string | null;
  mode: MeetingMode;
  playbackActive: boolean;
  participants: Participant[];
};

type CreateMeetingInput = {
  meetingId?: string;
  hostName: string;
  hostLanguage: LanguageCode;
  empty?: boolean;
};

type JoinMeetingInput = {
  displayName: string;
  language: LanguageCode;
};

export type AcquireSpeakerResult =
  | {
      ok: true;
      speakerId: string;
    }
  | {
      ok: false;
      speakerId: string;
      reason: "speaker_busy";
    };

export function createMeetingStore() {
  const meetings = new Map<string, Meeting>();

  function requireMeeting(meetingId: string): Meeting {
    const meeting = meetings.get(meetingId);
    if (!meeting) {
      throw new Error("meeting_not_found");
    }
    return meeting;
  }

  function requireParticipant(meeting: Meeting, participantId: string): Participant {
    const participant = meeting.participants.find((item) => item.id === participantId);
    if (!participant) {
      throw new Error("participant_not_found");
    }
    return participant;
  }

  return {
    createMeeting(input: CreateMeetingInput): Meeting {
      if (input.meetingId) {
        const existing = meetings.get(input.meetingId);
        if (existing) {
          return structuredClone(existing);
        }
      }

      const host = input.empty
        ? null
        : {
            id: createId(10),
            displayName: input.hostName.trim() || "Host",
            language: input.hostLanguage,
            role: "host" as const,
            connectedAt: new Date().toISOString(),
          };

      const meeting: Meeting = {
        id: input.meetingId ?? createId(8),
        createdAt: new Date().toISOString(),
        status: "active",
        hostId: host?.id ?? null,
        activeSpeakerId: null,
        mode: "simultaneous",
        playbackActive: false,
        participants: host ? [host] : [],
      };

      meetings.set(meeting.id, meeting);
      return structuredClone(meeting);
    },

    getMeeting(meetingId: string): Meeting {
      return structuredClone(requireMeeting(meetingId));
    },

    joinMeeting(meetingId: string, input: JoinMeetingInput): Participant {
      const meeting = requireMeeting(meetingId);
      const participant: Participant = {
        id: createId(10),
        displayName: input.displayName.trim() || "Guest",
        language: input.language,
        role: meeting.participants.length === 0 ? "host" : "listener",
        connectedAt: new Date().toISOString(),
      };
      if (!meeting.hostId) {
        meeting.hostId = participant.id;
      }
      meeting.participants.push(participant);
      return structuredClone(participant);
    },

    updateParticipantLanguage(
      meetingId: string,
      participantId: string,
      language: LanguageCode,
    ): Participant {
      const meeting = requireMeeting(meetingId);
      const participant = requireParticipant(meeting, participantId);
      participant.language = language;
      return structuredClone(participant);
    },

    setMode(meetingId: string, mode: MeetingMode): Meeting {
      const meeting = requireMeeting(meetingId);
      meeting.mode = mode;
      return structuredClone(meeting);
    },

    setPlaybackActive(meetingId: string, playbackActive: boolean): Meeting {
      const meeting = requireMeeting(meetingId);
      meeting.playbackActive = playbackActive;
      return structuredClone(meeting);
    },

    acquireSpeaker(meetingId: string, participantId: string): AcquireSpeakerResult {
      const meeting = requireMeeting(meetingId);
      requireParticipant(meeting, participantId);

      if (meeting.playbackActive) {
        return {
          ok: false,
          speakerId: meeting.activeSpeakerId ?? participantId,
          reason: "speaker_busy",
        };
      }

      if (meeting.activeSpeakerId && meeting.activeSpeakerId !== participantId) {
        return {
          ok: false,
          speakerId: meeting.activeSpeakerId,
          reason: "speaker_busy",
        };
      }

      meeting.activeSpeakerId = participantId;
      return {
        ok: true,
        speakerId: participantId,
      };
    },

    releaseSpeaker(meetingId: string, participantId: string): void {
      const meeting = requireMeeting(meetingId);
      if (meeting.activeSpeakerId === participantId) {
        meeting.activeSpeakerId = null;
      }
    },

    removeParticipant(meetingId: string, participantId: string): Meeting | null {
      const meeting = requireMeeting(meetingId);
      meeting.participants = meeting.participants.filter((item) => item.id !== participantId);
      if (meeting.activeSpeakerId === participantId) {
        meeting.activeSpeakerId = null;
      }
      if (meeting.hostId === participantId) {
        meeting.hostId = meeting.participants[0]?.id ?? null;
      }
      if (meeting.participants.length === 0) {
        meetings.delete(meetingId);
        return null;
      }
      return structuredClone(meeting);
    },
  };
}

function createId(length: number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let index = 0; index < length; index += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}
