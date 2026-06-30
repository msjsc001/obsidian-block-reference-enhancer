# 密集块引用与 Outliner 兼容性能修复计划

## Summary

目标是修复两个已经确认的性能与兼容性问题：

1. 在块引用、块嵌入非常密集的页面里，Live Preview 会因为可见区反复增删 widget 而明显卡顿，尤其是在切换页面和点击密集区域时。
2. 开启 Outliner 时，Outliner 的垂直线插件会对被 `Decoration.replace(...)` 替换掉的引用位置调用 `coordsAtPos()`，而当前 widget 没有提供坐标，导致 `coordsAtPos()` 返回 `null`，进而触发 Outliner 的 `Cannot read properties of null (reading 'left')` 异常和反复测量。

这次修复只处理 Live Preview 的渲染稳定性和第三方兼容，不改索引、缓存、Markdown 语法、命令或设置项。

## Confirmed Root Cause

### 1. Outliner 异常的直接根因

- 当前块引用和块嵌入使用 `Decoration.replace(...)` 把源码替换成 widget。
- `BlockReferenceWidget` 没有实现 CodeMirror `WidgetType.coordsAt(...)`。
- 垂直线插件在被替换范围内调用 `view.coordsAtPos(...)` 时，CodeMirror 拿不到 widget 内部坐标，只能返回 `null`。
- Outliner 没做空值保护，直接读取 `coords.left`，于是抛异常并进入反复重新计算。

### 2. 密集页面卡顿的直接根因

- 当前 inline 块引用只保留“精确可见区 ±12 行”。
- 原始 UUID 语法很短，第一次进入页面时可见区能容纳很多行。
- 一旦这些行被渲染成更长的引用摘要，换行增多，实际可见区变窄。
- 当前实现会把刚刚滑出精确可见区的 inline widget 立即移除，页面高度又缩回去；随后可见区扩大，又把它们加回来。
- 这会形成可见区与渲染结果互相推拉的抖动，在高密度页面里表现为 `scanAndRender -> dispatch -> viewportChanged -> scanAndRender` 的重复循环。

## Final Fix Strategy

### 1. 为 replace widget 提供坐标

- 给 `BlockReferenceWidget` 实现 `coordsAt(dom, pos, side)`。
- 坐标读取规则：
  - 优先取 widget DOM 的 `getClientRects()`
  - 根据 `pos/side` 选择首个或末个 rect
  - 如果没有有效 rect，则退回 `getBoundingClientRect()`
- 同样给 `SourceReferenceBadgeWidget` 提供坐标，保证行尾 badge 也不会对外返回空坐标。
- 这部分不依赖 Outliner，不导入 Outliner，也不写针对性兼容判断。

### 2. inline 引用改成“激活区 + 保留区”两层策略

- 激活区：当前可见区 ±12 行。
- 保留区：当前可见区 ±96 行。
- 规则：
  - 新的 inline 引用只在激活区内首次渲染。
  - 已经渲染出来的 inline 引用，只要还在保留区内，就继续保留，不立即移除。
  - 只有超出保留区、签名变化、索引变化、进入 reveal/source 状态时才移除。
- 目标是避免高度变化导致的来回增删。

### 3. 控制单次 inline 渲染批量

- 单次扫描最多新增 12 个 inline widget。
- 如果当前批次之后还有待渲染的 inline 引用，则在下一帧继续调度一次扫描，直到补齐。
- embed 不走这个限制，仍保持当前加载队列逻辑。
- 这样可以避免一个页面切入时一次性塞入几十个 inline replace widget，降低主线程峰值。

### 4. 降低扫描指纹的抖动敏感度

- 扫描指纹改用“可见行范围”而不是当前精确字符范围。
- 保留：
  - `documentScanVersion`
  - 当前选择
  - reveal 状态
  - focus 状态
  - 内容宽度
  - 索引 revision
- 这样可以减少因为页面高度微小变化导致的扫描指纹频繁失效。

### 5. 不改的部分

- 不改块引用、块嵌入语法。
- 不改属性隐藏功能。
- 不改源块 badge 业务逻辑。
- 不改索引缓存 schema。
- 不加新设置项。

## Implementation Notes

### Files

- `src/editor/BlockReferenceWidget.ts`
- `src/editor/SourceReferenceBadgeWidget.ts`
- `src/editor/AsyncBlockRendererPlugin.ts`
- 可选共用工具：`src/utils/widgetCoords.ts`

### Important Constraints

- 不能为了兼容 Outliner 去硬编码检测 `plugin:obsidian-outliner`。
- 不能回到“一次扫描把所有 inline 引用都立刻替换”的模式。
- 不能把 embed 也塞进大保留区，否则 overlay/card 的定位会更难稳定。
- 不能让这次修复依赖默认主题以外的视觉计算。

## Test Plan

### Manual

1. 在不开 Outliner 的情况下打开高密度页面：
   - `看板日程✅.md`
   - 预期：切页明显更顺，点击密集引用区域时不再持续掉帧。

2. 开启 Outliner 后再次打开同一页面：
   - 预期：控制台不再出现 `Cannot read properties of null (reading 'left')`
   - 预期：不再反复出现 `Measure loop restarted more than 5 times` 或 `Viewport failed to stabilize`

3. 回归普通页面：
   - `学会提问.md`
   - 预期：渲染逻辑和交互不退化。

### Build

- `npm run build`
- `git diff --check`

## Expected Outcome

- Outliner 开启时不再因为坐标为 `null` 抛错。
- 高密度 inline 引用页面不再因为可见区抖动而重复增删 widget。
- 页面切换和点击密集区域的卡顿会明显下降。
- 不开启 Outliner 时也稳定可用，不引入额外依赖或模式分支。

## Release Notes

- 这一轮最终要发布为 `1.3.11`。
- 用户可见变化是：
  - 密集块引用、块嵌入页面在切页、滚动和焦点切换时更稳定
  - 光标离开块引用后，会更快恢复到渲染态
  - 深层长引用的换行更依赖可用宽度缓存，减少向页面最左侧跳动
- 这份文档保留作为后续继续跟踪 Live Preview 稳定性与 Outliner 兼容性的续接记录。

## 滚动时长文本跳到最左侧的补充修复

性能抖动修复后，深层无序列表里的长块引用仍可能在滚动重测期间短暂从列表缩进位置跳到编辑区最左侧。截图所示内容虽然位于块嵌入使用场景中，但实际发生换行的是 Live Preview 的 inline 块引用 widget。

补充根因：

- 之前只约束了嵌入容器内部的 `.block-reference-inline-ref`，直接替换 `((uuid))` 的 CodeMirror widget 仍是普通 inline 元素。
- 长摘要由 CodeMirror 外层视觉行负责换行时，深层列表的实际 tab 前缀不会成为 widget 内部的换行缩进，因此续行可能从外层行左边界开始。
- 可用宽度原先在每次扫描中重新调用 `coordsAtPos()` 计算。滚动重排瞬间如果取到临时坐标，错误宽度会覆盖正确缓存并触发 widget 再次替换，形成短暂跳动。
- Outliner 在 DOM 替换窗口内仍可能读取 widget 坐标；其实现不接受 `null`，因此坐标兼容层必须提供祖先矩形或最终零尺寸矩形兜底。

最终修复规则：

- 所有 Live Preview inline 块引用 widget 都改为受限 `inline-block`，长文本在自己的盒子内换行。
- 从引用起点到编辑区右边缘测量可用宽度，并预留 16px 安全余量；宽度按 4px 向下量化，避免亚像素变化触发临界换行。
- 每个引用首次获得正确宽度后保持缓存；普通滚动不重新取横向坐标。编辑区宽度变化时只按宽度差调整，文档内容变化时清空缓存重测。
- `measureWidgetCoords()` 优先使用 widget 自身矩形，其次使用祖先矩形，最后返回 DOM 边界矩形，不向不做空值保护的第三方插件暴露 `null`。

补充验收：

1. 在 `看板日程✅.md` 的深层密集引用区域连续上下滚动，长引用续行应始终与正文起点对齐，不再跳到页面最左侧。
2. 改变左右侧栏宽度后再次滚动，引用应按新的编辑区宽度换行且保持稳定。
3. 开启和关闭 Outliner 分别验证；不开 Outliner 时不能产生额外布局差异。
4. 控制台中的 Outliner `null.left` 应显著减少或消失；若仍有同样错误，需要区分是否来自 Outliner 自身的非插件 widget 路径。
