# Block Reference Enhancer

[English README](./README.en.md)

<img alt="20210606180518" src="https://github.com/user-attachments/assets/24556d2d-cca1-4913-a6b6-8e9e3418304a" />

<img alt="图片" src="https://github.com/user-attachments/assets/b69b1a35-7e31-4cf2-ae20-73ce725e7046" />

<img alt="图片" src="https://github.com/user-attachments/assets/bb31f1bf-5c23-4e5d-b3f3-014b64147b9f" />


在 Obsidian 中渲染基于 UUID 语法的块引用与块嵌入，并兼容 Logseq 常见的大纲块写法。

当前版本的定位更接近一个“查看器”：
- 普通块引用 `((uuid))` 会在 Reading Mode 和 Live Preview 中显示为行内摘要。
- 块嵌入 `{{embed ((uuid))}}` 会在 Reading Mode 和 Live Preview 中显示完整块内容与子级。
- 原始 Markdown 不会被改写。
- 插件会维护自己的一份块索引，不依赖 Obsidian 自带搜索索引。

## 当前可以做什么

- 在 Reading Mode 中查看：
  - 普通块引用 `((uuid))`
  - 块嵌入 `{{embed ((uuid))}}`
- 在 Live Preview 中查看：
  - 普通块引用 `((uuid))` 的行内摘要
  - 块嵌入 `{{embed ((uuid))}}` 的完整渲染内容
- 在编辑器中输入 `((` 使用块自动补全
- 使用命令复制当前块引用
- 自动扫描库内 Markdown 文件，建立索引并使用本地缓存
- 在状态栏持续显示块索引阶段和当前统计信息
- 支持命令手动重建块索引
- 当源块丢失但引用还存在时，使用最后缓存内容继续显示
- 支持审查缺失源块并恢复到恢复页

## 当前达到的效果

- 普通块引用 `((uuid))` 不再强制独占一行，而是以更适合 Obsidian 的行内方式显示
- 块嵌入 `{{embed ((uuid))}}` 会继续显示完整内容和子级，适合作为查看器使用
- Live Preview / 编辑模式下，滚动到块嵌入区域时页面自动缓慢下滑的问题已经修复
- Live Preview / 编辑模式下，块引用与块嵌入触发的高频日志刷新问题已经修复
- Reading Mode 下，长页面中包含较多块嵌入时的自动滚动问题已经修复
- Live Preview 已经可用，复杂列表和不同主题下仍可能有细微样式差异

## 安装与使用

适合普通用户的手动安装方式：

1. 打开你的 Obsidian 库目录
2. 进入 `.obsidian/plugins/`
3. 新建一个文件夹，名字使用插件 ID：`logseq-block-ref-enhancer`
   当前插件 ID 仍保留旧值以兼容现有安装和本地数据
4. 将仓库中的这三个文件复制进去：
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. 回到 Obsidian，打开“设置” -> “第三方插件”
6. 打开 `Block Reference Enhancer`

启用后就可以直接查看：
- `((uuid))`
- `{{embed ((uuid))}}`

插件启用后会自动建立索引：
- 首次完整建索引时会在状态栏显示进度
- 如果已经有缓存，启动时状态栏也会显示 `loading cache`、`checking vault changes`、`reconciling`、`ready` 这类阶段状态
- 后续 Markdown 文件增删改重命名会静默增量更新
- 索引完成后，状态栏会保留当前 `ready` 统计信息，方便确认插件已经完成启动期索引
- 如果你在 Obsidian 之外通过 Logseq、同步工具、外部编辑器或 git 大量改动了文件，建议手动重建一次索引
- 如果本地缓存文件不存在，插件启动时会提示正在建立新的完整索引

### 状态栏与索引状态

插件启用后，状态栏会显示 `Block index: ...` 相关信息。这是插件自己的块索引状态，不是 Obsidian 自带搜索索引的状态。

你通常会看到这些状态：
- `Block index: loading cache...`
  插件正在读取本地缓存。
- `Block index: no cache found, building full index...`
  本地没有可用缓存，插件正在做第一次完整建索引。
- `Block index: cache loaded, checking vault changes...`
  缓存已加载，插件正在检查库里的 Markdown 文件是否和缓存一致。
- `Block index: checking vault changes...`
  正在检查是否有外部改动，但暂时还没有进入逐文件对账。
- `Block index: reconciling X/Y files | A changed | B removed`
  插件已经发现有改动，正在把实际文件和缓存重新对齐。
- `Block index: building X/Y files | N blocks | M refs`
  正在做完整重建，状态栏会实时显示已处理文件数、块数、引用数。
- `Block index: ready | F files | B blocks | R refs`
  启动期索引已经完成，当前统计信息会保留在状态栏中，方便确认插件已经准备好。
- `Block index: rebuild failed`
  手动重建失败，需要查看控制台日志或重试。

补充说明：
- 启动后的日常增删改重命名会静默更新索引，通常不会持续弹出进度提示。
- 第一次完整建索引完成后，插件会弹出一次完成提示。
- 手动执行 `Rebuild block reference index` 后，插件也会弹出一次完成提示，并显示文件数、块数、引用数。
- 如果状态栏已经稳定显示 `Block index: ready ...`，通常就说明插件已经完成当前启动阶段的索引工作。

## 常用功能

### 1. 普通块引用

在笔记中写入：

```md
((xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx))
```

插件会尽量把它显示成目标块第一行的行内摘要。

### 2. 块嵌入

在笔记中写入：

```md
{{embed ((xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx))}}
```

插件会显示目标块的完整内容和子级。

### 3. 复制当前块引用

将光标放到一个无序列表块上，打开命令面板并执行：

`Copy current block reference`

如果当前块还没有 `id:: uuid`，插件会自动补上，再把 `((uuid))` 复制到剪贴板。

### 4. 块自动补全

在编辑器中输入：

```md
((
```

会触发块搜索和自动补全。

### 5. 手动重建块索引

打开命令面板并执行：

`Rebuild block reference index`

适合这些情况：
- 你在插件关闭期间，通过 Logseq、同步工具、外部编辑器或 git 大量改动了 Markdown 文件
- 你在大库里看到部分 `((uuid))` 显示为 `[missing block]`
- 你看到块嵌入显示为 `Missing block`

执行时：
- 状态栏会显示索引进度
- 如果重建成功，状态栏会回到 `Block index: ready | ...`
- 完成后会弹出文件数、块数、引用数的结果提示

### 6. 审查缺失源块

打开命令面板并执行：

`Review missing source blocks`

当一个带 `id:: uuid` 的源块消失，但库里还有引用时：
- 行内引用会显示最后缓存摘要，并标记这是缓存内容
- 块嵌入会显示最后缓存的完整内容，并提示源块缺失
- 你可以在审查窗口里：
  - 恢复到恢复页
  - 确认删除
  - 暂时忽略

默认恢复页路径：

`pages/Block Recovery.md`

## 开发

```bash
npm install
npm run build
```

构建产物是：
- `main.js`
- `manifest.json`
- `styles.css`

## 已知情况

- 这个插件目前更偏向 UUID 块引用与块嵌入增强器，而不是完整的 Logseq 编辑体验
- Live Preview 下，复杂列表、较长嵌入内容、不同主题样式之间，仍可能存在少量视觉差异
- 当前恢复策略固定为恢复到 recovery page，不默认尝试按原文件和原行号插回源块

## 路线图

后续计划会逐步支持：在 Obsidian 的某一个无序列表块上直接建立独立 UUID，用来做真正的块引用和块嵌入。

后续也计划补充一个面向块引用与块嵌入展开内容的插件内搜索视图，让搜索结果可以基于 UUID 对应的真实块内容，而不只是基于笔记里的原始 `((uuid))` / `{{embed ((uuid))}}` 语法。

除此之外，后面还会继续补充更多与块引用、块嵌入相关的能力，但节奏和范围会按实际使用情况逐步推进。
