// Strings of this tool. Keys are "<area>.<thing>"; plural families use _one/_other suffixes.
export default {
  "option.component": "コンポーネントで囲む",
  "option.name": "名前",
  "pane.html": "HTML",
  "pane.jsx": "JSX",
  "copy.jsx": "JSX をコピー",
  "empty.title": "JSX がここに表示されます",
  "empty.hint": "入力欄に HTML を入力または貼り付けてください。",
  "status.invalidName": "無効な名前",
  "status.ready": "準備完了",
  "status.lines_other": "{n} 行",
  "status.handlers_other": "{n} 個のイベントハンドラーにコードが必要です",
  "error.componentName": "コンポーネント名は大文字で始め、英字、数字、$、_ のみを使用してください。",
  "faq.noRun.q": "変換中に HTML は実行または読み込まれますか？",
  "faq.noRun.a": "いいえ。HTML は、表示されない別のドキュメントに解析されます。スクリプトは実行されず、画像などのファイルも読み込まれません。",
  "faq.events.q": "onclick などのイベント属性はどうなりますか？",
  "faq.events.a": "それぞれ `onClick={() => {}}` のような React の prop になり、元のコードはその横にコメントとして残ります。React には関数が必要なので、ハンドラーは自分で書いてください。",
  "faq.defaultValue.q": "一部の input に defaultValue が付くのはなぜですか？",
  "faq.defaultValue.a": "React では、`value` と `checked` を指定するとフィールドが制御コンポーネントになります。ツールは `defaultValue` と `defaultChecked` を使うので、state がなくてもフィールドは動作します。",
  "faq.whitespace.q": "空白はどのように扱われますか？",
  "faq.whitespace.a": "JSX と同様に、ソースのインデントは取り除かれます。インライン要素の間のスペースは `{\" \"}` として残ります。`<pre>`、`<textarea>`、`<script>`、`<style>` 内のテキストは、テンプレートリテラルの中でそのまま保持されます。"
};
