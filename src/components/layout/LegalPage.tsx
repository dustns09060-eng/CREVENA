import type { ReactNode } from "react";

// STEP45: shared typography/layout for the four public policy & info pages
// (/terms, /privacy, /refund-policy, /contact). The project has no
// @tailwindcss/typography plugin and STEP45 targets zero new dependencies,
// so these few small components stand in for `prose` — and they keep Korean
// readability rules in one place: generous line-height, restrained heading
// sizes on mobile, and no wall-of-bold.

export function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-2xl font-bold text-zinc-900 sm:text-3xl">{title}</h1>
      {description && <p className="mt-3 text-sm leading-relaxed text-zinc-500">{description}</p>}
      <div className="mt-8 flex flex-col gap-8">{children}</div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-zinc-900 sm:text-lg">{heading}</h2>
      {children}
    </section>
  );
}

export function LegalText({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-[1.8] text-zinc-600">{children}</p>;
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-outside list-disc flex-col gap-2 pl-5">
      {items.map((item, i) => (
        <li key={i} className="text-sm leading-[1.8] text-zinc-600">
          {item}
        </li>
      ))}
    </ul>
  );
}

// A visually distinct "the operator still has to fill this in" marker. Used
// instead of inventing business-registration facts, retention periods, or a
// contact email that this repository does not establish.
export function OperatorTodo({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-[1.8] text-amber-900">
      {children}
    </p>
  );
}

// Shared table shell for the privacy page's data/third-party inventories.
export function LegalTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead className="bg-zinc-50">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-semibold text-zinc-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-zinc-200 align-top">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 leading-[1.7] text-zinc-600">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
