import { StateField, StateEffect, RangeSet, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { BlockReferenceWidget, BlockRenderMode, BlockWidgetInteraction } from "./BlockReferenceWidget";

// --- 消息定义 (StateEffects) ---

// 消息1: 请求在某个位置添加一个“加载中”状态的 Widget
export const addLoadingWidgetEffect = StateEffect.define<{ from: number, to: number, uuid: string, mode: BlockRenderMode, interaction?: BlockWidgetInteraction }>();

// 消息2: 请求将某个位置的 Widget 更新为“已渲染”状态，并提供 HTML 内容
export const setRenderedWidgetEffect = StateEffect.define<{ from: number, to: number, content: string, mode: BlockRenderMode, interaction?: BlockWidgetInteraction }>();

// 消息3: 请求移除某个范围上的 Widget，恢复原始 Markdown 文本
export const removeWidgetEffect = StateEffect.define<{ from: number, to: number, refId?: string }>();

// --- 状态容器 (StateField) ---

export const blockReferenceField = StateField.define<DecorationSet>({
    // 创建一个空的装饰集
    create() {
        return Decoration.none;
    },

    // `update` 函数现在是状态机：它只响应传入的消息 (effects)
    update(widgets: DecorationSet, tr: Transaction): DecorationSet {
        // 首先，通过映射自动调整现有装饰的位置以响应文档变化
        widgets = widgets.map(tr.changes);

        // 然后，处理本交易中我们关心的所有消息
        for (const effect of tr.effects) {
            if (effect.is(addLoadingWidgetEffect)) {
                const { from, to, mode, interaction } = effect.value;
                const refId = interaction?.refId ?? `${mode}:${from}:${to}`;
                const signature = interaction?.signature;

                if (mode === "embed" && interaction?.cardPos !== undefined) {
                    const source = Decoration.replace({
                        blockRefId: refId,
                        blockRefRole: "source",
                        blockRefSignature: signature,
                    }).range(from, to);
                    const card = Decoration.widget({
                        widget: new BlockReferenceWidget("loading", mode, undefined, {
                            ...interaction,
                            blockWidget: true,
                            refId,
                        }),
                        block: true,
                        side: 1,
                        blockRefId: refId,
                        blockRefRole: "card",
                        blockRefSignature: signature,
                    }).range(interaction.cardPos);

                    widgets = widgets.update({
                        filter: (aFrom, aTo, value) => value.spec.blockRefId !== refId && (aTo <= from || aFrom >= to),
                        add: [source, card],
                        sort: true,
                    });
                    continue;
                }

                const isBlockWidget = interaction?.blockWidget ?? mode === "embed";
                // 使用 replace+widget 一体化装饰，直接以小部件替换占位文本，避免排序冲突
                const loading = Decoration.replace({
                    widget: new BlockReferenceWidget("loading", mode, undefined, interaction ? { ...interaction, refId } : undefined),
                    block: isBlockWidget,
                    blockRefId: refId,
                    blockRefRole: "single",
                    blockRefSignature: signature,
                }).range(from, to);

                widgets = widgets.update({
                    // 移除与此范围重叠的旧装饰，避免重复
                    filter: (aFrom, aTo, value) => value.spec.blockRefId !== refId && (aTo <= from || aFrom >= to),
                    add: [loading],
                });
            }
            else if (effect.is(setRenderedWidgetEffect)) {
                const { from, to, content, mode, interaction } = effect.value;
                const refId = interaction?.refId ?? `${mode}:${from}:${to}`;
                const signature = interaction?.signature;

                if (mode === "embed" && interaction?.cardPos !== undefined) {
                    const source = Decoration.replace({
                        blockRefId: refId,
                        blockRefRole: "source",
                        blockRefSignature: signature,
                    }).range(from, to);
                    const card = Decoration.widget({
                        widget: new BlockReferenceWidget("rendered", mode, content, {
                            ...interaction,
                            blockWidget: true,
                            refId,
                        }),
                        block: true,
                        side: 1,
                        blockRefId: refId,
                        blockRefRole: "card",
                        blockRefSignature: signature,
                    }).range(interaction.cardPos);

                    widgets = widgets.update({
                        filter: (aFrom, aTo, value) => value.spec.blockRefId !== refId && (aTo <= from || aFrom >= to),
                        add: [source, card],
                        sort: true,
                    });
                    continue;
                }

                const isBlockWidget = interaction?.blockWidget ?? mode === "embed";
                const rendered = Decoration.replace({
                    widget: new BlockReferenceWidget("rendered", mode, content, interaction ? { ...interaction, refId } : undefined),
                    block: isBlockWidget,
                    blockRefId: refId,
                    blockRefRole: "single",
                    blockRefSignature: signature,
                }).range(from, to);

                // 关键：移除与此范围重叠的旧装饰，并添加新的 replace+widget
                widgets = widgets.update({
                    filter: (aFrom, aTo, value) => value.spec.blockRefId !== refId && (aTo <= from || aFrom >= to),
                    add: [rendered],
                });
            }
            else if (effect.is(removeWidgetEffect)) {
                const { from, to, refId } = effect.value;
                widgets = widgets.update({
                    filter: (aFrom, aTo, value) => {
                        if (refId && value.spec.blockRefId === refId) {
                            return false;
                        }

                        return aTo <= from || aFrom >= to;
                    },
                });
            }
        }

        return widgets;
    },

    // 告诉编辑器，这个 StateField 提供了需要被渲染到视图中的装饰
    provide: (f) => EditorView.decorations.from(f),
});
