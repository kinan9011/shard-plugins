import { formatNumber, t } from "@/lib/i18n";

const MAX_MATCHES = 10000;

export function parseXml(input: string): XMLDocument {
  if (input.length > 1000000)
    throw new Error(t("error.tooLong"));
  // A DOCTYPE or ENTITY inside a comment or CDATA section is only text.
  const markup = input.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(markup))
    throw new Error(t("error.dtd"));
  const document = new DOMParser().parseFromString(input, "application/xml");
  const error = document.querySelector("parsererror");
  if (error)
    // Browsers wrap the message in their own headings. The message is in the div.
    {
    const message = (error.querySelector("div") ?? error).textContent?.trim().slice(0, 500);
    throw new Error(message ? t("error.parse", { message }) : t("error.invalid"));
  }
  return document;
}
export function inspectXml(
  input: string | XMLDocument,
  expression: string,
  namespaces: string,
): string {
  const document = typeof input === "string" ? parseXml(input) : input;
  if (!expression.trim())
    return new XMLSerializer().serializeToString(document);
  const mapping: Record<string, string> = Object.create(null);
  for (const line of namespaces.split(/\r?\n/).filter((x) => x.trim())) {
    const equal = line.indexOf("=");
    if (equal < 1 || !line.slice(equal + 1).trim())
      throw new Error(t("error.namespaces"));
    mapping[line.slice(0, equal).trim()] = line.slice(equal + 1).trim();
  }
  let result: XPathResult;
  try {
    result = document.evaluate(
      expression,
      document,
      (prefix) =>
        // prefix is null for the default namespace; the cast only satisfies strict mode, behavior is unchanged
        mapping[prefix as string] ?? document.documentElement.lookupNamespaceURI(prefix),
      XPathResult.ANY_TYPE,
      null,
    );
  } catch (error) {
    // The browser's own message is kept, behind a translated lead-in.
    throw new Error(t("error.xpath", { message: error instanceof Error ? error.message : String(error) }));
  }
  if (result.resultType === XPathResult.STRING_TYPE) return result.stringValue;
  if (result.resultType === XPathResult.NUMBER_TYPE)
    return String(result.numberValue);
  if (result.resultType === XPathResult.BOOLEAN_TYPE)
    return String(result.booleanValue);
  const nodes: string[] = [];
  let node: Node | null;
  while ((node = result.iterateNext())) {
    if (nodes.length >= MAX_MATCHES)
      throw new Error(t("error.tooManyMatches", { max: formatNumber(MAX_MATCHES) }));
    nodes.push(
      node.nodeType === Node.ATTRIBUTE_NODE || node.nodeType === Node.TEXT_NODE
        ? (node.nodeValue ?? "")
        : new XMLSerializer().serializeToString(node),
    );
  }
  return nodes.length ? nodes.join("\n") : t("result.noMatches");
}
