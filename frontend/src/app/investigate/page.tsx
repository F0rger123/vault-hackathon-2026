import type { Metadata } from "next";
import { InvestigateRedirect } from "@/components/investigate-redirect";
import { ASK_LABEL } from "@/lib/assistant";

// F10.23: Investigate was merged into the chat. Old links (and their query strings) land there.
export const metadata: Metadata = { title: ASK_LABEL };

export default function Page() {
  return <InvestigateRedirect />;
}
