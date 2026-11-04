// Strings of this tool. Keys are "<area>.<thing>"; plural families use _one/_other suffixes.
export default {
  "option.component": "包装为组件",
  "option.name": "名称",
  "pane.html": "HTML",
  "pane.jsx": "JSX",
  "copy.jsx": "复制 JSX",
  "empty.title": "JSX 将显示在此处",
  "empty.hint": "在输入区输入或粘贴 HTML。",
  "status.invalidName": "名称无效",
  "status.ready": "就绪",
  "status.lines_other": "{n} 行",
  "status.handlers_other": "{n} 个事件处理函数需要补充代码",
  "error.componentName": "组件名称必须以大写字母开头，且只能包含字母、数字、$ 或 _。",
  "faq.noRun.q": "转换时会运行或加载 HTML 吗？",
  "faq.noRun.a": "不会。HTML 会被解析到一个从不显示的独立文档中。脚本不会运行，图片和其他文件也不会加载。",
  "faq.events.q": "onclick 等事件属性会怎样处理？",
  "faq.events.a": "每个事件属性都会变成 React 属性，例如 `onClick={() => {}}`，原始代码会以注释形式保留在旁边。React 需要的是函数，所以处理函数要自己编写。",
  "faq.defaultValue.q": "为什么有些输入框会使用 defaultValue？",
  "faq.defaultValue.a": "在 React 中，`value` 和 `checked` 会让字段变成受控组件。工具改用 `defaultValue` 和 `defaultChecked`，这样字段无需状态也能正常使用。",
  "faq.whitespace.q": "空白是如何处理的？",
  "faq.whitespace.a": "源码中的缩进会被去掉，这与 JSX 的行为一致。行内元素之间的空格会保留为 `{\" \"}`。`<pre>`、`<textarea>`、`<script>` 和 `<style>` 中的文本会原样保存在模板字符串中。"
};
