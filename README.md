# Obsidian Logseq Block Enhancer

[English README](./README.en.md)

<img alt="20210606180518" src="https://github.com/user-attachments/assets/24556d2d-cca1-4913-a6b6-8e9e3418304a" />

<img alt="图片" src="https://github.com/user-attachments/assets/b69b1a35-7e31-4cf2-ae20-73ce725e7046" />

<img alt="图片" src="https://github.com/user-attachments/assets/bb31f1bf-5c23-4e5d-b3f3-014b64147b9f" />


在 Obsidian 中查看 Logseq 风格块引用与块嵌入的插件。

当前版本的定位更接近一个“查看器”：
- 普通块引用 `((uuid))` 会在 Reading Mode 和 Live Preview 中显示为行内摘要。
- 块嵌入 `{{embed ((uuid))}}` 会在 Reading Mode 和 Live Preview 中显示完整块内容与子级。
- 原始 Markdown 不会被改写。

## 当前可以做什么

- 在 Reading Mode 中查看：
  - 普通块引用 `((uuid))`
  - 块嵌入 `{{embed ((uuid))}}`
- 在 Live Preview 中查看：
  - 普通块引用 `((uuid))` 的行内摘要
  - 块嵌入 `{{embed ((uuid))}}` 的完整渲染内容
- 在编辑器中输入 `((` 使用块自动补全
- 使用命令复制当前块的 Logseq 块引用
- 自动扫描库内 Markdown 文件，建立索引并使用本地缓存

## 当前达到的效果

- 普通块引用 `((uuid))` 不再强制独占一行，而是以更适合 Obsidian 的行内方式显示
- 块嵌入 `{{embed ((uuid))}}` 会继续显示完整内容和子级，适合作为查看器使用
- Reading Mode 的显示整体可用，但长页面中如果包含较多块嵌入，滚动过程中仍可能出现页面自动继续下滑的情况
- Live Preview 已经可用，复杂列表和不同主题下仍可能有细微样式差异

## 安装与使用

适合普通用户的手动安装方式：

1. 打开你的 Obsidian 库目录
2. 进入 `.obsidian/plugins/`
3. 新建一个文件夹，名字使用插件 ID：`logseq-block-ref-enhancer`
4. 将仓库中的这三个文件复制进去：
   - `main.js`
   - `manifest.json`
   - `styles.css`
5. 回到 Obsidian，打开“设置” -> “第三方插件”
6. 打开 `Logseq Block Ref Enhancer`

启用后就可以直接查看：
- `((uuid))`
- `{{embed ((uuid))}}`

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

`Copy current block's Logseq reference`

如果当前块还没有 `id:: uuid`，插件会自动补上，再把 `((uuid))` 复制到剪贴板。

### 4. 块自动补全

在编辑器中输入：

```md
((
```

会触发块搜索和自动补全。

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

- 这个插件现在更偏向“Logseq 语法查看器”，而不是完整的 Logseq 编辑体验
- Live Preview 下，复杂列表、较长嵌入内容、不同主题样式之间，仍可能存在少量视觉差异
- Reading Mode 通常会比 Live Preview 更稳定，但在长页面中连续滚动、且页面内有较多 `{{embed ((uuid))}}` 时，仍可能触发自动滚动这一已知问题

## 路线图

后续计划会逐步支持：在 Obsidian 的某一个无序列表块上直接建立独立 UUID，用来做真正的块引用和块嵌入。

除此之外，后面还会继续补充更多与块引用、块嵌入相关的能力，但节奏和范围会按实际使用情况逐步推进。
