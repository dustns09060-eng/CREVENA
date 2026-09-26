"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { createProject } from "../actions";
import { buildManualProductSource, applyUserEdit, applyUserFeaturesEdit } from "@/lib/product-shorts/product-source-helpers";
import type { ProductSource } from "@/lib/product-shorts/types";

type Stage = "choose" | "analyzing" | "form";

// STEP52 Phase 3C: two entry paths (A: 판매링크, B: 직접입력) that BOTH
// converge on the same editable form — a failed/unavailable auto-analysis
// is never a dead end, it just lands on the same empty form path B would
// have shown. No technical failure reason (429, CAPTCHA, anti-bot, ...) is
// ever surfaced to the user; every analyze-url failure gets the same
// plain-language message.
export default function NewProductShortsPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("choose");
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [autoImportFailed, setAutoImportFailed] = useState(false);
  const [naverFailed, setNaverFailed] = useState(false);
  const [source, setSource] = useState<ProductSource>(() => buildManualProductSource({ productName: "" }));
  const [featuresText, setFeaturesText] = useState("");
  // 15초가 기본값입니다: 판매 숏츠는 후킹-상품-혜택-CTA를 빠르게 보여주는
  // 짧은 포맷을 우선한다는 설계 원칙(Phase 2/3 보고서)과 맞추기 위함이며,
  // 필요하면 30초로 바로 바꿀 수 있습니다.
  const [duration, setDuration] = useState<15 | 30>(15);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function isValidHttpUrl(value: string) {
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function handleAnalyze() {
    setUrlError(null);
    if (!isValidHttpUrl(urlInput)) {
      setUrlError("올바른 URL 형식이 아니에요.");
      return;
    }
    setStage("analyzing");
    setAutoImportFailed(false);
    setNaverFailed(false);

    try {
      const res = await fetch("/api/product-shorts/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput }),
      });
      const data = await res.json().catch(() => null);

      if (data?.ok && data.productSource) {
        setSource(data.productSource as ProductSource);
        setFeaturesText(((data.productSource as ProductSource).features ?? []).join("\n"));
        setStage("form");
        return;
      }

      // Any failure code (blocked/timeout/too large/unsupported/parse
      // failure/etc.) -> same generic message, same fallback: continue with
      // an empty manual-entry form, never a dead end.
      setAutoImportFailed(true);
      setNaverFailed(typeof data?.code === "string" && data.code.startsWith("NAVER_"));
      setSource(buildManualProductSource({ productName: "", sourceUrl: urlInput }));
      setFeaturesText("");
      setStage("form");
    } catch {
      setAutoImportFailed(true);
      setSource(buildManualProductSource({ productName: "", sourceUrl: urlInput }));
      setStage("form");
    }
  }

  function startManualEntry() {
    setAutoImportFailed(false);
    setNaverFailed(false);
    setSource(buildManualProductSource({ productName: "" }));
    setFeaturesText("");
    setStage("form");
  }

  function updateField(field: "productName" | "priceText" | "description", value: string) {
    setSource((prev) => applyUserEdit(prev, field, value));
  }

  function updateFeatures(value: string) {
    setFeaturesText(value);
    const list = value.split("\n");
    setSource((prev) => applyUserFeaturesEdit(prev, list));
  }

  async function handleSubmit() {
    if (!source.productName.trim()) {
      setSubmitError("상품명을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await createProject({ targetDurationSeconds: duration, productSource: source });
    setSubmitting(false);
    if ("error" in result) {
      setSubmitError(result.error);
      return;
    }
    router.push(`/product-shorts/${result.id}`);
  }

  return (
    <div>
      <PageHeader title="새 프로젝트" description="판매 링크를 입력하거나, 상품 정보를 직접 입력해서 시작하세요." />

      {stage === "choose" && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="text-sm font-semibold text-zinc-900">판매 링크로 시작하기</h2>
            <p className="mt-1 text-xs text-zinc-500">상품 페이지 링크를 넣으면 정보를 자동으로 불러와볼게요.</p>
            <input
              type="text"
              placeholder="https://..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="mt-3 min-h-[44px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            {urlError && <p className="mt-1 text-xs text-red-600">{urlError}</p>}
            <Button className="mt-3 w-full" onClick={handleAnalyze}>
              상품 분석하기
            </Button>
          </Card>
          <Card>
            <h2 className="text-sm font-semibold text-zinc-900">상품 정보 직접 입력하기</h2>
            <p className="mt-1 text-xs text-zinc-500">상품명과 사진만 있어도 바로 시작할 수 있어요.</p>
            <Button variant="secondary" className="mt-3 w-full" onClick={startManualEntry}>
              직접 입력해서 시작
            </Button>
          </Card>
        </div>
      )}

      {stage === "analyzing" && (
        <Card className="mt-6">
          <p className="text-sm text-zinc-500">상품 정보를 불러오는 중...</p>
        </Card>
      )}

      {stage === "form" && (
        <Card className="mt-6">
          {autoImportFailed && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
              {naverFailed ? "네이버 상품 정보를 자동으로 불러오지 못했어요." : "상품 정보를 자동으로 불러오지 못했어요."} 직접 입력해서 계속할 수 있어요.
            </p>
          )}
          {source.evidence.some((e) => e.source === "NAVER_COMMERCE") && (
            <p className="mb-4 rounded-lg bg-zinc-50 px-3 py-3 text-xs text-zinc-600">
              네이버 스토어에서 상품 정보를 불러왔어요. 내용은 자유롭게 수정할 수 있어요.
              <br />
              상품 사진 자동 불러오기는 준비 중이에요. 현재는 사용할 사진을 직접 올려주세요.
            </p>
          )}

          <div className="flex flex-col gap-3">
            <label className="text-xs font-medium text-zinc-600">
              상품명 <span className="text-red-500">*</span>
              <input
                type="text"
                value={source.productName}
                onChange={(e) => updateField("productName", e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              가격
              <input
                type="text"
                value={source.priceText ?? ""}
                onChange={(e) => updateField("priceText", e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              상품 설명
              <textarea
                value={source.description ?? ""}
                onChange={(e) => updateField("description", e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <label className="text-xs font-medium text-zinc-600">
              상품 특징 (한 줄에 하나씩)
              <textarea
                value={featuresText}
                onChange={(e) => updateFeatures(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </label>

            <div>
              <p className="text-xs font-medium text-zinc-600">영상 길이</p>
              <div className="mt-1 flex gap-2">
                {([15, 30] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      duration === d ? "border-brand-500 bg-brand-50 text-brand-700" : "border-zinc-300 text-zinc-600"
                    }`}
                  >
                    {d}초
                  </button>
                ))}
              </div>
            </div>

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <Button loading={submitting} loadingText="만드는 중..." onClick={handleSubmit}>
              프로젝트 만들기
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
