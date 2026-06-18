import { isSupportedLanguage, type LanguageCode } from "./languages";

export type MeetingMode = "simultaneous" | "face_to_face";

export type ClientMessage =
  | {
      type: "join";
      displayName: string;
      language: LanguageCode;
    }
  | {
      type: "set_language";
      language: LanguageCode;
    }
  | {
      type: "set_mode";
      mode: MeetingMode;
    }
  | {
      type: "start_speaking";
    }
  | {
      type: "stop_speaking";
    }
  | {
      type: "chat_message";
      text: string;
    }
  | {
      type: "ping";
    };

export type ServerMessage =
  | {
      type: "joined";
      meetingId?: string;
      participantId: string;
    }
  | {
      type: "meeting_state";
      meeting: unknown;
    }
  | {
      type: "speaker_changed";
      speakerId: string | null;
    }
  | {
      type: "mode_changed";
      mode: MeetingMode;
    }
  | {
      type: "playback_started";
      speakerId?: string;
      timestamp: string;
    }
  | {
      type: "playback_finished";
      timestamp: string;
    }
  | {
      type: "audio_activity";
      speakerId: string;
      timestamp: string;
    }
  | {
      type: "live_status";
      code: "live_session_starting" | "live_session_ready" | "live_session_error";
      message: string;
      speakerId?: string;
      targetLanguage?: LanguageCode;
      timestamp: string;
    }
  | {
      type: "transcript";
      id?: string;
      timestamp?: string;
      speakerId?: string;
      speakerName?: string;
      sourceText?: string;
      translatedText?: string;
      language: LanguageCode;
    }
  | {
      type: "chat_message";
      id: string;
      participantId: string;
      displayName: string;
      text: string;
      timestamp: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
    }
  | {
      type: "pong";
    };

export type ParseClientMessageResult =
  | {
      ok: true;
      message: ClientMessage;
    }
  | {
      ok: false;
      error: string;
    };

export function parseClientMessage(input: unknown): ParseClientMessageResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "message_must_be_object" };
  }

  const record = input as Record<string, unknown>;

  switch (record.type) {
    case "join": {
      if (!isSupportedLanguage(record.language)) {
        return { ok: false, error: "unsupported_language" };
      }

      const displayName =
        typeof record.displayName === "string" && record.displayName.trim().length > 0
          ? record.displayName.trim()
          : "Guest";

      return {
        ok: true,
        message: {
          type: "join",
          displayName,
          language: record.language,
        },
      };
    }
    case "set_language": {
      if (!isSupportedLanguage(record.language)) {
        return { ok: false, error: "unsupported_language" };
      }

      return {
        ok: true,
        message: {
          type: "set_language",
          language: record.language,
        },
      };
    }
    case "set_mode": {
      if (record.mode !== "simultaneous" && record.mode !== "face_to_face") {
        return { ok: false, error: "unsupported_meeting_mode" };
      }

      return {
        ok: true,
        message: {
          type: "set_mode",
          mode: record.mode,
        },
      };
    }
    case "start_speaking":
      return { ok: true, message: { type: "start_speaking" } };
    case "stop_speaking":
      return { ok: true, message: { type: "stop_speaking" } };
    case "chat_message": {
      if (typeof record.text !== "string" || record.text.trim().length === 0) {
        return { ok: false, error: "message_text_required" };
      }

      return {
        ok: true,
        message: {
          type: "chat_message",
          text: record.text.trim().slice(0, 600),
        },
      };
    }
    case "ping":
      return { ok: true, message: { type: "ping" } };
    default:
      return { ok: false, error: "unknown_message_type" };
  }
}
