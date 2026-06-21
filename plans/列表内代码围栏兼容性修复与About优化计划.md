# 列表内代码围栏兼容性修复与 About 优化计划

## 背景

在真实 Logseq 风格笔记库里，发现有些页面虽然包含：

1. `((uuid))` 块引用
2. `{{embed ((uuid))}}` 块嵌入
3. `id:: uuid` 与其它 `key:: value` 属性行

但插件开启后，这些页面里的块引用、块嵌入、属性隐藏都没有生效。

实际排查文件：

1. `pages/交易赢家的21周交易日记.md`
2. `pages/投资的心智.md`

这两个页面本身语法没有问题，问题出在插件对 Markdown fenced code block 的识别不完整。

## 根因结论

原问题不是索引服务坏了，也不是用户笔记格式不合法，而是插件里存在四套彼此复制的 fenced code block 识别逻辑，而且都只支持这种过窄形式：

```ts
/^\s{0,3}(`{3,}|~{3,})/
```

它只能识别“行首最多 3 个空白后直接出现围栏”的情况，识别不了 Logseq 笔记里非常常见的“无序列表项内容本身就是 fenced block opening”的写法，例如：

```md
	- ```calc
	  ...
	  ````
```

因此会出现两个连锁问题：

1. opening line `\t- ```calc` 没被识别为代码围栏开始。
2. 后面的 closing line `\t  ````` 却会被旧逻辑误识别成新的 opening。
3. 从这行开始，后续大量内容都被当成“仍在代码块里”，扫描器直接跳过。

于是就造成：

1. 块引用扫描直接漏掉后续 `((uuid))`
2. 块嵌入扫描直接漏掉后续 `{{embed ((uuid))}}`
3. Live Preview 属性隐藏漏掉后续 `id::` / `collapsed::` / `hl-*::`
4. Enter 逻辑在处理 continuation / fence 时也会基于错误边界推断

## 已完成修复

### 1. 新增统一围栏工具

新增文件：`src/utils/markdownFence.ts`

统一提供：

1. 缩进列数计算
2. fenced code block opening 识别
3. fenced code block closing 识别

支持两类 opening：

1. 标准根级围栏
   - 例如：` ```ts `、` ~~~ `
2. Logseq / 列表项内围栏
   - 例如：`- ```calc`
   - 也兼容 task list 前缀形式

closing 规则也区分两类：

1. 根级围栏：仍要求关闭行缩进不超过 3 列
2. 列表项围栏：关闭行必须至少回到该列表项内容缩进位

### 2. 替换四处重复逻辑

已统一替换以下模块的旧围栏判断：

1. `src/services/BlockParser.ts`
2. `src/editor/AsyncBlockRendererPlugin.ts`
3. `src/services/LogseqPropertyMatcher.ts`
4. `src/editor/LogseqPropertyHidePlugin.ts`

这样索引、渲染、属性隐藏、Enter 相关扫描不再各自维护一套不一致的围栏规则。

### 3. 修复 source block 解析边界

`BlockParser` 现在会：

1. 正确识别列表项里的 fenced block opening
2. 在 fenced block 内忽略 `((uuid))`、`{{embed ((uuid))}}` 和 `id:: uuid`
3. 在 fenced block 关闭后，继续正常解析后续真实内容
4. 支持“列表项内容是 fenced block，本块的 `id:: uuid` 写在 closing 之后”的情况

### 4. 修复属性隐藏边界

`LogseqPropertyMatcher` 现在会：

1. 跳过 fenced block 内部的属性行
2. 不再把 closing line 误识别成新的 opening
3. 即使列表项第一行本身就是 `- ```calc`，closing 之后同块的属性也还能正常隐藏

### 5. 补齐 Reading Mode 同类边界

`src/main.ts` 中 Reading Mode 属性隐藏辅助扫描也补上了同类围栏判断，避免出现：

1. Live Preview 已经正确跳过 fenced block
2. Reading Mode 仍然把 fenced block 内的 `key:: value` 当成属性去隐藏

## 已加入自动验证

新增：

1. `scripts/test-markdown-fence-compat.mjs`
2. `package.json` 的 `npm test`

当前测试覆盖：

1. 列表项 opening fence 能被识别
2. closing line 不会再被误判成新的 opening
3. fenced block 内部引用不会被误收集
4. fenced block 关闭后，后续真实引用仍会被识别
5. fenced block 关闭后，同块 `id:: uuid` 仍能被挂回源块
6. 属性隐藏会跳过 fenced block 内部，但继续处理关闭后的真实属性行

## 实际验证结果

本地构建与自动验证均已通过。

对真实问题页面做再次诊断时，结果已经从“后续引用数量为 0”恢复为正常识别：

1. `交易赢家的21周交易日记.md`
   - `blockCount = 15`
   - `referenceCount = 244`
   - `hiddenCount = 95`
2. `投资的心智.md`
   - `blockCount = 47`
   - `referenceCount = 490`
   - `hiddenCount = 401`

这说明之前被整段跳过的后续内容，现在已经重新进入索引、渲染和属性隐藏路径。

## About 文案优化

为了让插件市场第一页说明更自然地覆盖高相关检索词，同时不显得生硬，当前版本将 `manifest.json` / `package.json` 描述更新为：

```text
Render and navigate UUID-based block references and block embeds in Live Preview and Reading Mode, with Logseq-style outlines, property hiding, source badges, backlinks, and local indexing.
```

这段文案覆盖的关键检索方向包括：

1. UUID block references
2. block embeds
3. Live Preview
4. Reading Mode
5. Logseq-style outlines
6. property hiding
7. source badges
8. backlinks
9. local indexing

同时避开了社区自动审查里对 `manifest` 描述使用 `Obsidian` 一词的历史错误风险。

## 版本与发布准备

本次修复已本地升级到：`1.3.6`

已同步更新：

1. `package.json`
2. `package-lock.json`
3. `manifest.json`
4. `versions.json`

## 非目标

这次不处理以下内容：

1. GitHub artifact attestations
2. `Vault Enumeration` / `Clipboard Access` 这类社区提示
3. 块引用 / 块嵌入结果卡片内的二次渲染
4. 更大范围的列表编辑交互重构

## 后续发布步骤

如果本地手动验收没有问题，下一步就是：

1. 推送 `main`
2. 创建 `1.3.6` Release
3. 上传 `main.js`、`manifest.json`、`styles.css`
4. 去 Obsidian 社区插件后台点击 `Check for new releases`
5. 等待最新版本扫描完成

## 后续补强：旧缓存自动失效与重建

围栏兼容修复本身只解决了“新解析器已经能识别”的问题，但后来在真实库里进一步确认：

1. 如果用户升级前已经把错误结果写进了 `data.json`
2. 启动时又直接沿用旧缓存

那么即使代码已经修好，这些页面仍然会继续表现为：

1. 块引用不渲染
2. 块嵌入不渲染
3. 属性隐藏不起作用

只有手动删除插件目录、删除 `data.json` 或强制完整重建后才恢复。

因此下一步补上了缓存迁移机制，发布版本为 `1.3.7`，核心策略如下：

1. 缓存 schema 从 `3` 升级到 `4`
2. 新缓存增加 `parserRevision`
3. 旧 schema、旧 parser revision、旧数组格式缓存全部自动视为失效
4. 插件启动后直接显示 `Block index: cache outdated, rebuilding full index...`
5. 自动执行一次完整重建，成功后再覆盖旧缓存

这样用户升级后不再需要手动删缓存，旧解析错误也不会继续长期残留。
