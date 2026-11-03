/**
 * F09.14: the browser half of passkey sign-in. The device (Windows Hello, Touch ID, a YubiKey) does the
 * cryptography; the face, fingerprint or PIN never leaves it. These helpers only translate between the JSON the
 * server sends and the binary the WebAuthn API wants.
 */
import { post, type SignInResult } from "./api";

type Json = Record<string, unknown>;

function fromB64url(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function toB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

function creationOptions(o: Json): PublicKeyCredentialCreationOptions {
  const user = o.user as Json;
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: fromB64url(o.challenge as string),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: fromB64url(user.id as string) },
    excludeCredentials: ((o.excludeCredentials as Json[]) ?? []).map((c) => ({ type: "public-key", id: fromB64url(c.id as string) })),
  };
}

function requestOptions(o: Json): PublicKeyCredentialRequestOptions {
  return {
    ...(o as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromB64url(o.challenge as string),
    allowCredentials: ((o.allowCredentials as Json[]) ?? []).map((c) => ({ type: "public-key", id: fromB64url(c.id as string) })),
  };
}

/**
 * Where the passkey lives. Naming it stops browsers offering their own password manager instead: Chrome otherwise
 * suggests saving the passkey to Google Password Manager, which is not Windows Hello or a hardware key.
 */
export type PasskeyKind = "device" | "key" | "phone";

const KIND: Record<PasskeyKind, { attachment?: AuthenticatorAttachment; hints: string[] }> = {
  device: { attachment: "platform", hints: ["client-device"] },
  key: { attachment: "cross-platform", hints: ["security-key"] },
  phone: { attachment: "cross-platform", hints: ["hybrid"] },
};

/** Register this device, a plugged-in security key or a phone as a passkey for the signed-in person. */
export async function addPasskey(name: string, kind: PasskeyKind = "device"): Promise<void> {
  const { handle, options } = await post<{ handle: string; options: Json }>("/auth/passkeys/register/options", {});
  const base = creationOptions(options);
  const publicKey = {
    ...base,
    authenticatorSelection: { ...base.authenticatorSelection, authenticatorAttachment: KIND[kind].attachment },
    hints: KIND[kind].hints,
  } as PublicKeyCredentialCreationOptions;
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was created.");
  const r = cred.response as AuthenticatorAttestationResponse;
  await post("/auth/passkeys/register", {
    handle,
    name,
    credential: {
      id: cred.id,
      rawId: toB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: toB64url(r.clientDataJSON),
        attestationObject: toB64url(r.attestationObject),
        transports: r.getTransports?.() ?? [],
      },
      clientExtensionResults: cred.getClientExtensionResults(),
    },
  });
}

/** Sign in with a passkey: the device asks for a face, fingerprint, PIN or a touch of the security key. */
export async function signInWithPasskey(username: string): Promise<SignInResult> {
  const { handle, options } = await post<{ handle: string; options: Json }>("/auth/passkey-login/options", { username });
  const cred = (await navigator.credentials.get({ publicKey: requestOptions(options) })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was used.");
  const r = cred.response as AuthenticatorAssertionResponse;
  return post<SignInResult>("/auth/passkey-login", {
    handle,
    credential: {
      id: cred.id,
      rawId: toB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: toB64url(r.clientDataJSON),
        authenticatorData: toB64url(r.authenticatorData),
        signature: toB64url(r.signature),
        userHandle: r.userHandle ? toB64url(r.userHandle) : null,
      },
      clientExtensionResults: cred.getClientExtensionResults(),
    },
  });
}
