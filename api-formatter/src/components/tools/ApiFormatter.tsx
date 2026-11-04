import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code2 } from "lucide-react";
import { toast } from "@/shims/sonner";
import { CopyButton } from "@/components/tools/CopyButton";
import { codeDir, useT } from "@/lib/i18n";

export function ApiFormatter() {
  const t = useT();
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");

  const formatJson = () => {
    if (!input.trim()) {
      toast.error(t("toast.enterJsonFormat"));
      return;
    }

    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed, null, 2));
    } catch (error) {
      toast.error(t("toast.invalidJson"));
    }
  };

  const minifyJson = () => {
    if (!input.trim()) {
      toast.error(t("toast.enterJsonMinify"));
      return;
    }

    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed));
    } catch (error) {
      toast.error(t("toast.invalidJson"));
    }
  };

  const parseUrlEncoded = () => {
    if (!input.trim()) {
      toast.error(t("toast.enterUrlEncoded"));
      return;
    }

    try {
      const params = new URLSearchParams(input);
      const result: Record<string, string> = {};
      params.forEach((value, key) => {
        result[key] = value;
      });
      setOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      toast.error(t("toast.invalidUrlEncoded"));
    }
  };

  const parseQueryString = () => {
    if (!input.trim()) {
      toast.error(t("toast.enterQuery"));
      return;
    }

    try {
      const queryString = input.startsWith("?") ? input.slice(1) : input;
      const params = new URLSearchParams(queryString);
      const result: Record<string, string> = {};
      params.forEach((value, key) => {
        result[key] = value;
      });
      setOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      toast.error(t("toast.invalidQuery"));
    }
  };


  const clearAll = () => {
    setInput("");
    setOutput("");
  };

  const examples = {
    json: '{"name":"John","age":30,"city":"New York"}',
    urlEncoded: "name=John&age=30&city=New+York",
    queryString: "?name=John&age=30&city=New+York",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="h-5 w-5" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="format" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="format">{t("mode.format")}</TabsTrigger>
              <TabsTrigger value="minify">{t("mode.minify")}</TabsTrigger>
              <TabsTrigger value="url">{t("mode.url")}</TabsTrigger>
              <TabsTrigger value="query">{t("mode.query")}</TabsTrigger>
            </TabsList>

            <TabsContent value="format" className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  placeholder={examples.json}
                  value={input}
                  dir={codeDir(input)}
                  onChange={(e) => setInput(e.target.value)}
                  className="min-h-[150px] font-mono text-sm"
                />
                <Button onClick={formatJson}>
                  {t("action.format")}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="minify" className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  placeholder={examples.json}
                  value={input}
                  dir={codeDir(input)}
                  onChange={(e) => setInput(e.target.value)}
                  className="min-h-[150px] font-mono text-sm"
                />
                <Button onClick={minifyJson}>
                  {t("action.minify")}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  placeholder={examples.urlEncoded}
                  value={input}
                  dir={codeDir(input)}
                  onChange={(e) => setInput(e.target.value)}
                  className="min-h-[150px] font-mono text-sm"
                />
                <Button onClick={parseUrlEncoded}>
                  {t("action.url")}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="query" className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  placeholder={examples.queryString}
                  value={input}
                  dir={codeDir(input)}
                  onChange={(e) => setInput(e.target.value)}
                  className="min-h-[150px] font-mono text-sm"
                />
                <Button onClick={parseQueryString}>
                  {t("action.query")}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {output && (
            <>
              <div className="space-y-2 mt-4">
                <Textarea
                  value={output}
                  dir="ltr"
                  readOnly
                  className="min-h-[200px] font-mono text-sm"
                />
              </div>
              <div className="flex gap-2">
                <CopyButton value={output} label={t("copy.output")} />
                <Button onClick={clearAll} variant="outline">
                  {t("common.clear")}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
