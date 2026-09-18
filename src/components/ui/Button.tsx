"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { SpinnerIcon } from "./Icon";

// STEP43 item 9: a clear button priority system — Primary (brand-colored,
// one obvious action per screen), Secondary (outlined, supporting actions),
// Ghost (text-only, tertiary), Danger (destructive). Loading always renders
// as spinner + text (never a bare spinner) per item 9's explicit example
// ("AI가 콘텐츠를 만들고 있어요"), and disabled is a real opacity+cursor
// change, not just a color shift that's easy to miss.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600",
  secondary:
    "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 focus-visible:outline-zinc-400",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-zinc-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-[32px] rounded-lg px-3 text-xs",
  md: "min-h-[40px] rounded-lg px-4 text-sm",
  lg: "min-h-[48px] rounded-xl px-5 text-base",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    loadingText?: string;
  }
>(function Button(
  { variant = "primary", size = "md", loading, loadingText, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className ?? ""}`}
      {...rest}
    >
      {loading && <SpinnerIcon size={size === "sm" ? 14 : 16} />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
});
