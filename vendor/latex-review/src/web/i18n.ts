import { zhCN } from "./zh-CN.ts";

// The viewer reads in English unless the page asks for another language with
// ?lang=zh-CN (Papilot passes its interface language). The English text is the
// message key, so a string without a translation still reads correctly.
export type Language = "en" | "zh-CN";
const messages: Record<Language, Record<string, string>> = {
  en: {},
  "zh-CN": zhCN,
};
export function pageLanguage(search = location.search): Language {
  return new URLSearchParams(search).get("lang")?.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en";
}
const current: Language =
  typeof location === "undefined" ? "en" : pageLanguage();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const language = () => current;
// Dates and numbers follow the interface language.
export const locale = () => (current === "zh-CN" ? "zh-CN" : "en-US");

// Links inside the viewer keep the page's language.
export function withLanguage(href: string) {
  return current === "en"
    ? href
    : `${href}${href.includes("?") ? "&" : "?"}lang=${current}`;
}

// t("Round {round}", { round }) fills {placeholders} after translating.
export function t(text: string, values?: Record<string, string | number>) {
  const template = messages[current][text] ?? text;
  return values
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in values ? String(values[name]) : match,
      )
    : template;
}
// English picks between one and other by count; {n} is the count.
export function tn(
  count: number,
  one: string,
  other: string,
  values?: Record<string, string | number>,
) {
  return t(count === 1 ? one : other, { n: count, ...values });
}
