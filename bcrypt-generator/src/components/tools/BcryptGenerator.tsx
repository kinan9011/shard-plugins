import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Lock, ShieldCheck, ShieldX, Loader2 } from "lucide-react";
import { toast } from "@/shims/sonner";
import { useT, type TKey } from "@/lib/i18n";
import { CopyButton } from "@/components/tools/CopyButton";
import { ToolFaqSection } from "@/components/tools/ToolFaq";
import {
  hashBcrypt,
  verifyBcrypt,
  isValidBcryptHash,
  extractRoundsFromHash,
  BCRYPT_MIN_ROUNDS,
  BCRYPT_MAX_ROUNDS,
  BCRYPT_DEFAULT_ROUNDS,
} from "@/utils/bcrypt";

const getRoundLabel = (r: number): { label: TKey; color: string } => {
  if (r <= 6) return { label: "rounds.veryFast", color: "text-destructive" };
  if (r <= 9) return { label: "rounds.fast", color: "text-warning" };
  if (r <= 12) return { label: "rounds.balanced", color: "text-success" };
  return { label: "rounds.slow", color: "text-info" };
};

const FAQ_KEYS = ["what", "rounds", "secure", "production"] as const;

export function BcryptGenerator() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"hash" | "verify">("hash");

  // Hash tab state
  const [plainText, setPlainText] = useState("");
  const [rounds, setRounds] = useState(BCRYPT_DEFAULT_ROUNDS);
  const [hashOutput, setHashOutput] = useState("");
  const [hashing, setHashing] = useState(false);

  // Verify tab state
  const [verifyPlainText, setVerifyPlainText] = useState("");
  const [verifyHash, setVerifyHash] = useState("");
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [detectedRounds, setDetectedRounds] = useState<number | null>(null);

  const handleHash = async () => {
    setHashing(true);
    setHashOutput("");
    try {
      const result = await hashBcrypt(plainText, rounds);
      setHashOutput(result);
    } catch (err) {
      toast.error((err as Error).message || t("toast.hashFailed"));
    } finally {
      setHashing(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const detected = extractRoundsFromHash(verifyHash);
      setDetectedRounds(detected);
      const match = await verifyBcrypt(verifyPlainText, verifyHash);
      setVerifyResult(match);
    } catch (err) {
      toast.error((err as Error).message || t("toast.verifyFailed"));
      setVerifyResult(null);
    } finally {
      setVerifying(false);
    }
  };


  const roundInfo = getRoundLabel(rounds);
  const faqItems = FAQ_KEYS.map((slug) => ({ q: t(`faq.${slug}.q`), a: t(`faq.${slug}.a`) }));

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "hash" | "verify")} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="hash">
            <Lock className="w-4 h-4 me-2" />
            {t("tab.hash")}
          </TabsTrigger>
          <TabsTrigger value="verify">
            <ShieldCheck className="w-4 h-4 me-2" />
            {t("tab.verify")}
          </TabsTrigger>
        </TabsList>

        {/* Hash Tab */}
        <TabsContent value="hash" className="space-y-5 mt-5">
          {/* Plain text input */}
          <div className="space-y-2">
            <Label>{t("field.plain")}</Label>
            <Input
              type="password"
              value={plainText}
              onChange={(e) => setPlainText(e.target.value)}
              placeholder={t("hash.placeholder")}
              onKeyDown={(e) => e.key === "Enter" && !hashing && handleHash()}
            />
          </div>

          {/* Rounds selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("rounds.label", { rounds })}</Label>
              <span className={`text-xs font-medium ${roundInfo.color}`}>{t(roundInfo.label)}</span>
            </div>
            <input
              type="range"
              min={BCRYPT_MIN_ROUNDS}
              max={BCRYPT_MAX_ROUNDS}
              value={rounds}
              onChange={(e) => setRounds(parseInt(e.target.value, 10))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t("rounds.fastest", { rounds: BCRYPT_MIN_ROUNDS })}</span>
              <span>{t("rounds.slowest", { rounds: BCRYPT_MAX_ROUNDS })}</span>
            </div>
          </div>

          {/* Info box */}
          <div className="text-xs text-muted-foreground bg-muted rounded-md p-3 leading-relaxed">
            {t("hash.info")}
          </div>

          {/* Hash button */}
          <Button onClick={handleHash} disabled={hashing || !plainText} className="gap-2">
            {hashing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("status.hashing", { rounds })}
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                {t("action.generate")}
              </>
            )}
          </Button>

          {/* Output */}
          {hashOutput && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("field.hash")}</Label>
                <CopyButton value={hashOutput} label={t("common.copy")} />
              </div>
              <textarea
                value={hashOutput}
                readOnly
                dir="ltr"
                className="w-full h-20 p-3 rounded-md border bg-muted font-mono text-sm resize-none focus:outline-none"
              />
            </div>
          )}
        </TabsContent>

        {/* Verify Tab */}
        <TabsContent value="verify" className="space-y-5 mt-5">
          {/* Plain text */}
          <div className="space-y-2">
            <Label>{t("field.plain")}</Label>
            <Input
              type="password"
              value={verifyPlainText}
              onChange={(e) => { setVerifyPlainText(e.target.value); setVerifyResult(null); }}
              placeholder={t("verify.placeholder.plain")}
            />
          </div>

          {/* Bcrypt hash */}
          <div className="space-y-2">
            <Label>{t("field.hash")}</Label>
            <textarea
              value={verifyHash}
              onChange={(e) => { setVerifyHash(e.target.value.trim()); setVerifyResult(null); setDetectedRounds(null); }}
              placeholder={t("verify.placeholder.hash")}
              dir={verifyHash ? "ltr" : undefined}
              className="w-full h-20 p-3 rounded-md border bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            />
            {verifyHash && !isValidBcryptHash(verifyHash) && (
              <p className="text-xs text-destructive">
                {t("verify.invalidHint")}
              </p>
            )}
          </div>

          {/* Verify button */}
          <Button
            onClick={handleVerify}
            disabled={verifying || !verifyPlainText || !verifyHash}
            className="gap-2"
          >
            {verifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("status.verifying")}
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                {t("action.verify")}
              </>
            )}
          </Button>

          {/* Verification result */}
          {verifyResult !== null && (
            <div
              className={`flex items-center gap-3 p-4 rounded-md border ${
                verifyResult
                  ? "bg-success/10 border-success/30 text-success"
                  : "bg-destructive/10 border-destructive/30 text-destructive"
              }`}
            >
              {verifyResult ? (
                <ShieldCheck className="w-6 h-6 shrink-0" />
              ) : (
                <ShieldX className="w-6 h-6 shrink-0" />
              )}
              <div>
                <p className="font-semibold text-sm">
                  {verifyResult ? t("result.match") : t("result.noMatch")}
                </p>
                {detectedRounds !== null && (
                  <p className="text-xs mt-0.5 opacity-75">
                    {t("result.rounds", { count: detectedRounds })}
                  </p>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ToolFaqSection items={faqItems} />
    </div>
  );
}
