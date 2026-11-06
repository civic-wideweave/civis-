import { cookies } from "next/headers";
import { all, get, run } from "./db.mjs";
import { newId, nowIso, randomToken, sha256 } from "./crypto.mjs";
import { createNotification, } from "./notifications.mjs";
export const SESSION_COOKIE = "civis_session";
const SESSION_DAYS = 30;
const USER_SELECT = `
  SELECT u.id, u.email, u.name, u.role, u.department_id, d.name AS department_name,
         d.verification_status AS org_status,
         u.email_verified, u.notify_email, u.notify_inapp, u.public_name,
         u.anonymous_default, u.created_at, u.is_demo
  FROM users u
  LEFT JOIN departments d ON d.id = u.department_id
  WHERE u.deleted_at IS NULL AND u.suspended = 0
`;
export function userById(id) {
    return get(`${USER_SELECT} AND u.id = ?`, [id]);
}
export function userByEmail(email) {
    return get(`SELECT u.*, d.name AS department_name FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.email = ? AND u.deleted_at IS NULL`, [email.trim().toLowerCase()]);
}
export function createSession(userId) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    run("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)", [sha256(token), userId, expiresAt, nowIso()]);
    return { token, expiresAt };
}
export async function setSessionCookie(token, expiresAt) {
    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        expires: new Date(expiresAt),
    });
}
export async function clearSessionCookie() {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) {
        run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
    }
    store.delete(SESSION_COOKIE);
}
export async function getCurrentUser() {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token)
        return null;
    const tokenHash = sha256(token);
    const session = get("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?", [tokenHash]);
    if (!session)
        return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
        run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
        return null;
    }
    return userById(session.user_id) ?? null;
}
export async function authorize(roles) {
    const user = await getCurrentUser();
    if (!user)
        return { ok: false, status: 401, message: "Sign in required." };
    if (roles && !roles.includes(user.role)) {
        return { ok: false, status: 403, message: "Your role cannot perform this action." };
    }
    // Authority privileges are granted by organisation verification, not by the
    // role string alone. An organisation under review is denied here on the
    // server, whatever the client renders.
    if (user.role === "authority" && user.org_status !== "approved") {
        return {
            ok: false,
            status: 403,
            message: "Your organisation is pending verification. Authority features unlock after a CIVIS administrator approves it.",
        };
    }
    return { ok: true, user };
}
/** True when an authority account is actually assigned to the incident. */
export function isAssignedOfficial(user, reportId) {
    if (user.role === "admin")
        return true;
    if (user.role !== "authority")
        return false;
    const row = get("SELECT department_id FROM authority_assignments WHERE report_id = ?", [reportId]);
    if (!row)
        return false;
    return row.department_id === user.department_id;
}
export function audit(actor, action, target, detail) {
    run(`INSERT INTO audit_logs (id, actor_id, actor_role, actor_label, action, target_type, target_id, detail, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`, [
        newId("audit"),
        actor?.id ?? null,
        actor?.role ?? null,
        actor?.name ?? "system",
        action,
        target?.type ?? null,
        target?.id ?? null,
        detail ?? null,
        nowIso(),
    ]);
}
export function notify(userId, input) {
    if (!userId)
        return;
    createNotification({ userId, ...input });
}
export function notifyFollowers(reportId, input) {
    const followers = all("SELECT user_id FROM user_follows WHERE report_id = ?", [reportId]);
    for (const f of followers) {
        notify(f.user_id, { ...input, reportId });
    }
}
export { unreadNotificationCount } from "./notifications.mjs";
