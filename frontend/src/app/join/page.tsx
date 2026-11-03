import type { Metadata } from "next";
import { JoinView } from "@/components/join-view";

export const metadata: Metadata = { title: "Join" };

/** F09.21: public on purpose. The invite code after the # decides what this page may do, checked by the server. */
export default function Page() {
  return <JoinView />;
}
