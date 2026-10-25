"use client";
import { useEffect, useRef } from "react";
import {
  X,
  Footprints,
  Dumbbell,
  Activity as ActivityIcon,
  Check,
  Flame,
} from "lucide-react";
import type { ActivityGroup } from "../lib/types";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    document.body.classList.add("modal-open");
    return () => {
      d?.close();
      if (!document.querySelector("dialog[open]"))
        document.body.classList.remove("modal-open");
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <header className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Zavrieť"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Avatar({ name, size = "" }: { name: string; size?: string }) {
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
export function SportIcon({
  group,
  size = 20,
}: {
  group: ActivityGroup;
  size?: number;
}) {
  const Icon =
    group === "foot"
      ? Footprints
      : group === "exercise"
        ? Dumbbell
        : group === "task"
          ? Check
          : ActivityIcon;
  return <Icon size={size} />;
}
export function Gem({
  earned = false,
  index = 0,
}: {
  earned?: boolean;
  index?: number;
}) {
  return (
    <span
      className={`gem gem-${index % 5} ${earned ? "earned" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48">
        <path
          d="M13 7h22l10 14-21 23L3 21Z"
          fill="currentColor"
          opacity=".17"
        />
        <path
          d="m13 7 11 37L35 7M3 21h42M13 7h22l10 14-21 23L3 21Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      {earned && <Check size={13} className="gem-check" />}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">
        <Footprints size={25} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
export function fmt(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(
    "sk-SK",
    options || { day: "numeric", month: "numeric" },
  ).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}
export function add(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monday(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return add(date, -((d.getUTCDay() + 6) % 7));
}
export type Action = (
  action: string,
  data?: Record<string, unknown>,
) => Promise<any>;
