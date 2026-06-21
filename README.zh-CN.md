# Block Reference Enhancer

English documentation is available in [README.md](./README.md).

插件支持 Obsidian 使用低粒度的块引用块嵌入，也能把基于 UUID 的块引用、块嵌入，在 Obsidian 里变得清楚、可读、可点开、可继续使用，同时兼容 Logseq 块引用、块嵌入语法风格在 Obsidian 渲染与使用。

<img alt="图片" src="https://github.com/user-attachments/assets/9aca75b9-056a-4a7e-bb62-6562f93deb03" />

它是一个“显示增强器”和“渲染器”（同时它也能建立和自动检测块引用块嵌入的增删）：
- `((uuid))` 会显示成行内摘要
- `{{embed ((uuid))}}` 会显示成完整块嵌入和子级内容
- 原始 Markdown 不会被改写
- 插件会维护自己的本地块索引，不依赖 Obsidian 自带搜索索引

> [!NOTE]
> 插件显示名：`Block Reference Enhancer`  
> 插件 ID 和安装文件夹名：`block-reference-enhancer`  
> GitHub 仓库保留 `obsidian-` 前缀，仅用于仓库命名，不是插件 ID。

## ✨ 这个插件能做什么

如果你的笔记已经是 UUID 风格的块结构，这个插件可以让它们在 Obsidian 里更自然地工作，而不用你重写整套笔记格式。

你可以直接得到：
- `((uuid))` 的行内摘要显示
- `{{embed ((uuid))}}` 的完整块嵌入显示
- 渲染后的块引用、块嵌入可通过悬浮出现的 `Back` 按钮跳回源块
- 源块旁的引用次数数字 badge
- 点击数字后展开的引用位置弹窗
- 输入 `((` 后的块自动补全
- 复制当前块引用或块嵌入的命令和右键菜单入口
- 可隐藏 Logseq 风格大纲属性行，例如 `id::`、`collapsed::`、`hl-*::`
- 源块内容保存后，已有块引用和块嵌入会自动同步刷新
- 面向大库的本地索引和缓存

## 👀 适合谁用

- 从 Logseq 风格 UUID 笔记迁移到 Obsidian 的用户
- 主要写大纲型 Markdown 笔记的用户
- 需要在大库里稳定查看块引用、块嵌入的用户
- 希望 Live Preview 和 Reading Mode 都能正常显示的用户

<img alt="20210606180518-2" src="https://github.com/user-attachments/assets/bd3336d4-ddfe-42e8-9e24-fbe6cc5238a1" />

<img alt="截图" src="https://github.com/user-attachments/assets/b69b1a35-7e31-4cf2-ae20-73ce725e7046" />

<img alt="图片" src="https://github.com/user-attachments/assets/9b50225a-00ce-4078-850b-89b8397be095" />

## 🚀 安装方式

### 社区插件市场安装

1. 打开 `设置` -> `第三方插件`
2. 搜索 `Block Reference Enhancer`
3. 安装
4. 启用

### 手动安装

1. 从最新 GitHub Release 下载 `main.js`、`manifest.json`、`styles.css`
2. 打开你的 Obsidian 库目录
3. 进入 `.obsidian/plugins/`
4. 新建文件夹 `block-reference-enhancer`
5. 把这三个文件放进去
6. 回到 Obsidian 启用插件

## 📝 笔记里的原始语法样式

### 源块

```md
- 机会成本
  id:: 68a92328-da50-46cc-aa45-73dec00ca8ce
```

### 普通块引用

```md
((68a92328-da50-46cc-aa45-73dec00ca8ce))
```

### 块嵌入

```md
{{embed ((68a92328-da50-46cc-aa45-73dec00ca8ce))}}
```

## 🎯 启用插件后的效果

### 普通块引用

`((uuid))` 会尽量显示成目标块第一行的简短摘要。

鼠标悬浮、聚焦或点击到渲染后的引用上时，会出现并保持显示一个小的 `Back` 按钮，用来跳回源块。

### 块嵌入

`{{embed ((uuid))}}` 会显示目标块本身和它的子级内容。

鼠标悬浮、聚焦或点击到渲染后的嵌入上时，也会出现并保持显示同样的 `Back` 按钮，用来跳回源块。

### 源块右侧数字

当某个源块已经被引用时，插件会在源块旁显示一个数字 badge。这个数字会在以下两种模式里都出现：
- Live Preview
- Reading Mode

点击这个数字，可以打开一个紧凑的引用弹窗。弹窗会显示：
- 文件名
- 行号
- 引用类型
- 预览文本
- 完整路径

如果同一个 UUID 在多个文件里同时作为活动源块存在，每个活动源位置都会显示相同的引用计数 badge。

当源块内容保存后，已有块引用和块嵌入会自动刷新到最新源内容。如果同一个 UUID 同时存在多个活动源块，插件会以“最近一次被修改的活动源块”为准，统一当前显示内容。

## 🧭 常用命令

### `((` 自动补全

输入：

```md
((
```

会打开块自动补全。

它只支持已经建立“源块”的检索，这是出于长期性能考虑。

如果你要引用的位置还没有建立“源块”，可以先用 Obsidian 自带搜索找到对应位置，再按预期的大纲结构建立源块。

Obsidian 打开命令面板快捷键：
- `Ctrl/Cmd + P`

### `Copy current block reference`

把光标放在一个大纲块上，执行这个命令。

如果当前块还没有 `id:: uuid`，插件会自动补一个，然后把 `((uuid))` 复制到剪贴板。如果当前块已经有 `id:: uuid`，插件会复用已有 ID，不会重新生成。

你也可以在编辑器里对当前大纲块点右键，使用：
- `Copy block reference`

### `Copy current block embed`

把光标放在一个大纲块上，执行这个命令。

如果当前块还没有 `id:: uuid`，插件会自动补一个，然后把 `{{embed ((uuid))}}` 复制到剪贴板。如果当前块已经有 `id:: uuid`，插件会复用已有 ID，不会重新生成。

你也可以在编辑器里对当前大纲块点右键，使用：
- `Copy block embed`

### `Rebuild block reference index`

适合这些情况：
- 你在 Obsidian 之外大量改动了 Markdown 文件
- 你看到部分引用显示成 `[missing block]`
- 你看到部分嵌入显示成 `Missing block`

### `Review missing source blocks`

适合这些情况：
- 源块已经丢失
- 但库里还有地方在引用它

审查窗口可以让你：
- 恢复到恢复页
- 确认删除
- 暂时忽略

默认恢复页：

`pages/Block Recovery.md`

## ⚙️ 属性隐藏设置

插件设置页新增了“隐藏 Logseq 风格属性行”的选项。对新安装用户默认开启，已经保存过设置的老用户会继续保留原来的开关状态。

你可以在：
- `设置 -> 第三方插件 -> Block Reference Enhancer`

里面调整这项功能。

规则说明：
- 设置框里使用 `\\` 作为多个规则之间的分隔符
- 笔记里 `hl:: value` 表示精确 key `hl`
- 笔记里 `hl-*:: value` 表示以 `hl-` 开头的前缀 key
- 在设置框里只填写 key 规则本身，例如 `collapsed\\id\\hl-*`

默认规则已包含常见属性，例如 id、collapsed、hl-*、ls-type。

这个功能只会隐藏无序列表块下方的属性键值显示，不会修改 Markdown 原文。

当这个选项开启时，在 Live Preview 里对一个非空大纲块按 `Enter`，会创建一个“第一个子块”，并且会让隐藏属性行和软换行内容继续留在父块下方。

## 📦 首次启动与索引

这个插件会维护自己的一套块索引。它不是 Obsidian 自带搜索索引的一部分。

首次启动后，可以留意状态栏里的 `Block index: ...`。

常见状态包括：
- `loading cache...`：正在读取本地缓存
- `no cache found, building full index...`：没有缓存，正在做第一次完整建索引
- `cache outdated, rebuilding full index...`：缓存来自旧解析规则或旧格式，正在自动完整重建
- `cache loaded, checking vault changes...`：缓存已加载，正在核对库内文件变化
- `reconciling X/Y files ...`：正在把变更文件和缓存重新对齐
- `ready | F files | B blocks | R refs`：启动期索引已经完成

启动后的正常增删改重命名，通常会静默增量更新，不会一直弹提示。

源块文字内容的变化，在保存后也会走静默增量更新，不需要整库重建；同时也不会在你还在当前编辑器逐字输入时，强行把全库引用做成高成本实时联动。

当插件的解析能力升级，且旧缓存已经不再可靠时，插件会在首次启动自动判定缓存过期，并做一次完整重建；这时不需要手动删除 `data.json` 或先执行 `Rebuild block reference index`。

## 🛟 安全措施：源块丢失时会怎样

如果源块丢失了，但引用还在：
- 行内引用会继续显示最后缓存的摘要
- 块嵌入会继续显示最后缓存的内容
- 插件会把它标记为 stale 状态

恢复默认是写入恢复页，而不是自动尝试插回旧文件和旧行号。这样在大库里更稳，也更容易人工检查。

## 🔎 常见排查

如果你看到 `[missing block]` 或 `Missing block`：
- 先看状态栏是否已经进入 `Block index: ready`
- 执行一次 `Rebuild block reference index`
- 检查源块是否符合预期结构
- 如果源块确实被删了，用 `Review missing source blocks` 处理

如果你在插件关闭期间，用 Logseq、同步工具、git 或外部编辑器改动了很多文件，建议手动重建一次索引。

## 📐 解析规则

这个插件会比较严格地判断什么内容算“源块”。

通常需要同时满足：
- 源行本身是一个无序列表块，例如以 `- ` 开头
- 该块的缩进行里有 `id:: uuid`

这样设计是故意的。它能让 UUID 大纲笔记在大库里更可预测，避免把一些松散 Markdown 误识别成错误的源块。

## 🆘 获取帮助

如果你遇到问题：
- 先看 [SUPPORT.md](./SUPPORT.md)
- 先搜索现有 GitHub issues
- 可稳定复现的问题请使用 `Bug report` 模板
- 新功能建议请使用 `Feature request` 模板
- 提交时尽量附上插件版本、Obsidian 版本、模式、复现步骤、控制台报错和最小 Markdown 样本

## 🧩 推荐搭配插件

### 大纲 / 层级编辑

- 🔴 `Outliner`
  功能：增强列表、大纲、缩进、移动、层级编辑体验。
  用途：让 Obsidian 更接近 Logseq / Workflowy / Roam 一类大纲软件的操作手感。
  常用点：`Ctrl + Shift + 上/下` 可以移动大纲块；Logseq 里常见的是 `Alt + Shift + 上/下`。
- 🔴 `Zoom`
  功能：聚焦到某个标题或列表层级。
  用途：在长笔记里只看某一段或某一层级，减少干扰。

### 搜索 / 导航 / 快速定位

- 🔴 `Better Search Views`
  功能：增强搜索、反链和嵌入查询结果的显示方式。
  用途：让搜索结果更像大纲面包屑，便于看上下文。
- 🔴 `Recent Files`
  功能：显示最近打开的文件。
  用途：快速回到刚才编辑或查看过的笔记。

### 图片处理与图片阅读

- 🔴 `Image Converter`
  功能：处理图片粘贴、拖入、转换格式、压缩、重命名和链接格式。
  用途：把图片粘贴后的输出统一成更通用的格式，例如：

  ```md
  ![](../assets/xxx.png)
  ```

### 视觉化 / PDF 阅读

- 🔴 `PDF++`
  功能：增强 PDF 阅读、标注、引用和链接体验。
  用途：把 PDF 资料和 Obsidian 笔记更紧密地连接起来；设置得当时也更方便和 Logseq 协同使用。
- `Excalidraw`
  功能：在 Obsidian 里画图、白板、流程图和草图。
  用途：做结构图、思维图、流程图和视觉化笔记。

### 编辑与阅读体验增强

- 🔴 `Codeblock Customizer`
  功能：美化和增强代码块显示。
  用途：让大纲里的代码块、配置块和长文本块更好读。
- 🔴 `Toggle Readable line length`
  功能：快速切换 Obsidian 的可读行宽。
  用途：在“窄行阅读”和“大屏铺开编辑”之间快速切换。
  常用点：`Ctrl + Shift + E`
- `Simplified Chinese Word Splitting`
  功能：增强中文分词。
  用途：改善中文编辑时的光标移动、选词和删除体验。

### 标签管理

- 🔴 `Tag Wrangler`
  功能：重命名、合并和整理标签。
  用途：避免标签体系变乱，适合后期维护标签结构。
  常用点：可以从标签上右键继续管理对应标签页。

## ⚠️ 已知情况

- 这个插件是 UUID 块引用与块嵌入语法增强器，不是 Logseq 替代品
- 在非常复杂的列表结构或高度定制主题下，Live Preview 仍可能有少量视觉差异
- 源块丢失时恢复策略默认写入恢复页，不会自动按原文件和原行号插回去

## 🛠 开发

```bash
npm install
npm run build
```

构建产物：
- `main.js`
- `manifest.json`
- `styles.css`

发布说明：
- GitHub Release 需要上传 `main.js`、`manifest.json`、`styles.css`
- 面向 Obsidian 社区插件发布时，tag 建议直接使用精确版本号，例如 `1.1.3`
- 每次 GitHub Release 最好补上 release notes

## 🔒 隐私说明

- 插件完全在本地 Obsidian 环境运行
- 不会通过网络发送你的笔记、UUID 或索引数据
- 不包含遥测、广告或账号门槛
- 块索引缓存保存在 Obsidian 的插件数据目录里

## 🗺 路线图

后续方向包括：
- 打磨大纲交互方式：让回车、删除键等交互更贴近专业大纲软件的使用体验
- 搜索功能：提供插件自己的块搜索视图，用真实块内容而不是原始 `((uuid))` 语法来搜索
- 在现有索引与缓存基础上继续扩展更多块工作流能力
