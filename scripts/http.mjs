import { NextResponse } from "next/server";
export function json(data, init) {
    return NextResponse.json(data, init);
}
export function fail(message, status = 400, extra) {
    return NextResponse.json({ error: message, ...extra }, { status });
}
export function unauthorized(message = "Sign in required.") {
    return fail(message, 401);
}
export function forbidden(message = "Your role cannot perform this action.") {
    return fail(message, 403);
}
export function notFound(message = "Not found.") {
    return fail(message, 404);
}
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.reset < now) {
        buckets.set(key, { count: 1, reset: now + windowMs });
        return { allowed: true, remaining: max - 1 };
    }
    bucket.count += 1;
    if (bucket.count > max) {
        return { allowed: false, remaining: 0, retryAfterMs: bucket.reset - now };
    }
    return { allowed: true, remaining: max - bucket.count };
}
export function clientKey(req, scope) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "local";
    return `${scope}:${ip}`;
}
export function tooMany(retryAfterMs) {
    return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429, headers: retryAfterMs ? { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } : undefined });
}
export async function readJson(req) {
    try {
        return (await req.json());
    }
    catch {
        return null;
    }
}
