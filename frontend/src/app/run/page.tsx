import { PageGate } from "@/components/app-shell";
import type { Metadata } from "next";
import { Suspense } from "react";
import { RunBoardView } from "@/components/views/run-board";

export const metadata: Metadata = { title: "Live run board" };

export default function Page() {
  // The board reads ?job= from the URL, so it renders on the client inside a Suspense boundary.
  return (
    <PageGate>
      <Suspense fallback={<p className="text-sm text-muted">Loading the run board</p>}>
        <RunBoardView />
      </Suspense>
    </PageGate>
  );
}
