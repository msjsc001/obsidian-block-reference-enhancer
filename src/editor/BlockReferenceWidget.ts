import { WidgetType } from "@codemirror/view";
import { replaceChildrenFromHtml } from "src/utils/html";

export type BlockRenderMode = "inline" | "embed";
export interface BlockWidgetInteraction {
    from: number;
    to: number;
    revealPos: number;
    stale?: boolean;
    blockWidget?: boolean;
    preserveListMarker?: boolean;
    availableInlineWidthPx?: number;
    listPrefixColumns?: number;
    listMarkerOffsetPx?: number;
    listContentOffsetPx?: number;
    cardPos?: number;
    refId?: string;
    signature?: string;
    lineHeightPx?: number;
    reservedHeightPx?: number;
}

/**
 * 这是一个纯粹的“视图”组件。
 * 它只根据传入的状态来决定自己应该显示什么，不包含任何异步逻辑。
 */
export class BlockReferenceWidget extends WidgetType {
    constructor(
        readonly state: "loading" | "rendered",
        readonly mode: BlockRenderMode,
        readonly content?: string,
        readonly interaction?: BlockWidgetInteraction
    ) {
        super();
    }

    eq(other: BlockReferenceWidget): boolean {
        // 只有当状态和内容都完全相同时，才认为两个 Widget 相等，以避免不必要的重绘
        return this.state === other.state
            && this.mode === other.mode
            && this.content === other.content
            && this.interaction?.from === other.interaction?.from
            && this.interaction?.to === other.interaction?.to
            && this.interaction?.revealPos === other.interaction?.revealPos
            && this.interaction?.stale === other.interaction?.stale
            && this.interaction?.blockWidget === other.interaction?.blockWidget
            && this.interaction?.preserveListMarker === other.interaction?.preserveListMarker
            && this.interaction?.availableInlineWidthPx === other.interaction?.availableInlineWidthPx
            && this.interaction?.listPrefixColumns === other.interaction?.listPrefixColumns
            && this.interaction?.listMarkerOffsetPx === other.interaction?.listMarkerOffsetPx
            && this.interaction?.listContentOffsetPx === other.interaction?.listContentOffsetPx
            && this.interaction?.cardPos === other.interaction?.cardPos
            && this.interaction?.refId === other.interaction?.refId
            && this.interaction?.signature === other.interaction?.signature
            && this.interaction?.lineHeightPx === other.interaction?.lineHeightPx
            && this.interaction?.reservedHeightPx === other.interaction?.reservedHeightPx;
    }

    ignoreEvent(event: Event): boolean {
        if (this.mode !== "embed") {
            return true;
        }

        return event.type !== "mousedown";
    }

    private createEmbedCard(isBlockWidget: boolean, isListCard: boolean): HTMLElement {
        const card = document.createElement("div");
        const usesMeasuredListLayout = this.interaction?.listMarkerOffsetPx !== undefined
            && this.interaction?.listContentOffsetPx !== undefined;
        const preservesListMarker = this.interaction?.preserveListMarker === true;
        card.className = `block-reference-enhancer-widget block-reference-embed-widget markdown-rendered${isBlockWidget ? "" : " is-inline-embed"}${isListCard ? " is-list-embed-card" : ""}${usesMeasuredListLayout ? " is-measured-list-embed" : ""}${preservesListMarker ? " is-list-inline-embed" : ""}`;

        if (this.interaction) {
            card.dataset.blockRefFrom = String(this.interaction.from);
            card.dataset.blockRefTo = String(this.interaction.to);
            card.dataset.blockRefRevealPos = String(this.interaction.revealPos);
            if (this.interaction.stale) {
                card.addClass("is-stale");
                card.setAttribute("title", "Source block missing. Showing cached content.");
            }

            if (this.interaction.refId) {
                card.dataset.blockRefId = this.interaction.refId;
            }

            if (this.interaction.availableInlineWidthPx !== undefined) {
                card.style.setProperty("--block-reference-inline-available-width-px", `${this.interaction.availableInlineWidthPx}px`);
            }

            if (this.interaction.listPrefixColumns !== undefined) {
                card.style.setProperty("--block-reference-list-prefix-columns", `${this.interaction.listPrefixColumns}ch`);
            }

            if (this.interaction.listMarkerOffsetPx !== undefined) {
                card.style.setProperty("--block-reference-list-marker-offset-px", `${this.interaction.listMarkerOffsetPx}px`);
            }

            if (this.interaction.listContentOffsetPx !== undefined) {
                card.style.setProperty("--block-reference-list-content-offset-px", `${this.interaction.listContentOffsetPx}px`);
            }

            if (this.interaction.lineHeightPx !== undefined) {
                card.style.setProperty("--block-reference-line-height-px", `${this.interaction.lineHeightPx}px`);
            }
        }

        if (this.mode === "embed" && usesMeasuredListLayout && !preservesListMarker) {
            const layout = document.createElement("div");
            layout.className = "block-reference-live-preview-list-embed";

            const marker = document.createElement("span");
            marker.className = "block-reference-live-preview-list-marker";
            marker.setAttribute("aria-hidden", "true");

            const embed = document.createElement("div");
            embed.className = "block-reference-embed block-reference-live-preview-embed-card";

            if (this.state === "loading") {
                embed.setText("Loading block...");
                card.addClass("is-loading");
            } else if (this.state === "rendered" && this.content) {
                replaceChildrenFromHtml(embed, this.content);
            } else {
                embed.setText("Error: Invalid state");
                card.addClass("is-error");
            }

            layout.append(marker, embed);
            card.appendChild(layout);
            return card;
        }

        if (this.state === "loading") {
            const reservedHeight = Math.max(this.interaction?.reservedHeightPx ?? 0, 0);
            if (reservedHeight > 0) {
                card.style.minHeight = `${reservedHeight}px`;
            }
            card.setText(this.mode === "embed" ? "Loading block..." : "Loading...");
            card.addClass("is-loading");
        } else if (this.state === "rendered" && this.content) {
            if (this.mode === "embed") {
                replaceChildrenFromHtml(card, this.content);
            } else {
                card.setText(this.content);
            }
        } else {
            card.setText("Error: Invalid state");
            card.addClass("is-error");
        }

        return card;
    }

    private createListEmbedSpacer(): HTMLElement {
        const spacer = document.createElement("div");
        spacer.className = "block-reference-embed-spacer";
        const reservedHeight = Math.max(this.interaction?.reservedHeightPx ?? 0, 0);
        spacer.style.height = `${reservedHeight}px`;
        return spacer;
    }

    toDOM(): HTMLElement {
        const isBlockWidget = this.interaction?.blockWidget ?? this.mode === "embed";
        const isListCard = this.interaction?.cardPos !== undefined;

        if (this.mode === "embed" && isListCard) {
            return this.createListEmbedSpacer();
        }

        const container = document.createElement(this.mode === "embed" ? "div" : "span");

        if (this.mode === "embed") {
            return this.createEmbedCard(isBlockWidget, false);
        } else {
            container.className = "block-reference-enhancer-widget block-reference-inline-ref";
        }

        if (this.interaction?.stale) {
            container.addClass("is-stale");
            container.setAttribute("title", "Source block missing. Showing cached content.");
        }

        if (this.state === "loading") {
            container.setText("Loading...");
            container.addClass("is-loading");
        } else if (this.state === "rendered" && this.content) {
            container.setText(this.content);
        } else {
            container.setText("Error: Invalid state");
            container.addClass("is-error");
        }

        return container;
    }
}
