import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnglesResponse, validateHooks } from "../src/lib/product-shorts/angle-validation";
import { findUnsupportedClaims, sourceTextOf } from "../src/lib/product-shorts/claim-guard";

const STYLES = ["PROBLEM", "EMPATHY", "QUESTION", "TARGET", "FEATURE", "USE_SCENE", "CONCLUSION", "PROBLEM", "FEATURE", "QUESTION"];
const hooks = (prefix = "후킹", recommendedIdx = [0, 3, 5]) =>
  STYLES.map((style, i) => ({ text: `${prefix} 문구 번호 ${i + 1}번입니다`, style, recommended: recommendedIdx.includes(i) }));

const angle = (type: string, over: Record<string, unknown> = {}) => ({
  type,
  title: `${type} 각도`,
  rationale: "상품 정보에 있는 사실에 근거한 이유입니다",
  recommended: false,
  hooks: hooks(type),
  ...over,
});

const SOURCE = "물티슈 80매\n9,900원\n두꺼운 원단";

test("angles: valid response is accepted; ids are assigned by the server, not the model", () => {
  const raw = {
    angles: [
      { ...angle("PROBLEM_SOLVING", { recommended: true }), id: "evil" },
      angle("VALUE", { recommended: true }),
      angle("FEATURE", { recommended: true }),
      angle("TARGET"),
      angle("USE_SCENE"),
    ],
  };
  const r = validateAnglesResponse(raw, SOURCE, true);
  assert.ok(r.ok);
  assert.deepEqual(r.angles.map((a) => a.id), ["a1", "a2", "a3", "a4", "a5"]);
  assert.deepEqual(r.angles[0].hooks.map((h) => h.id), ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9", "h10"]);
  assert.equal(r.angles.filter((a) => a.recommended).length, 3);
  assert.equal(r.angles[0].hooks.filter((h) => h.recommended).length, 3);
});

test("angles: fewer than 5 is fine (not padded); fewer than 2 or more than 5 is rejected", () => {
  const two = { angles: [angle("FEATURE", { recommended: true }), angle("TARGET", { recommended: true })] };
  const ok = validateAnglesResponse(two, SOURCE, true);
  assert.ok(ok.ok);
  assert.equal(ok.angles.length, 2); // 2 angles -> both recommended (min(3, n))
  assert.equal(validateAnglesResponse({ angles: [angle("FEATURE", { recommended: true })] }, SOURCE, true).ok, false);
  const six = ["PROBLEM_SOLVING", "VALUE", "FEATURE", "TARGET", "USE_SCENE", "COMPARE"].map((t, i) => angle(t, { recommended: i < 3 }));
  six.push(angle("FEATURE"));
  assert.equal(validateAnglesResponse({ angles: six }, SOURCE, true).ok, false);
});

test("angles: structural violations are rejected", () => {
  const base = () => [angle("FEATURE", { recommended: true }), angle("TARGET", { recommended: true })];
  const withFirst = (patch: Record<string, unknown>) => {
    const a = base();
    a[0] = { ...a[0], ...patch } as ReturnType<typeof angle>;
    return validateAnglesResponse({ angles: a }, SOURCE, true);
  };
  assert.equal(withFirst({ type: "MADE_UP" }).ok, false);
  assert.equal(withFirst({ title: "" }).ok, false);
  assert.equal(withFirst({ hooks: hooks().slice(0, 9) }).ok, false); // 9 hooks
  assert.equal(withFirst({ hooks: [...hooks(), ...hooks("추가")].slice(0, 11) }).ok, false); // 11 hooks
  // the same TYPE twice is fine when the angles themselves differ (real model output does this) ...
  assert.equal(validateAnglesResponse({ angles: [angle("FEATURE", { recommended: true, title: "두꺼운 원단 강조" }), angle("FEATURE", { recommended: true, title: "캡형 뚜껑 강조" })] }, SOURCE, true).ok, true);
  // ... but the same angle (same title) twice is a duplicate
  assert.equal(validateAnglesResponse({ angles: [angle("FEATURE", { recommended: true, title: "두꺼운 원단 강조" }), angle("TARGET", { recommended: true, title: "두꺼운  원단 강조" })] }, SOURCE, true).ok, false);
  assert.equal(validateAnglesResponse({ angles: [angle("FEATURE"), angle("TARGET")] }, SOURCE, true).ok, false); // nothing recommended
  assert.equal(validateAnglesResponse({ nope: 1 }, SOURCE, true).ok, false);
  assert.equal(validateAnglesResponse(null, SOURCE, true).ok, false);
});

test("angles: a price/value angle needs price evidence", () => {
  const raw = { angles: [angle("VALUE", { recommended: true }), angle("FEATURE", { recommended: true })] };
  assert.equal(validateAnglesResponse(raw, SOURCE, false).ok, false);
  assert.equal(validateAnglesResponse(raw, SOURCE, true).ok, true);
});

test("hooks: exactly 10, exactly 3 recommended, varied styles, sensible length, no duplicates", () => {
  assert.ok(validateHooks(hooks(), SOURCE).ok);
  assert.equal(validateHooks(hooks().slice(0, 9), SOURCE).ok, false);
  assert.equal(validateHooks(hooks("x", [0, 1]), SOURCE).ok, false); // 2 recommended
  assert.equal(validateHooks(hooks("x", [0, 1, 2, 3]), SOURCE).ok, false); // 4 recommended
  assert.equal(validateHooks(hooks().map((h) => ({ ...h, style: "QUESTION" })), SOURCE).ok, false); // one style only
  assert.equal(validateHooks(hooks().map((h, i) => (i === 0 ? { ...h, text: "짧음" } : h)), SOURCE).ok, false);
  assert.equal(validateHooks(hooks().map((h, i) => (i === 0 ? { ...h, text: "가".repeat(41) } : h)), SOURCE).ok, false);
  assert.equal(validateHooks(hooks().map((h, i) => (i === 1 ? { ...h, text: hooks()[0].text } : h)), SOURCE).ok, false); // duplicate
  assert.equal(validateHooks("nope", SOURCE).ok, false);
});

test("claim guard: unsupported claims are rejected, supported ones (present in the source) are allowed", () => {
  for (const bad of ["지금 사면 판매 1위 상품", "역대 최저가 도전", "품절대란 템", "판매 폭발 중", "오늘만 이 가격", "한정수량 특가", "후기 수천 개의 선택", "만족도 99%", "무조건 사야 하는"]) {
    assert.ok(findUnsupportedClaims(bad, SOURCE).length > 0, bad);
  }
  assert.deepEqual(findUnsupportedClaims("아이 있는 집에서 자주 쓰는 물티슈", SOURCE), []);
  assert.deepEqual(findUnsupportedClaims("지난 11위치 기록", SOURCE), []); // a digit before "1" is not a "1위" rank claim
  // the product's own text already says it -> the hook may quote it
  assert.deepEqual(findUnsupportedClaims("최저가 도전", `${SOURCE}\n판매자 표기: 최저가 보상제`), []);
  const rejected = validateHooks(hooks().map((h, i) => (i === 2 ? { ...h, text: "역대 최저가 물티슈를 만나보세요" } : h)), SOURCE);
  assert.equal(rejected.ok, false);
});

test("sourceTextOf joins every product text field", () => {
  const t = sourceTextOf({ productName: "A", priceText: "1원", description: "D", features: ["F"], evidence: [{ value: "E" }] });
  for (const piece of ["A", "1원", "D", "F", "E"]) assert.ok(t.includes(piece));
});
