import type { EventRef } from "obsidian";

/**
 * `Scene` が中心ノートの変更を知らせる 1 本のイベント（docs/jev-link-typer-design.md §4-2）。
 *
 * 名前だけをここに置くのは、`Scene` と `src/graph/` が jev を import しないため（AGENTS）。
 * `Scene` は `workspace.trigger` にパスを渡すだけで、描画 API は jev 側へ渡らない。受け取るのは
 * `src/Components/JevQueueView.ts` で、この 1 本以外に Scene からの接点は無い。
 */
export const JEV_CENTRAL_PAGE_CHANGED = "jevbrain:central-page-changed";

declare module "obsidian" {
  interface Workspace {
    /** `trigger` は `Events` のままで足りるので、型を足すのは購読側だけ。 */
    on(
      name: typeof JEV_CENTRAL_PAGE_CHANGED,
      callback: (path: string | null) => void,
      ctx?: unknown,
    ): EventRef;
  }
}
