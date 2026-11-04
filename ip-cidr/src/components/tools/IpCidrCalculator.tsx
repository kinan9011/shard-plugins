import { useMemo, useState, type ReactNode } from "react";
import { Binary, Network, Split, SquareDashed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import { useT, type TKey } from "@/lib/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  MAX_SUBNETS,
  binaryGroups,
  binaryText,
  calculateCidr,
  checkContains,
  expandIPv6,
  formatAddress,
  formatCidr,
  formatCount,
  formatIPv4,
  ipv4MappedForms,
  isIPv4Mapped,
  mergeCidrs,
  parseRange,
  rangeToCidrs,
  reverseDnsName,
  reverseDnsZone,
  splitByCount,
  splitByPrefix,
  toHex,
  type CidrInfo,
  type ContainsResult,
} from "@/utils/ip-cidr";

const EXAMPLES: { label: TKey; value: string }[] = [
  { label: "example.private24", value: "192.168.1.10/24" },
  { label: "example.netmask", value: "172.16.5.4 255.255.240.0" },
  { label: "example.pointToPoint", value: "203.0.113.10/31" },
  { label: "example.cgnat", value: "100.64.0.0/10" },
  { label: "example.ipv6", value: "2001:db8:abcd:12::1/64" },
  { label: "example.mapped", value: "::ffff:192.0.2.1" },
  { label: "example.uniqueLocal", value: "fd00::/8" },
];

const FAQ_KEYS = ["input", "unusable", "ipv6Hosts", "ipv6Format", "privacy"] as const;

/** `id` is the stable English name that tests and `data-testid` use; `label` is the translated text. */
function ValueRow({ id, label, value, display }: { id: string; label: string; value: string; display?: ReactNode }) {
  const t = useT();
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code dir="ltr" className="min-w-0 flex-1 break-all rounded bg-muted p-2 font-mono text-sm" data-testid={`value-${id}`}>
          {display ?? value}
        </code>
        <CopyButton value={value} ariaLabel={t("copy.value", { label })} iconOnly />
      </div>
    </div>
  );
}

/** Binary digits with the network bits in the primary color and the host bits muted. */
function BinaryBits({ info, value }: { info: CidrInfo; value: bigint }) {
  const separator = info.version === 4 ? "." : ":";
  return (
    <>
      {binaryGroups(value, info.version, info.prefix).map((group, index) => (
        <span key={index}>
          {index > 0 && <span className="text-muted-foreground">{separator}</span>}
          <span className="font-semibold text-primary">{group.network}</span>
          <span className="text-muted-foreground">{group.host}</span>
        </span>
      ))}
    </>
  );
}

const CONTAINS_TEXT: Record<ContainsResult, { text: TKey; className: string }> = {
  inside: { text: "contains.inside", className: "text-success" },
  partial: { text: "contains.partial", className: "text-warning" },
  outside: { text: "contains.outside", className: "text-muted-foreground" },
};

type SplitMode = "count" | "prefix";
type ListMode = "range" | "merge";

export function IpCidrCalculator() {
  const t = useT();
  const [input, setInput] = useState(EXAMPLES[0].value);
  const [containsInput, setContainsInput] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("count");
  const [splitValue, setSplitValue] = useState("4");
  const [listMode, setListMode] = useState<ListMode>("range");
  const [listInput, setListInput] = useState("10.0.0.5 - 10.0.0.20");

  const inputText = useDebouncedValue(input);
  const containsText = useDebouncedValue(containsInput);
  const listText = useDebouncedValue(listInput);

  const result = useMemo(() => calculateCidr(inputText), [inputText, t]);
  const info = result.ok ? result.value : null;

  const contains = useMemo(() => (info && containsText.trim() ? checkContains(info, containsText) : null), [info, containsText, t]);

  const split = useMemo(() => {
    if (!info) return null;
    if (!/^\d+$/.test(splitValue.trim())) return { ok: false as const, error: t(splitMode === "count" ? "split.errorCount" : "split.errorPrefix") };
    const value = Number(splitValue);
    return splitMode === "count" ? splitByCount(info, value) : splitByPrefix(info, value);
  }, [info, splitMode, splitValue, t]);

  const list = useMemo(() => {
    if (!listText.trim()) return null;
    if (listMode === "merge") return mergeCidrs(listText);
    const range = parseRange(listText);
    return range.ok ? { cidrs: rangeToCidrs(range.value), errors: [] } : { cidrs: [], errors: [{ line: 1, text: listText.trim(), error: range.error }] };
  }, [listMode, listText, t]);

  const show = (value: bigint) => (info ? formatAddress(value, info.version) : "");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            {t("calc.title")}
          </CardTitle>
          <CardDescription>{t("calc.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ip-cidr-input">{t("calc.inputLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="ip-cidr-input"
                type="text"
                aria-invalid={!result.ok}
                spellCheck={false}
                autoComplete="off"
                placeholder="10.0.0.0/8, 2001:db8::/32, 192.168.1.10 255.255.255.0"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="min-w-48 flex-1 font-mono"
                dir="ltr"
              />
              <Select value="" onValueChange={setInput}>
                <SelectTrigger className="h-8 w-44 shrink-0" aria-label={t("calc.examples")}>
                  <SelectValue placeholder={t("calc.examples")} />
                </SelectTrigger>
                <SelectContent>
                  {EXAMPLES.map((example) => (
                    <SelectItem key={example.value} value={example.value}>
                      {t(example.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!result.ok && (
              <div className="workspace-notice rounded-md" data-tone="error" role="alert">
                {result.error}
              </div>
            )}
            {info?.hostBitsSet && (
              <p className="text-xs text-muted-foreground" role="status">
                {t("calc.hostInBlock", { address: formatAddress(info.address, info.version), block: formatCidr(info.network, info.prefix, info.version) })}
              </p>
            )}
          </div>

          {info && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm" aria-label={t("calc.addressType")}>
                <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">IPv{info.version}</span>
                <span className="rounded bg-muted px-2 py-0.5 font-medium">{info.type.label}</span>
                {info.ipv4Class && <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">{t("calc.class", { class: info.ipv4Class })}</span>}
                <span className="text-muted-foreground">{info.type.detail}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ValueRow id="CIDR block" label={t("value.cidr")} value={formatCidr(info.network, info.prefix, info.version)} />
                <ValueRow id="Network address" label={t("value.network")} value={show(info.network)} />
                {info.version === 4 && <ValueRow id="Broadcast address" label={t("value.broadcast")} value={info.broadcast === null ? "" : show(info.broadcast)} display={info.broadcast === null ? t("value.none") : undefined} />}
                {info.version === 6 && <ValueRow id="Last address" label={t("value.last")} value={show(info.last)} />}
                <ValueRow id="First usable host" label={t("value.firstHost")} value={show(info.firstHost)} />
                <ValueRow id="Last usable host" label={t("value.lastHost")} value={show(info.lastHost)} />
                <ValueRow id="Netmask" label={t("value.netmask")} value={show(info.netmask)} />
                <ValueRow id="Wildcard mask" label={t("value.wildcard")} value={show(info.wildcard)} />
                <ValueRow id="Prefix length" label={t("value.prefix")} value={`/${info.prefix}`} />
                <ValueRow id="Total addresses" label={t("value.total")} value={info.total.toString()} display={formatCount(info.total)} />
                <ValueRow id="Usable hosts" label={t("value.usable")} value={info.usable.toString()} display={formatCount(info.usable)} />
              </div>
              <p className="text-xs text-muted-foreground">{info.hostNote}</p>
            </>
          )}
        </CardContent>
      </Card>

      {info && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Binary className="h-5 w-5" />
              {t("repr.title")}
            </CardTitle>
            <CardDescription>{t("repr.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {info.version === 6 && (
                <>
                  <ValueRow id="Compressed" label={t("value.compressed")} value={formatAddress(info.address, 6)} />
                  <ValueRow id="Expanded" label={t("value.expanded")} value={expandIPv6(info.address)} />
                  {isIPv4Mapped(info.address) && <ValueRow id="Embedded IPv4" label={t("value.embedded")} value={formatIPv4(info.address & 0xffffffffn)} />}
                </>
              )}
              <ValueRow id="Decimal" label={t("value.decimal")} value={info.address.toString()} />
              <ValueRow id="Hex" label={t("value.hex")} value={toHex(info.address, info.version)} />
              {info.version === 4 && (
                <>
                  <ValueRow id="IPv4-mapped IPv6" label={t("value.mapped")} value={ipv4MappedForms(info.address).dotted} />
                  <ValueRow id="IPv4-mapped IPv6 (hex)" label={t("value.mappedHex")} value={ipv4MappedForms(info.address).hex} />
                </>
              )}
              <ValueRow id="Reverse DNS name" label={t("value.reverseName")} value={reverseDnsName(info.address, info.version)} />
              <ValueRow id="Reverse DNS zone" label={t("value.reverseZone")} value={reverseDnsZone(info.network, info.prefix, info.version)} />
              <div className="md:col-span-2">
                <ValueRow id="Binary" label={t("value.binary")} value={binaryText(info.address, info.version)} display={<BinaryBits info={info} value={info.address} />} />
              </div>
              <div className="md:col-span-2">
                <ValueRow id="Netmask binary" label={t("value.netmaskBinary")} value={binaryText(info.netmask, info.version)} display={<BinaryBits info={info} value={info.netmask} />} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {info && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SquareDashed className="h-5 w-5" />
              {t("contains.title")}
            </CardTitle>
            <CardDescription>{t("contains.description", { block: formatCidr(info.network, info.prefix, info.version) })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              type="text"
              aria-label={t("contains.label")}
              aria-invalid={contains ? !contains.ok : undefined}
              spellCheck={false}
              autoComplete="off"
              placeholder={info.version === 4 ? "10.1.2.3, 10.1.0.0/16, 10.0.0.5 - 10.0.0.20" : "2001:db8::1, 2001:db8:1::/48"}
              value={containsInput}
              onChange={(event) => setContainsInput(event.target.value)}
              className="font-mono"
              dir="ltr"
            />
            {contains &&
              (contains.ok ? (
                <p className={`text-base font-medium ${CONTAINS_TEXT[contains.value].className}`} role="status">
                  {t(CONTAINS_TEXT[contains.value].text)}
                </p>
              ) : (
                <p className="text-xs text-destructive" role="alert">
                  {contains.error}
                </p>
              ))}
          </CardContent>
        </Card>
      )}

      {info && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <Split className="h-5 w-5" />
                {t("split.title")}
              </CardTitle>
              <CardDescription>{t("split.description")}</CardDescription>
            </div>
            <div className="layout-switch" role="group" aria-label={t("split.by")}>
              <button type="button" aria-pressed={splitMode === "count"} onClick={() => setSplitMode("count")}>
                {t("split.modeCount")}
              </button>
              <button type="button" aria-pressed={splitMode === "prefix"} onClick={() => setSplitMode("prefix")}>
                {t("split.modePrefix")}
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="ip-cidr-split">{splitMode === "count" ? t("split.subnets") : t("split.prefixLength")}</Label>
              <Input
                id="ip-cidr-split"
                type="text"
                inputMode="numeric"
                aria-invalid={split ? !split.ok : undefined}
                spellCheck={false}
                autoComplete="off"
                value={splitValue}
                onChange={(event) => setSplitValue(event.target.value)}
                className="h-8 w-24 font-mono"
                dir="ltr"
              />
              {split?.ok && (
                <CopyButton value={split.value.subnets.map((subnet) => subnet.cidr).join("\n")} label={split.value.count > BigInt(MAX_SUBNETS) ? t("split.copyFirst", { max: MAX_SUBNETS }) : t("copy.all")} />
              )}
            </div>
            {split &&
              (split.ok ? (
                <>
                  <p className="text-sm text-muted-foreground" role="status">
                    {t("split.summary", {
                      count: Number(split.value.count),
                      total: formatCount(split.value.count),
                      prefix: split.value.prefix,
                      size: t("split.each", { count: Number(1n << BigInt(info.bits - split.value.prefix)), size: formatCount(1n << BigInt(info.bits - split.value.prefix)) }),
                    })}
                    {split.value.count > BigInt(MAX_SUBNETS) && ` ${t("split.limited", { max: MAX_SUBNETS })}`}
                  </p>
                  <div className="max-h-80 overflow-auto rounded-md border border-border/50">
                    <table className="w-full text-sm" aria-label={t("split.subnets")}>
                      <thead className="sticky top-0 bg-card text-start text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">{t("split.columnSubnet")}</th>
                          <th className="px-3 py-1.5 font-medium">{t("split.columnRange")}</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {split.value.subnets.map((subnet) => (
                          <tr key={subnet.cidr} className="border-t border-border/50">
                            <td dir="ltr" className="px-3 py-1 font-mono">{subnet.cidr}</td>
                            <td dir="ltr" className="break-all px-3 py-1 font-mono text-muted-foreground">
                              {show(subnet.network)} - {show(subnet.last)}
                            </td>
                            <td className="px-1">
                              <CopyButton value={subnet.cidr} ariaLabel={t("copy.value", { label: subnet.cidr })} iconOnly />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-xs text-destructive" role="alert">
                  {split.error}
                </p>
              ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t("list.title")}</CardTitle>
            <CardDescription>
              {t(listMode === "range" ? "list.descriptionRange" : "list.descriptionMerge")}
            </CardDescription>
          </div>
          <div className="layout-switch" role="group" aria-label={t("list.mode")}>
            <button type="button" aria-pressed={listMode === "range"} onClick={() => setListMode("range")}>
              {t("list.modeRange")}
            </button>
            <button type="button" aria-pressed={listMode === "merge"} onClick={() => setListMode("merge")}>
              {t("list.modeMerge")}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {listMode === "range" ? (
              <Input
                type="text"
                aria-label={t("list.rangeLabel")}
                spellCheck={false}
                autoComplete="off"
                placeholder="10.0.0.5 - 10.0.0.20"
                value={listInput}
                onChange={(event) => setListInput(event.target.value)}
                className="font-mono"
                dir="ltr"
              />
            ) : (
              <Textarea
                aria-label={t("list.mergeLabel")}
                spellCheck={false}
                autoComplete="off"
                placeholder={"10.0.0.0/24\n10.0.1.0/24\n2001:db8::/33"}
                value={listInput}
                onChange={(event) => setListInput(event.target.value)}
                className="min-h-40 font-mono"
                dir="ltr"
              />
            )}
            <div className="space-y-2">
              {list && list.cidrs.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground" role="status">
                      {t("list.blocks", { count: list.cidrs.length })}
                    </span>
                    <CopyButton value={list.cidrs.join("\n")} label={t("copy.all")} />
                  </div>
                  <ul className="max-h-64 space-y-1 overflow-auto font-mono text-sm" aria-label={t("list.blocksLabel")}>
                    {list.cidrs.map((cidr) => (
                      <li key={cidr} dir="ltr" className="rounded bg-muted px-2 py-1">
                        {cidr}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {list?.errors.map((item, index) => (
                <p key={`${index}-${item.line}-${item.text}`} className="text-xs text-destructive" role="alert">
                  {listMode === "merge" ? `${t("list.line", { line: item.line })} ` : ""}
                  {item.error}
                </p>
              ))}
              {!list && <p className="text-sm text-muted-foreground">{t(listMode === "range" ? "list.emptyRange" : "list.emptyMerge")}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <ToolFaqSection items={FAQ_KEYS.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`) }))} />
    </div>
  );
}
