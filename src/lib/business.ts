// Public business-registration details, taken from the operator's 사업자등록증
// (일반과세자, 개업일 2026-09-09). Like SUPPORT_EMAIL, these are PUBLIC
// information printed on the footer, /terms and /privacy, and must stay
// identical everywhere — which is the only reason they live in one file.
//
// Deliberately NOT here (operator decisions):
//  - 사업장 주소: the registered address is a residence, and the operator
//    chose not to publish it. NOTE for the operator: Korean e-commerce rules
//    are generally understood to require online sellers to display the
//    business address (with 상호, 대표자, 연락처, 사업자등록번호 and 통신판매업
//    신고번호). Confirm with the 구청 when filing the 통신판매업 신고 and with
//    the PG (PortOne) review whether omitting it is acceptable, or use a
//    business address you are willing to publish.
//  - 생년월일 or any other personal identifier from the certificate.
export const BUSINESS_NAME = "유별";
export const REPRESENTATIVE_NAME = "오연순";
export const BUSINESS_REG_NO = "158-57-00905";

// 통신판매업 신고번호: set this string once the 신고 is completed. While it
// is null nothing is printed (no invented or placeholder number).
export const MAIL_ORDER_REPORT_NO: string | null = null;
