# 隐藏 Logseq 属性行计划

## 目标

为 Block Reference Enhancer 新增一个“只隐藏显示、不修改 Markdown 原文”的功能，用来隐藏 Logseq 风格无序列表块下的属性键值行。

典型例子：

```md
- 这是一个块
  id:: 68a922fb-da84-41fa-aa7e-e741d66a0a6f
  collapsed:: true
```

在 Obsidian 中显示为：

```md
- 这是一个块
```

## 已落地的产品决策

1. 只隐藏无序列表块 `- ` 下方软换行属性键值行。
2. 不删除、不改写笔记文件内容。
3. 只做显示层处理，不参与块索引重建。
4. Reading Mode 和 Live Preview 两种模式都要生效。
5. 子级无序列表内容不隐藏。
6. 代码块内的 `key:: value` 不隐藏。
7. 页面级属性或非列表结构属性不隐藏。
8. 用户隐藏后，不需要额外提示这些内容原本存在。
9. 对新安装用户默认开启，已经保存过设置的老用户保留原值；用户可以在插件设置页开启、关闭或修改规则。

## 默认规则

默认隐藏规则：

```text
.lsp-*\\.v-*\\alias\\aliases\\background-color\\card-*\\col-*\\collapsed\\created-at\\deck\\direction\\doing\\done\\excalidraw-*\\file\\file-name\\file-path\\filters\\heading\\hl-*\\icon\\id\\later\\logseq.order-list-type\\ls-type\\now\\public\\query-*\\Registry\\template\\template-including-parent\\title\\todo\\type\\updated-at\\wait
```

规则说明：

1. 设置项使用 `\\` 作为规则分隔符。
2. `hl` 表示只隐藏精确 key `hl:: value`。
3. `hl-*` 表示隐藏所有以 `hl-` 开头的 key，例如 `hl-page:: value`。
4. 设置说明中必须明确展示 `hl::` 和 `hl-*::` 这两种笔记里的语法例子。

## 实现结构

### 1. 属性匹配器

文件：`src/services/LogseqPropertyMatcher.ts`

职责：

1. 解析设置字符串。
2. 区分精确匹配和前缀匹配。
3. 判断某一行是否是可隐藏属性行。
4. 在 Live Preview 文本扫描时收集需要隐藏的行号。

### 2. Live Preview 隐藏

文件：`src/editor/LogseqPropertyHidePlugin.ts`

实现方式：

1. 使用 CodeMirror `ViewPlugin`。
2. 只扫描当前文档可视范围及少量上下文行。
3. 使用 `Decoration.line()` 为命中行添加隐藏 class。
4. 设置变化、文档变化、视口变化时增量刷新。
5. 不读取全库，不触发索引重建。

### 3. Reading Mode 隐藏

主入口：`src/main.ts`

实现方式：

1. 在现有 Markdown 后处理流程里新增属性隐藏步骤。
2. 先隐藏属性行，再执行块引用与块嵌入渲染。
3. 通过源文件缓存读取当前 section 对应的 Markdown 行。
4. 只处理当前 section 中的 `li`。
5. 只隐藏命中的属性文本或属性块元素。
6. 跳过嵌套 `ul/ol`、插件自己管理的节点、badge 节点。

### 4. 设置页

文件：`src/ui/BlockReferenceEnhancerSettingTab.ts`

设置项：

1. `Hide Logseq-style property lines`
2. `Hidden property keys`
3. `Reset to defaults`

要求：

1. 设置说明必须明确写出 `\\` 是分隔符。
2. 设置说明必须明确写出 `hl::` 是精确 key 例子。
3. 设置说明必须明确写出 `hl-*::` 是前缀 key 例子。
4. 关闭开关后，所有属性行恢复显示。

## 性能原则

1. 不扫描全库。
2. 不影响索引服务性能。
3. Live Preview 只扫可视范围。
4. Reading Mode 只处理当前渲染 section。
5. 设置文本框保存采用轻微 debounce，避免每击键都强刷。

## 已知风险与控制

1. Reading Mode 的 DOM 结构受 Obsidian 渲染方式影响，复杂主题下可能仍有少量显示差异。
2. Live Preview 使用 CSS 隐藏整行，需要重点回归测试光标移动、折叠、滚动和大页面性能。
3. 若属性行中包含被插件渲染的其它语法，必须保证先隐藏属性，再做块引用渲染。

## 必测场景

1. `id::`、`collapsed::`、`hl-page::` 默认会隐藏。
2. `hl:: value` 只在规则里包含 `hl` 时隐藏。
3. `hl-*:: value` 在规则里包含 `hl-*` 时隐藏。
4. 子级列表内容不隐藏。
5. 代码块里的属性行不隐藏。
6. 非列表结构属性行不隐藏。
7. 关闭设置后全部恢复显示。
8. 大页面、折叠展开、滚动时不能明显卡顿。
9. 现有块引用、块嵌入、Back、源块 badge、右键复制命令不能被破坏。

## 本次相关文件

1. `src/services/LogseqPropertyMatcher.ts`
2. `src/editor/LogseqPropertyHidePlugin.ts`
3. `src/ui/BlockReferenceEnhancerSettingTab.ts`
4. `src/main.ts`
5. `styles.css`
6. `README.md`
7. `README.zh-CN.md`
