"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

export default function DashNav({ items, variant, home = "/church", label = "Church dashboard" }: { items: NavItem[]; variant: "side" | "tabs"; home?: string; label?: string }) {
  const path = usePathname();
  return (
    <nav className={variant === "side" ? "dash-side-nav" : "dash-tabs"} aria-label={label}>
      {items.map((i) => {
        const on = i.href === home ? path === home : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
