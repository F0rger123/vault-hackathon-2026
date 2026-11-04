import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { ChatView } from "@/components/views/chat";
import { ASK_LABEL } from "@/lib/assistant";

export const metadata: Metadata = { title: ASK_LABEL };

export default function Page() {
  return (
    <PageGate>
      <ChatView />
    </PageGate>
  );
}
