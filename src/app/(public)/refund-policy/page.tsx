import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_CONFIGS } from "@/lib/plans";
import {
  LegalPage,
  LegalSection,
  LegalText,
  LegalList,
  LegalTable,
  OperatorTodo,
} from "@/components/layout/LegalPage";
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/support";

export const metadata: Metadata = {
  title: "환불정책",
  description: "CREVENA 유료 요금제의 결제, 해지, 환불 처리 기준을 안내합니다.",
};

// STEP45: this page describes ONLY behavior that src/app/api/billing/**,
// src/app/api/cron/billing/route.ts and src/lib/billing/** actually
// implement — immediate full-price charge on subscribe, monthly auto-renewal
// anchored to the previous due date, cancel-at-period-end (no proration, no
// automatic refund), PRO→BASIC downgrade applied at the next cycle, and a
// refund path that exists only as an operator-executed action.
//
// Prices/credits are read from PLAN_CONFIGS so this page can never drift from
// the pricing page or the actual charge amount.
const PAID_PLANS = [PLAN_CONFIGS.BASIC, PLAN_CONFIGS.PRO];

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="환불정책"
      description="CREVENA 유료 요금제의 결제 방식과 해지·환불 처리 기준을 안내합니다. 본 정책은 이용약관의 일부를 구성합니다."
    >
      <OperatorTodo>
        본 정책은 서비스에 <b>실제로 구현되어 있는 결제·해지 동작을 기준으로</b> 작성한 운영용 초안이며, 변호사 검토를
        거친 문서가 아닙니다. 소비자 보호 관련 법령이 요구하는 청약철회 기준의 최종 확정은{" "}
        <b>[운영자 확인 필요]</b> 항목을 참고해 주세요.
      </OperatorTodo>

      <LegalSection heading="1. 유료 요금제와 결제 금액">
        <LegalTable
          headers={["요금제", "월 이용료", "월 제공 크레딧"]}
          rows={PAID_PLANS.map((plan) => [
            plan.label,
            `₩${plan.monthlyPriceKrw.toLocaleString("ko-KR")}`,
            `${plan.monthlyCreditLimit} 크레딧`,
          ])}
        />
        <LegalText>
          FREE 요금제는 무료이며 별도의 결제가 발생하지 않습니다. 모든 금액은 부가세 포함 여부와 무관하게 결제 화면에
          표시된 금액을 기준으로 합니다.
        </LegalText>
      </LegalSection>

      <LegalSection heading="2. 결제 방식">
        <LegalList
          items={[
            "유료 요금제는 월 단위 정기결제입니다. 결제수단을 등록하면 첫 달 이용료가 즉시 결제되고, 이후 매월 같은 날짜를 기준으로 자동 결제됩니다.",
            "다음 결제 예정일은 직전 결제 기준일로부터 1개월 후로 계산됩니다. 결제 처리가 지연되더라도 기준일은 밀리지 않습니다.",
            "서비스는 카드번호 등 결제수단 정보를 직접 보관하지 않으며, 정기결제에 필요한 빌링키만 보관합니다.",
            "현재 결제 기능의 운영 환경은 설정 > 결제 화면에 표시된 상태를 따릅니다.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="3. 구독 해지">
        <LegalText>
          구독 해지는 <b>설정 &gt; 결제</b> 화면에서 직접 신청할 수 있습니다. 해지는 다음과 같이 처리됩니다.
        </LegalText>
        <LegalList
          items={[
            "해지를 신청하면 다음 결제가 중단되도록 예약됩니다. 신청 즉시 서비스 이용이 중단되지 않습니다.",
            "이미 결제한 이용 기간이 끝날 때까지는 기존 유료 요금제를 그대로 이용할 수 있습니다.",
            "이용 기간이 끝나면 자동으로 FREE 요금제로 전환되며, 추가 결제는 발생하지 않습니다.",
            "이용 기간이 끝나기 전이라면 예약된 해지를 취소하고 구독을 계속 유지할 수 있습니다.",
            "해지 시 남은 기간에 대한 일할 계산(비례 환불)은 제공되지 않습니다. 이미 결제한 기간을 모두 사용하는 방식입니다.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="4. 요금제 변경">
        <LegalList
          items={[
            "상위 요금제로 변경(업그레이드)하는 경우 변경 시점에 새 요금제의 한 달 이용료가 즉시 결제되고, 다음 결제일이 그 시점부터 1개월 후로 재설정됩니다. 기존 요금제의 남은 기간에 대한 차감이나 정산은 이루어지지 않습니다.",
            "PRO에서 BASIC으로 변경(다운그레이드)하는 경우 즉시 적용되지 않고 다음 결제일에 반영됩니다. 다음 결제일까지는 PRO를 그대로 이용할 수 있으며, 다음 결제부터 BASIC 금액이 청구됩니다.",
            "유료 요금제에서 FREE로 내리는 것은 요금제 변경이 아니라 구독 해지로 처리됩니다.",
            "해지가 예약된 상태에서는 요금제 변경을 신청할 수 없습니다. 예약된 해지를 먼저 취소해 주세요.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="5. 이미 사용한 크레딧의 처리">
        <LegalList
          items={[
            "크레딧 사용량은 매월 1일(UTC 기준)에 새로운 기간으로 초기화되며, 결제 주기와는 별개로 달력 월을 기준으로 관리됩니다.",
            "해지하거나 요금제를 변경하더라도 해당 월에 이미 사용한 크레딧은 복구되거나 초기화되지 않습니다.",
            "요금제가 변경되면 변경된 요금제의 월 크레딧 한도가 적용됩니다. 따라서 상위 요금제에서 이미 많은 크레딧을 사용한 뒤 하위 요금제로 변경하면, 해당 달의 남은 크레딧이 없을 수 있습니다.",
            "이미 사용한 크레딧은 환불 대상이 아닙니다.",
            "AI 작업이 오류로 실패한 경우에 한해 해당 작업의 크레딧은 자동으로 복구됩니다. 이는 금전 환불이 아니라 크레딧 복구입니다.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="6. 결제 실패 시 처리">
        <LegalList
          items={[
            "정기결제가 실패하면 서비스는 정해진 간격(1일 후, 3일 후, 5일 후)으로 최대 3회까지 결제를 재시도합니다.",
            "재시도 기간 동안에도 회원은 기존 유료 요금제를 계속 이용할 수 있습니다.",
            "재시도가 모두 실패하면 요금제가 FREE로 전환되며, 그때까지 결제되지 않은 금액은 청구되지 않습니다.",
            "요금제가 FREE로 전환되어도 회원이 저장한 협찬 정보, 생성 콘텐츠, 업로드한 사진·영상은 삭제되지 않습니다. 다만 FREE 요금제의 저장 한도와 기능 범위가 적용됩니다.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="7. 환불 처리">
        <LegalText>
          환불은 회원이 화면에서 직접 실행할 수 없으며, 아래 문의 채널로 요청하시면 운영자가 확인 후 처리합니다.
        </LegalText>
        <LegalList
          items={[
            "환불은 실제로 결제가 완료된 건에 대해서만 가능하며, 전액 환불과 부분 환불이 모두 가능합니다.",
            "환불 금액은 해당 결제 건의 결제 금액에서 이미 환불된 금액을 뺀 범위 내에서만 처리됩니다.",
            "최초 결제 건이 전액 환불되는 경우 해당 계정의 요금제는 즉시 FREE로 전환됩니다.",
            "부분 환불이거나 정기결제 갱신 건에 대한 환불의 경우, 요금제는 자동으로 변경되지 않고 기존 이용 기간이 유지됩니다.",
            "환불 대금은 결제하신 수단으로 결제대행사를 통해 반환되며, 실제 입금까지 걸리는 기간은 카드사·금융기관의 처리 일정에 따릅니다.",
          ]}
        />
        <LegalText>
          환불 요청은{" "}
          <a href={SUPPORT_EMAIL_HREF} className="font-medium text-brand-700 underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          으로 접수해 주세요. 가입하신 이메일 주소와 결제 일시를 함께 알려주시면 확인이 빠릅니다. 결제 내역은{" "}
          <b>설정 &gt; 결제</b> 화면에서 확인하실 수 있습니다.
        </LegalText>
        <OperatorTodo>
          <b>[운영자 확인 필요]</b> 아래 항목은 현재 코드에 자동화된 기준이 없어 <b>운영 정책으로 확정해야 합니다.</b>
          <br />
          (1) 결제 후 며칠 이내에 청약철회를 받아줄 것인지(기간 기준), (2) 크레딧을 이미 사용한 경우 사용분을 어떻게
          차감하여 환불액을 산정할 것인지, (3) 단순 변심과 서비스 하자를 어떻게 구분할 것인지, (4) 환불 요청 접수 후 처리
          기한. 관련 소비자 보호 법령상 요구되는 최소 기준을 충족하는지 법률 검토가 필요합니다. 사실과 다른 기간이나
          비율을 임의로 기재하지 않았습니다.
        </OperatorTodo>
      </LegalSection>

      <LegalSection heading="8. 문의">
        <LegalText>
          결제, 해지, 환불에 관한 문의와 환불 요청은{" "}
          <a href={SUPPORT_EMAIL_HREF} className="font-medium text-brand-700 underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          으로 접수하실 수 있으며,{" "}
          <Link href="/contact" className="font-medium text-brand-700 underline underline-offset-2">
            문의하기
          </Link>{" "}
          페이지에서도 안내를 확인하실 수 있습니다. 환불은 접수 후 운영자가 직접 확인하여 처리하며, 자동으로 일할
          계산되어 환불되는 절차는 제공하지 않습니다. 서비스 이용 전반에 관한 사항은{" "}
          <Link href="/terms" className="font-medium text-brand-700 underline underline-offset-2">
            이용약관
          </Link>
          을 확인해 주세요.
        </LegalText>
      </LegalSection>
    </LegalPage>
  );
}
