import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection, LegalText, LegalList, OperatorTodo } from "@/components/layout/LegalPage";

export const metadata: Metadata = {
  title: "문의하기",
  description: "CREVENA 이용 중 궁금한 점이나 결제·환불 문의를 접수하는 방법을 안내합니다.",
};

// STEP45: an information-only page — no contact form, no backend, no new
// dependency. It deliberately does NOT print an email address: there is no
// contact address established anywhere in this repository (verified by
// grepping src/ and the env files), and inventing one would send real users'
// refund and privacy requests into a void.
export default function ContactPage() {
  return (
    <LegalPage
      title="문의하기"
      description="서비스 이용 중 궁금한 점이나 불편한 점이 있으면 알려주세요."
    >
      <OperatorTodo>
        <b>[운영자 확인 필요]</b> 고객 문의용 이메일 주소가 아직 설정되지 않았습니다. 저장소 어디에도 확정된 문의 채널이
        없어 임의의 주소를 기재하지 않았습니다. 정식 오픈 전에 문의 이메일을 개설하고 이 페이지, 이용약관,
        개인정보처리방침에 동일하게 반영해야 합니다. 환불 요청과 개인정보 열람·삭제·회원 탈퇴 요청이 모두 이 채널로
        접수되므로, 오픈 전 반드시 준비되어야 하는 항목입니다.
      </OperatorTodo>

      <LegalSection heading="먼저 확인해 보세요">
        <LegalText>
          많은 문의는 아래 페이지에서 바로 답을 찾으실 수 있습니다.
        </LegalText>
        <LegalList
          items={[
            <>
              요금제, 크레딧 제공량, 기능 차이 →{" "}
              <Link href="/pricing" className="font-medium text-brand-700 underline underline-offset-2">
                요금제 안내
              </Link>
            </>,
            <>
              결제, 구독 해지, 환불 기준 →{" "}
              <Link href="/refund-policy" className="font-medium text-brand-700 underline underline-offset-2">
                환불정책
              </Link>
            </>,
            <>
              서비스 이용 조건, AI 생성물에 대한 책임 →{" "}
              <Link href="/terms" className="font-medium text-brand-700 underline underline-offset-2">
                이용약관
              </Link>
            </>,
            <>
              개인정보 처리, 열람·삭제 요청 →{" "}
              <Link href="/privacy" className="font-medium text-brand-700 underline underline-offset-2">
                개인정보처리방침
              </Link>
            </>,
            <>
              로그인이 되지 않는 경우 →{" "}
              <Link href="/reset-password" className="font-medium text-brand-700 underline underline-offset-2">
                비밀번호 찾기
              </Link>
              {" "}또는{" "}
              <Link href="/find-id" className="font-medium text-brand-700 underline underline-offset-2">
                아이디 찾기
              </Link>
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection heading="문의하실 때 함께 알려주시면 좋아요">
        <LegalText>
          아래 정보를 함께 주시면 훨씬 빠르게 확인해 드릴 수 있습니다.
        </LegalText>
        <LegalList
          items={[
            "가입하실 때 사용한 이메일 주소",
            "문제가 발생한 화면 이름 (예: 콘텐츠 제작, 카드뉴스, 설정 > 결제)",
            "어떤 동작을 하셨을 때 무슨 일이 일어났는지",
            "화면에 표시된 안내 문구나 오류 메시지",
            "결제 관련 문의라면 결제하신 날짜와 요금제",
          ]}
        />
      </LegalSection>

      <LegalSection heading="참고">
        <LegalText>
          CREVENA는 콘텐츠 제작을 돕는 도구이며, 회원님의 SNS 계정에 콘텐츠를 대신 게시하지 않습니다. 협찬 업체와의 계약
          조건, 원고료 지급, 게시물 관련 분쟁은 서비스가 관여하지 않으므로 해당 업체에 직접 문의해 주세요.
        </LegalText>
      </LegalSection>
    </LegalPage>
  );
}
