export const SUPPORTED_LANGUAGES = [
  { code: "zh-Hans", label: "中文", englishLabel: "Chinese" },
  { code: "en", label: "English", englishLabel: "English" },
  { code: "ja", label: "日本語", englishLabel: "Japanese" },
  { code: "ko", label: "한국어", englishLabel: "Korean" },
  { code: "es", label: "Español", englishLabel: "Spanish" },
  { code: "fr", label: "Français", englishLabel: "French" },
  { code: "de", label: "Deutsch", englishLabel: "German" },
  { code: "pt-BR", label: "Português (Brasil)", englishLabel: "Portuguese (Brazil)" },
  { code: "it", label: "Italiano", englishLabel: "Italian" },
  { code: "ru", label: "Русский", englishLabel: "Russian" },
  { code: "ar", label: "العربية", englishLabel: "Arabic" },
  { code: "hi", label: "हिन्दी", englishLabel: "Hindi" },
  { code: "th", label: "ไทย", englishLabel: "Thai" },
  { code: "vi", label: "Tiếng Việt", englishLabel: "Vietnamese" },
  { code: "id", label: "Bahasa Indonesia", englishLabel: "Indonesian" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_SOURCE_LANGUAGE: LanguageCode = "zh-Hans";
export const DEFAULT_TARGET_LANGUAGE: LanguageCode = "en";

export function isSupportedLanguage(value: unknown): value is LanguageCode {
  return (
    typeof value === "string" &&
    SUPPORTED_LANGUAGES.some((language) => language.code === value)
  );
}

export function getLanguageLabel(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}
