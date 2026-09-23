import type { Direction } from "src/jev/judge";
import { t } from "src/lang/helpers";

/**
 * Jev の画面（キューとサジェスター）が共有する文言の小道具（LEV-175）。
 * `judge.ts` の日本語のラベルは Jev に送る criteria の説明なので、画面はプラグインの言語で書く。
 */
const DIRECTION_KEYS: Record<Direction, Parameters<typeof t>[0]> = {
  parent: "JEV_DIRECTION_PARENT",
  child: "JEV_DIRECTION_CHILD",
  leftFriend: "JEV_DIRECTION_LEFT_FRIEND",
  rightFriend: "JEV_DIRECTION_RIGHT_FRIEND",
  previous: "JEV_DIRECTION_PREVIOUS",
  next: "JEV_DIRECTION_NEXT",
};

export const directionLabel = (direction: Direction): string => t(DIRECTION_KEYS[direction]);

/**
 * `{name}` を値で埋める。`String.prototype.replace` の置換文字列は `$&` などを解釈するので、
 * フィールド名やリンク先に `$` があっても崩れないよう関数で渡す。
 */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (whole, name: string) => values[name] ?? whole);
