import { describe, test } from "node:test";
import * as assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { detectLocale, hasTranslation, matchLocale, translate } from "../src/dashboard/app/lib/i18n.js";

describe("dashboard locale matching", () => {
  test("matches supported base and regional browser locales", () => {
    assert.strictEqual(matchLocale("en-GB"), "en");
    assert.strictEqual(matchLocale("zh_Hans_CN"), "zh-CN");
    assert.strictEqual(matchLocale("zh-SG"), "zh-CN");
    assert.strictEqual(matchLocale("ja-JP"), "ja");
    assert.strictEqual(matchLocale("ru-RU"), "ru");
  });

  test("uses the first supported browser preference", () => {
    assert.strictEqual(detectLocale(["fr-FR", "ja-JP", "en-US"]), "ja");
  });

  test("falls back to English when no locale is supported", () => {
    assert.strictEqual(detectLocale(["fr-FR", "de-DE"]), "en");
    assert.strictEqual(detectLocale(["zh-TW"]), "en");
    assert.strictEqual(detectLocale([]), "en");
  });
});

describe("dashboard translations", () => {
  test("translates and interpolates supported messages", () => {
    assert.strictEqual(translate("zh-CN", "Overview"), "概览");
    assert.strictEqual(translate("ja", "{count} actions", { count: 3 }), "3 件の操作");
    assert.strictEqual(translate("ru", "OpenWolf Dashboard"), "Панель OpenWolf");
  });

  test("uses English source text as the per-message fallback", () => {
    assert.strictEqual(translate("zh-CN", "Untranslated {value}", { value: "text" }), "Untranslated text");
  });

  test("provides every statically referenced message in every supported language", () => {
    const appRoot = path.resolve("src/dashboard/app");
    const files = walk(appRoot).filter((file) => file.endsWith(".tsx"));
    const messages = new Set<string>();

    for (const file of files) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments[0]) {
          const collectStrings = (value: ts.Node): void => {
            if (ts.isStringLiteral(value)) messages.add(value.text);
            else if (ts.isConditionalExpression(value)) {
              collectStrings(value.whenTrue);
              collectStrings(value.whenFalse);
            } else if (ts.isParenthesizedExpression(value)) {
              collectStrings(value.expression);
            }
          };
          collectStrings(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    const dynamicMessages = [
      "Overview", "Tokens", "Activity", "Cron", "Cerebrum", "Memory", "Anatomy", "Bugs",
      "light", "dark", "healthy", "running", "success", "ok", "enabled", "initialized",
      "warning", "retrying", "degraded", "error", "failed", "stopped", "disabled", "unknown",
    ];
    for (const message of dynamicMessages) messages.add(message);

    for (const locale of ["zh-CN", "ja", "ru"] as const) {
      const missing = [...messages].filter((message) => !hasTranslation(locale, message));
      assert.deepStrictEqual(missing, [], `${locale} is missing: ${missing.join(", ")}`);
    }
  });
});

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
