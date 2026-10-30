"use client";

import { useState } from "react";
import { errorText, vault, type ManagedUser } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { useSession } from "./session";
import { Button, Field, inputClass, Notice, Panel, Tag } from "./ui";

const ROLES = ["viewer", "analyst", "admin"] as const;
const METHOD: Record<string, string> = {
  password: "Password",
  passkey: "Face, fingerprint or key",
  demo: "Demo button",
  "first-setup": "First setup",
  "password-change": "Changed password",
  "sign-out": "Signed out",
};

/** F09.17: everyone gets their own login. People are disabled, never deleted, so the log keeps a name to point to. */
export function UsersPanel() {
  const { me } = useSession();
  const users = useLoad("users", vault.users);
  const [name, setName] = useState("");
  const [role, setRole] = useState("analyst");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      users.reload();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="People" aside={users.data ? `${users.data.length} accounts` : undefined}>
      <form
        className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act("add", () => vault.addUser(name.trim(), role, password))) {
            setName("");
            setPassword("");
          }
        }}
      >
        <Field label="Name" htmlFor="new-user-name">
          <input id="new-user-name" className={inputClass} maxLength={64} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="new-user-role">
          <select id="new-user-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starting password, 10 characters or more" htmlFor="new-user-password">
          <input id="new-user-password" type="password" autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" busy={busy === "add"} disabled={name.trim().length < 2 || password.length < 10}>
          Add person
        </Button>
      </form>
      {error && <Notice>{error}</Notice>}
      <ul className="mt-2 flex flex-col divide-y divide-line" aria-label="People">
        {users.data?.map((u) => (
          <Person key={u.id} user={u} self={u.username === me.username} busy={busy} act={act} />
        ))}
      </ul>
    </Panel>
  );
}

function Person({
  user,
  self,
  busy,
  act,
}: {
  user: ManagedUser;
  self: boolean;
  busy: string | null;
  act: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-sm">
      <span className="min-w-40 flex-1">
        <span className="font-medium">{user.username}</span>
        {self && <span className="ml-2 text-xs text-muted">you</span>}
        {user.disabled && (
          <Tag tone="red" className="ml-2">
            Disabled
          </Tag>
        )}
        <span className="block text-xs text-muted">
          {user.last_sign_in
            ? `Last signed in ${dateTime(user.last_sign_in.ts)} with ${(METHOD[user.last_sign_in.method] ?? user.last_sign_in.method).toLowerCase()}`
            : "Has not signed in yet"}
        </span>
      </span>
      <select
        aria-label={`Role for ${user.username}`}
        className={`${inputClass} w-auto`}
        value={user.role}
        disabled={busy !== null}
        onChange={(e) => act(`role${user.id}`, () => vault.changeUser(user.id, { role: e.target.value }))}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {resetting ? (
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(`pw${user.id}`, () => vault.resetPassword(user.id, password))) {
              setResetting(false);
              setPassword("");
            }
          }}
        >
          <input
            type="password"
            aria-label={`New password for ${user.username}`}
            autoComplete="new-password"
            className={`${inputClass} w-44`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" busy={busy === `pw${user.id}`} disabled={password.length < 10}>
            Set
          </Button>
          <Button type="button" variant="quiet" onClick={() => setResetting(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="quiet" onClick={() => setResetting(true)}>
          Reset password
        </Button>
      )}
      {!self && (
        <Button
          variant={user.disabled ? undefined : "danger"}
          busy={busy === `dis${user.id}`}
          onClick={() => act(`dis${user.id}`, () => vault.changeUser(user.id, { disabled: !user.disabled }))}
        >
          {user.disabled ? "Enable" : "Disable"}
        </Button>
      )}
    </li>
  );
}

/** F09.17: who signed in, when and how. Nothing on this screen, or anywhere in VAULT, can remove a row. */
export function SigninLogPanel() {
  const log = useLoad("signin-log", () => vault.signinLog(100), 10000);
  const check = useLoad("signin-verify", vault.signinVerify, 30000);
  return (
    <Panel
      title="Sign-in log"
      aside={
        check.data ? (check.data.intact ? `${check.data.entries} entries, chain intact` : `Altered at entry ${check.data.first_bad_id}`) : undefined
      }
    >
      {check.data && !check.data.intact && (
        <Notice>Someone changed this log outside VAULT. Entries from {check.data.first_bad_id} on cannot be trusted.</Notice>
      )}
      <p className="mb-3 text-sm text-muted">
        Every sign-in, failed try and sign-out. VAULT has no way to edit or delete these, and any change made directly
        in the database file breaks the chain and shows here.
      </p>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-panel text-xs text-muted">
            <tr>
              <th className="py-1.5 pr-4 font-medium">When</th>
              <th className="py-1.5 pr-4 font-medium">Who</th>
              <th className="py-1.5 pr-4 font-medium">How</th>
              <th className="py-1.5 pr-4 font-medium">Result</th>
              <th className="py-1.5 font-medium">From</th>
            </tr>
          </thead>
          <tbody>
            {log.data?.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="whitespace-nowrap py-1.5 pr-4 tabular-nums">{dateTime(e.ts)}</td>
                <td className="py-1.5 pr-4 font-medium">{e.username}</td>
                <td className="py-1.5 pr-4">{METHOD[e.method] ?? e.method}</td>
                <td className="py-1.5 pr-4">
                  {e.outcome === "allowed" ? <Tag tone="green">OK</Tag> : <Tag tone="red">{e.reason ?? "Denied"}</Tag>}
                </td>
                <td className="py-1.5 font-mono text-xs text-muted">{e.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
