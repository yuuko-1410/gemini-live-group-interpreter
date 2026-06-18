import { type LanguageCode, getLanguageLabel } from "../shared/languages";

export type TranslateTextInput = {
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
};

export type TranslateTextOutput = {
  translatedText: string;
};

export type SynthesizeSpeechInput = {
  text: string;
  language: LanguageCode;
};

export type Translator = {
  translateText(input: TranslateTextInput): Promise<TranslateTextOutput>;
  translateTextStream(input: TranslateTextInput): AsyncIterable<string>;
  synthesizeSpeech(input: SynthesizeSpeechInput): Promise<Uint8Array>;
};

export function buildTranslationPrompt(input: TranslateTextInput): string {
  const source = getLanguageLabel(input.sourceLanguage);
  const target = getLanguageLabel(input.targetLanguage);

  return [
    `Translate the following text from ${source} to ${target}.`,
    "Return only the translated text. Do not add explanations, alternatives, or quotes.",
    "",
    input.text,
  ].join("\n");
}

export function buildSpeechPrompt(input: SynthesizeSpeechInput): string {
  const language = getLanguageLabel(input.language);
  return `Read this ${language} text naturally and clearly:\n${input.text}`;
}
