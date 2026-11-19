import { t, type Language } from "./i18n.ts";

export type UnavailableComparisonReason = "identical" | "baseline-failed" | "binary" | "unmapped";

export function unavailableComparisonMessage(reason: UnavailableComparisonReason, language?: Language): string {
  switch (reason) {
    case "identical":
      return t("No visible change in the PDF.", undefined, language);
    case "baseline-failed":
      return t("No PDF comparison because the previous version could not be compiled.", undefined, language);
    case "binary":
      return t("Binary file changed. No PDF comparison is available.", undefined, language);
    case "unmapped":
      return t("No PDF preview for this source change.", undefined, language);
  }
}

export function sourceActionLabel(open: boolean, language?: Language): string {
  return t(open ? "Hide LaTeX source" : "Show LaTeX source", undefined, language);
}
