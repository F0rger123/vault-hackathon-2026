"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ASK_LABEL } from "@/lib/assistant";

/**
 * F10.23: /investigate now lives in the chat. Done in the browser so it also works in the static build, and the
 * query string comes along (?q= fills the message box, ?ask= sends it).
 */
export function InvestigateRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/chat${window.location.search}`);
  }, [router]);
  return (
    <p className="p-6 text-sm text-muted">
      Investigate is now part of{" "}
      <Link href="/chat" className="underline underline-offset-4">
        {ASK_LABEL}
      </Link>
      .
    </p>
  );
}
