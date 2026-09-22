import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalPage,
  LegalSection,
  LegalText,
  LegalList,
  LegalTable,
  OperatorTodo,
} from "@/components/layout/LegalPage";
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from "@/lib/support";
import { PRIVACY_VERSION } from "@/lib/legal-docs";
import { BUSINESS_NAME, BUSINESS_REG_NO, REPRESENTATIVE_NAME } from "@/lib/business";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "CREVENA가 수집·이용하는 개인정보와 처리 방식을 안내합니다.",
};

// STEP45: every item below was verified against the actual code before being
// written — the auth flow (email+password only, no social login, no name or
// phone collected at signup), the migration files for what each table really
// stores, the Storage buckets, src/lib/ai/* for what is actually sent to
// Anthropic, and src/app/api/billing/* for what payment data is really held
// (a billing key only — never card numbers).
//
// Nothing here is boilerplate-filled: there is deliberately NO invented
// retention period and NO invented business/contact information, because the
// repository does not establish either. Those are marked [운영자 확인 필요].
export default function PrivacyPage() {
  return (
    <LegalPage
      title="개인정보처리방침"
      description="CREVENA(이하 “서비스”)는 이용자의 개인정보를 소중히 다루며, 어떤 정보를 어떤 목적으로 처리하는지 투명하게 안내합니다."
    >
      <LegalText>문서 버전: {PRIVACY_VERSION}</LegalText>

      <OperatorTodo>
        본 방침은 서비스의 <b>실제 코드 동작을 확인하여 작성한 운영용 초안</b>이며, 변호사 검토를 거친 문서가 아닙니다.
        아래 <b>[운영자 확인 필요]</b> 표시 항목(보유 기간, 개인정보 보호책임자, 국외 이전 국가·일시)은 정식
        오픈 전에 반드시 확정하여 기재해야 합니다.
      </OperatorTodo>

      <LegalSection heading="1. 수집하는 개인정보 항목">
        <LegalText>
          서비스는 회원가입 시 <b>이메일 주소와 비밀번호, 필수 동의 기록만</b> 수집합니다. 이름, 생년월일, 성별,
          휴대전화번호는 수집하지 않으며, 소셜 로그인(카카오·네이버·구글 등)은 사용하지 않습니다. 그 밖의 정보는 회원이 서비스를 이용하는 과정에서
          직접 입력하거나 자동으로 생성됩니다.
        </LegalText>
        <LegalTable
          headers={["구분", "항목", "수집 시점"]}
          rows={[
            ["계정 정보", "이메일 주소, 비밀번호(암호화되어 저장)", "회원가입 시"],
            [
              "가입 동의 기록",
              "만 14세 이상 확인, 이용약관·개인정보처리방침 동의 여부, 각 문서의 버전, 동의 일시",
              "회원가입 시",
            ],
            [
              "협찬 정보",
              "업체명, 제품명, 캠페인명, 협찬 사이트 주소, 담당자 이름·연락처, 제품가·원고료, 일정, 업체 가이드 원문, 메모",
              "회원이 협찬을 등록할 때 직접 입력",
            ],
            [
              "후기 정보",
              "회원이 직접 작성한 실제 사용 경험, 사용 장소·상황 등 후기 메모",
              "회원이 콘텐츠 제작 과정에서 직접 입력",
            ],
            [
              "업로드 파일",
              "사진·영상 파일, 파일명, 파일 크기·해상도·재생시간",
              "회원이 사진·영상을 업로드할 때",
            ],
            [
              "생성 콘텐츠",
              "AI가 생성한 콘텐츠 본문, 사진에 대한 AI 분석 결과, 영상 프레임 분석 결과, 생성 시 사용된 입력값",
              "회원이 AI 기능을 실행할 때 자동 생성",
            ],
            ["글쓰기 스타일", "회원이 등록한 본인의 과거 글 샘플", "회원이 설정에서 직접 등록"],
            [
              "결제 정보",
              "정기결제용 빌링키, 결제 일시·금액·요금제·결제 상태, 결제대행사가 회신한 결제 결과",
              "유료 요금제 결제 시",
            ],
            [
              "이용 기록",
              "AI 기능 사용 이력(기능명·모델명·사용 크레딧·성공 여부), 최종 로그인 일시",
              "서비스 이용 시 자동 생성",
            ],
          ]}
        />
        <LegalText>
          <b>결제수단 정보는 서비스가 직접 보관하지 않습니다.</b> 카드번호, 유효기간, CVC 등은 결제대행사의 화면에서
          입력되어 결제대행사가 처리하며, 서비스는 정기결제에 필요한 <b>빌링키</b>만 저장합니다. 정기결제가 종료되면(해지 후
          이용 기간 만료, 결제 재시도 실패 후 전환, 최초 결제 전액 환불, 회원탈퇴) 빌링키는 결제대행사에서 삭제하며, 삭제에
          실패한 경우 다시 시도합니다. 회원탈퇴는 빌링키 삭제가 확인된 경우에만 진행됩니다.
        </LegalText>
        <LegalText>
          또한 서비스는 <b>광고·분석용 추적 도구를 일절 사용하지 않습니다.</b> Google Analytics, 광고 픽셀, 세션 리플레이
          등 제3자 분석 도구가 설치되어 있지 않습니다.
        </LegalText>
      </LegalSection>

      <LegalSection heading="2. 개인정보의 이용 목적">
        <LegalList
          items={[
            "회원 식별 및 로그인, 계정 관리, 비밀번호 재설정",
            "만 14세 이상 확인 및 약관·개인정보처리방침 동의 사실의 기록",
            "협찬 관리, 콘텐츠 생성·저장·조회 등 서비스 핵심 기능 제공",
            "AI 콘텐츠 생성 및 사진·영상 분석 기능 제공",
            "요금제별 크레딧 및 저장 한도 관리, 비정상적인 과다 호출 방지",
            "유료 요금제 결제, 정기결제 갱신, 결제 내역 확인 및 환불 처리",
            "서비스 관련 필수 안내(이메일 인증 메일 발송, 서비스 내 결제 상태 안내 등)",
            "오류 원인 분석 및 서비스 품질 개선",
          ]}
        />
        <LegalText>
          회원이 입력한 협찬 정보·후기·사진은 <b>해당 회원의 콘텐츠를 생성하기 위한 목적으로만</b> 사용되며, 회원의 명시적
          동의 없이 마케팅·홍보 목적으로 사용하거나 제3자에게 판매하지 않습니다.
        </LegalText>
      </LegalSection>

      <LegalSection heading="3. 개인정보 처리의 위탁 및 국외 이전">
        <LegalText>
          서비스는 안정적인 운영을 위해 아래 사업자에게 개인정보 처리 업무를 위탁하고 있습니다. 아래 목록은 실제로 데이터가
          전달되는 사업자만 기재한 것입니다.
        </LegalText>
        <LegalTable
          headers={["수탁 업체", "위탁 업무", "이전되는 항목"]}
          rows={[
            [
              "Supabase",
              "데이터베이스, 회원 인증, 파일(사진·영상) 저장",
              "계정 정보, 협찬·후기 정보, 업로드 파일, 생성 콘텐츠, 결제 이력",
            ],
            [
              "Anthropic (Claude API)",
              "AI 콘텐츠 생성 및 사진·영상 프레임 분석",
              "협찬 가이드 내용, 후기 메모, 글쓰기 스타일 샘플, 분석 대상 사진 이미지 및 영상 추출 프레임",
            ],
            [
              "포트원(PortOne) 및 연동 결제사",
              "결제수단 등록, 결제 승인, 정기결제, 환불 처리",
              "회원 식별자, 결제 금액·주문명, 결제수단 정보(결제사가 직접 수집)",
            ],
            ["Vercel", "서비스 호스팅 및 서버 운영 기록", "서비스 접속 처리 과정에서 발생하는 서버 로그"],
          ]}
        />
        <LegalText>
          <b>Anthropic에 전달되는 정보</b>: AI 기능 실행 시 회원이 입력한 가이드·후기 텍스트와 분석 대상 <b>사진
          이미지</b>가 전달됩니다. 전달되는 사진은 회원의 브라우저에서 <b>리사이즈·재인코딩된 JPEG 이미지</b>로, 서비스에
          업로드되어 저장된 파일과 같은 이미지입니다. 영상의 경우 <b>원본 영상은 전달되지 않고</b>, 회원의 브라우저에서
          추출한 최대 3장의 대표 프레임 이미지만 전달됩니다.
        </LegalText>
        <LegalText>
          위 수탁 업체는 해외에 서버를 두고 있어 개인정보가 국외로 이전될 수 있습니다. 이전되는 항목과 목적은 위 표와
          같으며, 이전 방식은 서비스 이용 시 네트워크를 통한 전송입니다.
        </LegalText>
        <OperatorTodo>
          <b>[운영자 확인 필요]</b> 국외 이전 고지에 필요한 <b>이전받는 국가, 이전 일시 및 방법, 수탁자의 연락처(개인정보
          보호책임자)</b>는 각 사업자의 실제 계약·리전 설정에 따라 달라집니다. Supabase 프로젝트의 리전, 결제대행사 계약
          주체를 확인하여 정확히 기재해야 합니다. 저장소에서 확인할 수 없는 값이라 임의로 기재하지 않았습니다.
        </OperatorTodo>
      </LegalSection>

      <LegalSection heading="4. 개인정보의 보유 및 파기">
        <LegalText>
          회원이 서비스 내에서 삭제한 사진·영상·글쓰기 스타일 등은 삭제 요청 즉시 저장소와 데이터베이스에서 제거됩니다.
        </LegalText>
        <LegalText>
          회원 탈퇴는 [설정] 화면의 회원탈퇴 기능으로 직접 실행할 수 있습니다. 탈퇴를 실행하면 현재 구현 기준으로 다음이
          삭제됩니다.
        </LegalText>
        <LegalList
          items={[
            "업로드한 사진·영상 파일, 사진 보정본 및 썸네일 파일(저장소에서 직접 삭제)",
            "로그인 계정 정보",
            "계정에 연결된 협찬 정보, 협찬 가이드, 생성 콘텐츠, 일정, 글쓰기 스타일, 사진 보정 프리셋",
            "AI 이용 기록 및 크레딧 사용량 기록",
          ]}
        />
        <LegalText>
          다만 <b>결제 시도·환불 기록은 탈퇴 후에도 보관됩니다.</b> 거래·회계 기록의 정합성을 유지하고 관계 법령에 따른
          보존에 대비하기 위한 것으로, 탈퇴 시점에 해당 기록과 회원 계정을 잇는 <b>회원 연결 정보는 제거</b>되어 더 이상
          특정 회원 계정과 연결되지 않는 상태로 남습니다. 보관되는 항목은 결제 일시, 금액, 요금제, 결제·환불 상태,
          결제대행사 거래 식별자이며, 일부 결제 건에는 결제대행사가 회신한 결제 응답 정보가 함께 저장되어 있고 이 정보에는
          결제 식별을 위한 값이 포함될 수 있습니다. 이메일·이름 등 회원 정보는 결제 기록으로 옮겨 저장하지 않습니다.
        </LegalText>
        <LegalText>
          회원가입 시 남기는 <b>동의 기록</b>(동의 항목, 문서 버전, 동의 일시)은 동의 사실을 확인하기 위한 것으로, 탈퇴 시
          회원 연결 정보가 제거된 상태로 보관될 수 있습니다. 이 기록에는 이메일·이름 등 회원을 알아볼 수 있는 정보가
          포함되지 않습니다.
        </LegalText>
        <OperatorTodo>
          <b>[운영자 확인 필요]</b> 결제·환불 기록의 <b>구체적인 보유 기간은 아직 정해지지 않았습니다.</b> 현재 구현은 기간
          제한 없이 보존하며, 기간이 지난 기록을 자동으로 파기하는 로직은 없습니다. 전자상거래 등에서의 소비자보호에 관한
          법률 등 관련 법령이 거래·결제 기록의 일정 기간 보존을 요구할 수 있으므로, 정식 오픈 전에 (1) 적용되는 법령과
          항목별 법정 보존 기간, (2) 보존 기간이 끝난 기록의 파기 절차를 법률 검토를 거쳐 확정하고 이 항목과 실제 구현에
          함께 반영해야 합니다. 사실과 다른 보유 기간이나 근거 법령 조항을 임의로 적지 않았습니다.
        </OperatorTodo>
      </LegalSection>

      <LegalSection heading="5. 이용자의 권리와 행사 방법">
        <LegalList
          items={[
            "회원은 언제든지 서비스에 로그인하여 본인이 등록한 협찬 정보, 후기, 사진·영상, 생성 콘텐츠를 조회·수정·삭제할 수 있습니다.",
            "비밀번호는 비밀번호 재설정 기능을 통해 변경할 수 있습니다.",
            "회원은 개인정보의 열람, 정정, 삭제, 처리정지를 요구할 수 있으며, 요청은 아래 문의 채널을 통해 접수합니다.",
            "회원 탈퇴는 [설정] 화면의 회원탈퇴 기능으로 직접 하실 수 있습니다. 유료 요금제 이용 중에는 [설정 > 결제]에서 구독을 해지한 뒤 탈퇴가 가능합니다.",
          ]}
        />
        <LegalText>
          권리 행사 요청은{" "}
          <Link href="/contact" className="font-medium text-brand-700 underline underline-offset-2">
            문의하기
          </Link>{" "}
          페이지를 통해 접수하실 수 있습니다.
        </LegalText>
      </LegalSection>

      <LegalSection heading="6. 개인정보의 안전성 확보 조치">
        <LegalList
          items={[
            "비밀번호는 복호화가 불가능한 방식으로 암호화되어 저장되며, 서비스 운영자도 회원의 비밀번호를 알 수 없습니다.",
            "회원이 업로드한 사진·영상은 비공개 저장소에 보관되며, 본인만 접근할 수 있도록 데이터베이스 수준의 접근 제어(Row Level Security)가 적용되어 있습니다.",
            "사진·영상 조회 시에는 발급 후 1시간 동안만 유효한 임시 접근 링크가 사용됩니다.",
            "정기결제용 빌링키는 일반 조회 권한에서 제외되어 있어 회원 본인을 포함한 일반 이용자에게 노출되지 않습니다.",
            "AI 기능 사용 이력에는 기능명과 사용량 등 메타 정보만 기록되며, 프롬프트 원문이나 생성된 콘텐츠 본문은 기록하지 않습니다.",
            "모든 통신은 암호화된 연결(HTTPS)을 통해 이루어집니다.",
          ]}
        />
      </LegalSection>

      <LegalSection heading="7. 만 14세 미만 아동의 개인정보">
        <LegalText>
          서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 만 14세 미만 아동의 회원가입을 받지 않습니다. 회원가입 시
          이용자가 직접 만 14세 이상임을 확인하도록 하고 있으며, 별도의 연령 인증이나 생년월일 수집은 하지 않습니다. 만
          14세 미만 아동의 개인정보가 수집된 사실을 알게 된 경우 지체 없이 해당 정보를 파기합니다.
        </LegalText>
      </LegalSection>

      <LegalSection heading="8. 개인정보 보호책임자 및 문의">
        <LegalText>
          개인정보 처리에 관한 문의, 불만 처리, 피해 구제에 관한 사항은{" "}
          <a href={SUPPORT_EMAIL_HREF} className="font-medium text-brand-700 underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>
          으로 접수하실 수 있습니다.
        </LegalText>
        <LegalText>
          개인정보를 처리하는 사업자: {BUSINESS_NAME} (대표자 {REPRESENTATIVE_NAME}, 사업자등록번호 {BUSINESS_REG_NO})
        </LegalText>
        <OperatorTodo>
          <b>[운영자 확인 필요]</b> <b>개인정보 보호책임자의 성명·직책</b>은 담당자 지정 후 기재해야 합니다. 저장소 내에
          확정된 값이 없어 임의의 이름을 기재하지 않았습니다. (문의 이메일은 확정되어 위에 기재했습니다.)
        </OperatorTodo>
      </LegalSection>

      <LegalSection heading="9. 방침의 변경">
        <LegalText>
          본 방침의 내용이 추가·삭제·변경되는 경우 변경 사항의 시행 이전에 서비스 내 공지를 통해 안내합니다. 이용자에게
          불리한 변경의 경우에는 보다 충분한 기간을 두고 안내합니다.
        </LegalText>
        <OperatorTodo>
          <b>[운영자 확인 필요]</b> 본 방침의 <b>공고일자 및 시행일자</b>를 기재해야 합니다.
        </OperatorTodo>
      </LegalSection>
    </LegalPage>
  );
}
