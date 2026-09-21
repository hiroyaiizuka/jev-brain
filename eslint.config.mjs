import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
import json from "@eslint/json";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "node_modules/**", "dist/**", "coverage/**", "artifacts/**", "test-vault/**",
    "main.js", "build-meta.json", "package-lock.json",
  ]),
  {
    files: ["src/**/*.ts"],
    extends: obsidianmd.configs.recommended,
  },
  {
    files: ["tests/**/*.ts", "vitest.config.ts"],
    extends: tseslint.configs.recommendedTypeChecked,
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["*.json"],
    plugins: { json },
    language: "json/json",
    extends: ["json/recommended"],
  },
  {
    files: ["**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["node:*", "electron"], message: "Runtime must work on mobile." }],
      }],
    },
  },

  // ---- 引き継ぎ時のベースライン（2026-09-20、上流 0.2.18 + code scanner fixes 時点） ----
  // 上流のコードにある指摘を、ファイル単位でだけ止める。新しいファイルには適用されない。
  // 該当ファイルを直したらその行を消す。件数と扱いは docs/harness.md「lint のベースライン」。
  {
    // UI 文言の大文字小文字。24 言語の locale と一緒に決める（product-plan H1）。
    files: ["src/Scene.ts", "src/Settings.ts", "src/excalibrain-main.ts", "src/utils/Prompts.ts"],
    rules: { "obsidianmd/ui/sentence-case": "off" },
  },
  {
    // インライン style を CSS クラスへ移す。見た目が変わるので実機確認と一緒に直す（product-plan H1）。
    files: ["src/Settings.ts", "src/Suggesters/Suggest.ts"],
    rules: { "obsidianmd/no-static-styles-assignment": "off" },
  },
  {
    // 設定画面の見出しを Setting.setHeading() に、検索用の getSettingDefinitions() を追加する（product-plan H1）。
    files: ["src/Settings.ts"],
    rules: {
      "obsidianmd/settings-tab/no-manual-html-headings": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    // String(error) / String(value) の引数は unknown。strictNullChecks が無効だと unknown が {} と判定され
    // 誤検知になるので、strict 化（product-plan H1）と一緒に外す。
    files: ["src/Scene.ts", "src/excalibrain-main.ts", "src/graph/Page.ts"],
    rules: { "@typescript-eslint/no-base-to-string": "off" },
  },
  {
    // Dataview / Excalidraw / ts-multiselect の any を型付きの境界に置き換える（product-plan H1）。
    files: [
      "src/Components/ts-multiselect/modules/multiselect.class.ts",
      "src/Settings.ts",
      "src/Suggesters/OntologySuggester.ts",
      "src/Suggesters/Suggest.ts",
      "src/excalibrain-main.ts",
      "src/graph/Pages.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
