"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { TitleBlock } from "../title-block";
import { Button, cx, Tag } from "../ui";

const DONE_KEY = "vault.guide.done";

interface Step {
  id: string;
  title: string;
  who: string;
  why: ReactNode;
  press: ReactNode[];
  see: ReactNode;
  link: { href: string; label: string };
}

const B = ({ children }: { children: ReactNode }) => <span className="font-semibold text-ink">{children}</span>;

// F10.24: a first-time walk through VAULT, in plain words. Each step says what to press, what you should see, and
// links straight to the place. Button names here match the real buttons, so a reader can follow along on screen.
const STEPS: Step[] = [
  {
    id: "sign-in",
    title: "Sign in",
    who: "Everyone",
    why: "VAULT runs on your own computer. Signing in tells it who you are and what you may do.",
    press: [
      <>Open VAULT in your browser.</>,
      <>
        Type your <B>Username</B> and <B>Password</B>, or paste the access key an administrator gave you.
      </>,
      <>
        Press <B>Sign in</B>.
      </>,
    ],
    see: "The Overview page: how many files are in your collection, the latest runs and findings, and a privacy panel saying nothing leaves this computer.",
    link: { href: "/", label: "Go to Overview" },
  },
  {
    id: "sign-in-steps",
    title: "Set up your sign-in steps",
    who: "Everyone",
    why: "Extra steps, such as a passkey or a face check, make it much harder for someone else to get in as you.",
    press: [
      <>
        Press <B>Security</B> in the side rail.
      </>,
      <>
        In <B>How you sign in</B>, pick the steps you want: password, passkey, face check or a spoken key phrase.
      </>,
      <>
        Follow the prompts for each one, then press <B>Save sign-in steps</B>.
      </>,
    ],
    see: "A short trail of your steps, each with a tick. Next time you sign in, VAULT asks for them in that order.",
    link: { href: "/security", label: "Open Security" },
  },
  {
    id: "add-files",
    title: "Add files",
    who: "Analysts and admins",
    why: "VAULT can only read what you give it. Your files are kept as read-only originals and never changed.",
    press: [
      <>
        Press <B>Add files</B> in the side rail.
      </>,
      <>
        If there is no collection yet, press <B>Create your first collection</B> and give it a name.
      </>,
      <>
        Press <B>Add files</B>, choose drawings, reports or contracts, then press <B>Upload</B>.
      </>,
    ],
    see: "Your files listed under Files in this collection. Anything unsafe is refused and the reason is shown.",
    link: { href: "/setup", label: "Open Add files" },
  },
  {
    id: "run",
    title: "Run the reading",
    who: "Analysts and admins",
    why: "Reading turns each file into checked facts: projects, dates, ratings and who signed what.",
    press: [
      <>
        On the <B>Add files</B> page, scroll to <B>Start the run</B>.
      </>,
      <>
        Leave the lanes as suggested, or choose your own, then press <B>Start run</B>.
      </>,
    ],
    see: "The Progress page: a live board where the coordinator hands files out, the security gate screens each one and the reviewer checks the results. It ends with Completed.",
    link: { href: "/setup#step-4", label: "Go to Start the run" },
  },
  {
    id: "keeper",
    title: "Ask Keeper (Ask) a question",
    who: "Everyone",
    why: "Keeper answers from your files only, and shows the exact lines it used so you can check it.",
    press: [
      <>
        Press <B>Keeper (Ask)</B> in the side rail. Keeper is VAULT&apos;s question-and-answer assistant.
      </>,
      <>
        Type a question, for example <span className="italic">&ldquo;Which inspection reports failed?&rdquo;</span>, and press{" "}
        <B>Send</B>.
      </>,
      <>Press any numbered source under the answer to open that document.</>,
    ],
    see: "An answer with numbered sources. A sentence that no file supports is marked so you know not to trust it.",
    link: { href: "/chat", label: "Open Keeper (Ask)" },
  },
  {
    id: "check",
    title: "Check conflicts and quotes",
    who: "Everyone",
    why: "When two documents disagree, for example two different pressure ratings for the same valve, VAULT flags it.",
    press: [
      <>
        Press <B>Investigate</B> in the side rail.
      </>,
      <>Read the Findings list. Each one quotes the words it came from.</>,
      <>Press a finding or a file name to open the document and see the quote in place.</>,
    ],
    see: "Findings with a Verified mark when the quote was found word for word in the file, and the documents that conflict side by side.",
    link: { href: "/investigate", label: "Open Investigate" },
  },
  {
    id: "approve",
    title: "Approve copies",
    who: "Analysts propose, admins decide",
    why: "VAULT never moves or renames your files by itself. Any reorganising is written as copies, and only after an admin says yes.",
    press: [
      <>
        Press <B>Approvals</B> in the side rail.
      </>,
      <>
        An analyst or admin fills in <B>Propose a new folder layout</B> and presses <B>Create proposal</B>.
      </>,
      <>
        An admin picks the request on the left, reads <B>Before and after</B>, then presses <B>Approve and export copies</B> or{" "}
        <B>Reject</B>.
      </>,
    ],
    see: "Approved and exported, with a tick next to every copy written into VAULT's own export folder. The originals say unchanged.",
    link: { href: "/approvals", label: "Open Approvals" },
  },
  {
    id: "view-only",
    title: "Browse in view only, and delete",
    who: "Everyone can view; only admins delete",
    why: "Anyone can look at what is planned without any risk of changing it. Admins can tidy up old requests and copies.",
    press: [
      <>
        On Approvals, press <B>View only</B>. Viewers always see this mode.
      </>,
      <>Pick a request. Press any file name to open it. Compare where it is now with where its copy would go.</>,
      <>
        Admins, in <B>Review and decide</B>: press <B>Delete this request</B>, <B>Delete its copies only</B> or{" "}
        <B>Delete copy</B> next to one file. Read the list of what will go, then confirm.
      </>,
    ],
    see: "In view only there are no approve, reject or delete buttons. After a delete, a note confirms what went. Originals are never deleted, and every delete is in the audit log.",
    link: { href: "/approvals?view=only", label: "Open Approvals in view only" },
  },
  {
    id: "invite",
    title: "Invite people",
    who: "Admins",
    why: "Each person gets their own sign-in and only the permissions their job needs.",
    press: [
      <>
        Press <B>Security</B> in the side rail, then <B>Invite someone</B>.
      </>,
      <>Answer the five short questions: who, what they can do, how they sign in, how they get in, and a final check.</>,
      <>
        Press <B>Create invite</B>, then <B>Copy invite link</B> and send it to them yourself.
      </>,
    ],
    see: "An invite card with a one-time link and a QR code. The link works once, for 48 hours.",
    link: { href: "/security", label: "Open Security" },
  },
  {
    id: "brain",
    title: "Watch the brain",
    who: "Everyone",
    why: "The brain shows, from VAULT's own activity record, what it stored, read, looked at, sorted and copied.",
    press: [
      <>
        Press <B>Brain</B> in the side rail.
      </>,
      <>Watch the map light up as files are read. Press a file to open it.</>,
      <>
        Answer anything under <B>VAULT&apos;s questions</B>, or use <B>Teach it</B> to tell it something it should know.
      </>,
    ],
    see: "A map of your collection, a running list of what just happened, and VAULT's open questions for you.",
    link: { href: "/brain", label: "Open the brain" },
  },
];

export function GuideView() {
  // Rendered only after sign-in, in the browser, so reading storage during the first render is safe.
  const [done, setDone] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
      return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return []; // storage blocked or unreadable: start fresh
    }
  });
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <TitleBlock
        href="/guide"
        title="How to use VAULT"
        description="Ten short steps for your first day. Each one says what to press, what you should see, and takes you there."
        actions={
          <span className="text-sm text-muted" aria-live="polite">
            <span className="tabular-nums font-semibold text-ink">{done.length}</span> of {STEPS.length} done
          </span>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Guide steps" className="lg:sticky lg:top-6 lg:self-start">
          <ol className="flex flex-col gap-0.5 text-sm">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-2 rounded-control px-2 py-1.5 text-muted hover:bg-raised hover:text-ink">
                  <span
                    aria-hidden
                    className={cx(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                      done.includes(s.id) ? "border-green bg-green/15 text-green" : "border-line-strong",
                    )}
                  >
                    {done.includes(s.id) ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0">{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <ol className="flex min-w-0 max-w-4xl flex-col gap-5">
          {STEPS.map((s, i) => {
            const isDone = done.includes(s.id);
            return (
              <li key={s.id} id={s.id} className="scroll-mt-6">
                <section
                  aria-labelledby={`${s.id}-h`}
                  className={cx("trim rounded-card border bg-panel p-4 shadow-panel sm:p-5", isDone ? "border-green/40" : "border-line")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-sm">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <h2 id={`${s.id}-h`} className="display text-lg leading-snug">
                          <span className="sr-only">Step {i + 1}: </span>
                          {s.title}
                        </h2>
                        <p className="mt-1 text-sm text-muted">{s.why}</p>
                      </div>
                    </div>
                    <Tag>{s.who}</Tag>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-medium text-muted">What to press</h3>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm">
                        {s.press.map((p, n) => (
                          <li key={n}>{p}</li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <h3 className="text-xs font-medium text-muted">What you should see</h3>
                      <p className="mt-1.5 text-sm">{s.see}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                    <Link
                      href={s.link.href}
                      className="press inline-flex min-h-9 items-center rounded-control border border-accent bg-accent px-3.5 py-1.5 text-sm font-semibold text-on-accent hover:brightness-[1.08]"
                    >
                      {s.link.label}
                    </Link>
                    <Button variant="secondary" aria-pressed={isDone} onClick={() => toggle(s.id)}>
                      {isDone ? "Done ✓" : "Mark as done"}
                    </Button>
                  </div>
                </section>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
