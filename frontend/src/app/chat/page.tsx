import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { ChatView } from "@/components/views/chat";

export const metadata: Metadata = { title: "Ask VAULT" };

export default function Page() {
  return (
    <PageGate>
      <ChatView />
    </PageGate>
  );
}
