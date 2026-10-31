# HTML 报告格式

架构评审渲染为会话工作区 (见 `docs/agents/environment.md`) 中单个自包含的 HTML 文件. Tailwind 和 Mermaid 都来自 CDN. Mermaid 可靠地处理图状图示; 手工搭建的 div 和内联 SVG 处理更有编辑感的视觉 (质量图, 剖面). 两者混用, 不要所有东西都靠 Mermaid, 否则会开始显得千篇一律.

## Scaffold

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>架构评审 - {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      /* 一小层自定义样式, 处理 Tailwind 不能干净覆盖的东西:
         虚线 Seam, 手绘感的箭头等. */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

仓库名, 日期, 以及一个紧凑的图例: 实线框 = module, 虚线 = seam, 红色箭头 = 泄漏, 粗黑框 = 深 module. 不写引言段落, 直接进入候选.

## Candidate card

图示承担主要分量. 文字稀疏, 平实, 并不加修饰地使用术语表中的术语 (来自 `$codebase-design` Skill).

每个候选是一个 `<article>`:

- **标题**: 简短, 点明加深的内容 (例如 "折叠 Order intake 流水线").
- **徽章行**: 推荐强度 (`Strong` = 翠绿, `Worth exploring` = 琥珀, `Speculative` = 石板灰), 外加依赖类别标签 (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **文件**: 等宽列表, `font-mono text-sm`.
- **前后对比图**: 核心. 两列并排. 见下面的模式.
- **问题**: 一句话. 哪里不对.
- **方案**: 一句话. 改变什么.
- **收益**: 要点列表, 每条不超过 6 个词. 例如 "测试只打一个 Interface", "定价逻辑不再泄漏", "删除 4 个浅层包装".
- **ADR 提示** (如适用): 琥珀色底框中的一行.

不写大段解释. 如果图示需要一整段话才能看懂, 就重画图示.

## Diagram patterns

选择适合该候选的模式. 可以混用. 不要让每张图都长得一样, 多样性本身就是意义的一部分.

### Mermaid graph (依赖 / 调用流的主力)

当重点是 "X 调用 Y 调用 Z, 看这一团乱" 时, 使用 Mermaid 的 `flowchart` 或 `graph`. 用 Tailwind 样式的卡片包起来, 避免显得突兀. 用 classDef 把泄漏的边染红, 把深 module 染黑. 时序图适合表现 "之前: 6 次往返; 之后: 1 次".

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Hand-built boxes-and-arrows (Mermaid 的布局不听使唤时)

module 用带边框和标签的 `<div>` 表示. 箭头用相对容器上绝对定位的内联 SVG `<line>` 或 `<path>` 元素. 当你想让 "之后" 的图看起来是一个粗边框的深 module, 内部细节被置灰时用它, Mermaid 无法以合适的视觉分量渲染出来.

### Cross-section (适合分层的浅)

堆叠水平条带 (`h-12 border-l-4`) 来展示一次调用穿过的层. 之前: 6 个什么都不做的薄层. 之后: 1 个厚条带, 标注合并后的职责.

### Mass diagram (适合 "Interface 与实现一样宽")

每个 module 画两个矩形, 一个代表 Interface 表面积, 一个代表实现. 之前: Interface 矩形几乎与实现矩形一样高 (浅). 之后: Interface 矩形矮, 实现矩形高 (深).

### Call-graph collapse

之前: 函数调用树渲染为嵌套框. 之后: 同一棵树折叠成一个框, 现已成为内部的调用以淡化形式显示在其中.

## Style guidance

- 偏编辑风, 不要公司仪表盘风. 留白充裕. 标题可选衬线字体 (`font-serif` 配 stone/slate 效果好).
- 克制用色: 一个强调色 (翠绿或靛蓝), 红色表示泄漏, 琥珀色表示警告.
- 图示保持约 320px 高, 使前后对比并排时舒适, 无需滚动.
- 图示内的 module 标签使用 `text-xs uppercase tracking-wider`, 让它们读起来像示意图, 不像 UI.
- 唯一的脚本是 Tailwind CDN 和 Mermaid ESM 导入. 报告其余部分是静态的, 没有应用代码, 除 Mermaid 自身渲染外没有交互.

## Top recommendation section

一张更大的卡片. 候选名称, 一句话说明原因, 指向其卡片的锚链接. 仅此而已.

## Tone

平实, 简洁, 但架构上的名词和动词直接取自 `$codebase-design` Skill. 简洁不是偏离词汇的借口.

**严格使用:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

**绝不替换:** component, service, unit (代指 module 时) · API, signature (代指 interface 时) · boundary (代指 seam 时) · layer, wrapper (想说 module 时).

**符合风格的措辞:**

- "Order intake module 很浅 (shallow), 其 interface 几乎与实现一样."
- "定价逻辑在 seam 处泄漏."
- "加深: 一个 interface, 一处测试."
- "两个 adapter 让 seam 成立: 生产用 HTTP, 测试用内存."

**收益要点** 用术语表中的词写出收益: _"locality: bug 集中在一个 module"_, _"leverage: 一个 interface, N 个调用点"_, _"interface 缩小; 实现吸收了那些包装"_. 不要写 _"更易维护"_ 或 _"代码更干净"_, 这些词不在术语表中, 配不上占这个位置.

不含糊其辞, 不铺垫, 不写 "值得注意的是...". 如果一句话可以是要点, 就让它成为要点. 如果一个要点可以删, 就删. 如果某个词不在 `$codebase-design` 术语表中, 先找一个在表中的词, 再考虑发明新词.
