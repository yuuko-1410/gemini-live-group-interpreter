import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import {
  buildSpeechPrompt,
  buildTranslationPrompt,
  type SynthesizeSpeechInput,
  type TranslateTextInput,
  type Translator,
} from "./translator";

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-3.5-flash";
const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";

export function createGeminiTranslator(): Translator {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return createMissingKeyTranslator();
  }

  const ai = new GoogleGenAI({ apiKey });

  return {
    async translateText(input: TranslateTextInput) {
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: buildTranslationPrompt(input),
        config: {
          temperature: 0.1,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });

      const translatedText = response.text?.trim();
      if (!translatedText) {
        throw new Error("empty_translation");
      }

      return { translatedText };
    },

    async *translateTextStream(input: TranslateTextInput) {
      const response = await ai.models.generateContentStream({
        model: TEXT_MODEL,
        contents: buildTranslationPrompt(input),
        config: {
          temperature: 0.1,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      });

      for await (const chunk of response) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
    },

    async synthesizeSpeech(input: SynthesizeSpeechInput) {
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: buildSpeechPrompt(input) }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
        },
      });

      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!data) {
        throw new Error("empty_tts_audio");
      }

      return Uint8Array.from(Buffer.from(data, "base64"));
    },
  };
}

function createMissingKeyTranslator(): Translator {
  async function reject(): Promise<never> {
    throw new Error("missing_gemini_api_key");
  }

  return {
    translateText: reject,
    translateTextStream: async function* () {
      throw new Error("missing_gemini_api_key");
    },
    synthesizeSpeech: reject,
  };
}
