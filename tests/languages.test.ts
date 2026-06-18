import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  getLanguageLabel,
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
} from "../src/shared/languages";

describe("supported languages", () => {
  test("contains common languages in stable order", () => {
    expect(SUPPORTED_LANGUAGES.map((language) => language.code)).toEqual([
      "zh-Hans",
      "en",
      "ja",
      "ko",
      "es",
      "fr",
      "de",
      "pt-BR",
      "it",
      "ru",
      "ar",
      "hi",
      "th",
      "vi",
      "id",
    ]);
  });

  test("validates supported BCP-47 language codes", () => {
    expect(isSupportedLanguage("zh-Hans")).toBe(true);
    expect(isSupportedLanguage("en")).toBe(true);
    expect(isSupportedLanguage("ja")).toBe(true);
    expect(isSupportedLanguage("ko")).toBe(true);
    expect(isSupportedLanguage("es")).toBe(true);
    expect(isSupportedLanguage("fr")).toBe(true);
    expect(isSupportedLanguage("de")).toBe(true);
    expect(isSupportedLanguage("pt-BR")).toBe(true);
    expect(isSupportedLanguage("it")).toBe(true);
    expect(isSupportedLanguage("ru")).toBe(true);
    expect(isSupportedLanguage("ar")).toBe(true);
    expect(isSupportedLanguage("hi")).toBe(true);
    expect(isSupportedLanguage("th")).toBe(true);
    expect(isSupportedLanguage("vi")).toBe(true);
    expect(isSupportedLanguage("id")).toBe(true);
    expect(isSupportedLanguage("")).toBe(false);
    expect(isSupportedLanguage("pt")).toBe(false);
  });

  test("returns user-facing labels", () => {
    expect(getLanguageLabel("zh-Hans")).toBe("中文");
    expect(getLanguageLabel("en")).toBe("English");
    expect(getLanguageLabel("ja")).toBe("日本語");
    expect(getLanguageLabel("pt-BR")).toBe("Português (Brasil)");
    expect(getLanguageLabel("ru")).toBe("Русский");
  });

  test("sets sensible defaults for Chinese users", () => {
    expect(DEFAULT_SOURCE_LANGUAGE).toBe("zh-Hans");
    expect(DEFAULT_TARGET_LANGUAGE).toBe("en");
  });
});
