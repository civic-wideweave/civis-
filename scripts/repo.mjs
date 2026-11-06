import { all, get } from "./db.mjs";
import { haversineKm } from "./format.mjs";
import { VERIFIED_STATES } from "./constants.mjs";
const BASE_SELECT = `
  SELECT r.id, r.title, r.description, r.category_slug, r.severity, r.status,
         r.verification, r.lat, r.lng, r.address, r.neighborhood, r.extra_info, r.anonymous,
         r.is_demo, r.user_id, r.created_at, r.updated_at, r.resolved_at, r.credibility,
         r.department_id, d.name AS department_name,
         CASE WHEN r.anonymous = 1 THEN NULL ELSE u.name END AS reporter_name,
         u.public_name AS reporter_public,
         (SELECT COUNT(*) FROM report_support s WHERE s.report_id = r.id) AS supporters,
         (SELECT COUNT(*) FROM report_comments c WHERE c.report_id = r.id AND c.hidden = 0) AS comment_count,
         (SELECT i.url FROM report_images i WHERE i.report_id = r.id AND i.kind = 'evidence'
            ORDER BY i.created_at LIMIT 1) AS cover_image,
         (SELECT COUNT(*) FROM authority_responses ar WHERE ar.report_id = r.id) AS response_count
  FROM reports r
  LEFT JOIN users u ON u.id = r.user_id
  LEFT JOIN departments d ON d.id = r.department_id
`;
function buildWhere(f) {
    const clauses = [];
    const params = [];
    if (f.q) {
        clauses.push("(r.title LIKE ? OR r.description LIKE ? OR r.address LIKE ? OR r.neighborhood LIKE ?)");
        const like = `%${f.q}%`;
        params.push(like, like, like, like);
    }
    if (f.category) {
        clauses.push("r.category_slug = ?");
        params.push(f.category);
    }
    if (f.severity) {
        clauses.push("r.severity = ?");
        params.push(f.severity);
    }
    if (f.status) {
        if (f.status === "unresolved") {
            clauses.push("r.status NOT IN ('resolved','rejected')");
        }
        else if (f.status === "resolved") {
            clauses.push("r.status = 'resolved'");
        }
        else {
            clauses.push("r.status = ?");
            params.push(f.status);
        }
    }
    if (f.verification) {
        clauses.push("r.verification = ?");
        params.push(f.verification);
    }
    if (f.verifiedOnly) {
        clauses.push("r.verification IN ('community_verified','officially_confirmed')");
    }
    if (f.neighborhood) {
        clauses.push("r.neighborhood = ?");
        params.push(f.neighborhood);
    }
    if (f.from) {
        clauses.push("r.created_at >= ?");
        params.push(f.from);
    }
    if (f.to) {
        clauses.push("r.created_at <= ?");
        params.push(f.to);
    }
    if (f.userId) {
        clauses.push("r.user_id = ?");
        params.push(f.userId);
    }
    if (f.departmentId) {
        clauses.push("r.department_id = ?");
        params.push(f.departmentId);
    }
    if (f.bbox) {
        clauses.push("r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?");
        params.push(f.bbox.minLat, f.bbox.maxLat, f.bbox.minLng, f.bbox.maxLng);
    }
    if (f.near) {
        // Bounding box pre-filter; exact distance is applied in JS afterwards.
        const dLat = 0.35;
        const dLng = 0.35;
        clauses.push("r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?");
        params.push(f.near.lat - dLat, f.near.lat + dLat, f.near.lng - dLng, f.near.lng + dLng);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}
export function listReports(f = {}) {
    const { where, params } = buildWhere(f);
    const sort = f.sort ?? "latest";
    let order = "r.created_at DESC";
    if (sort === "supported")
        order = "supporters DESC, r.created_at DESC";
    if (sort === "critical")
        order = "CASE r.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, r.created_at DESC";
    if (sort === "resolved")
        order = "r.resolved_at DESC";
    const page = Math.max(1, f.page ?? 1);
    // The map asks for a larger page than a paginated list does. Keeping the cap
    // here (rather than in each caller) is what previously limited the map to 60
    // points no matter what pageSize it requested.
    const pageSize = Math.min(500, Math.max(1, f.pageSize ?? 12));
    const rows = all(`${BASE_SELECT} ${where} ORDER BY ${order}`, params);
    let items = rows;
    if (f.near) {
        items = rows
            .map((r) => ({ ...r, distance_km: haversineKm(f.near, { lat: r.lat, lng: r.lng }) }))
            .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
    }
    const total = items.length;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total };
}
export function reportDetail(id) {
    const report = get(`${BASE_SELECT} WHERE r.id = ?`, [id]);
    if (!report)
        return null;
    return {
        report,
        images: all("SELECT id, url, kind, caption, created_at FROM report_images WHERE report_id = ? ORDER BY created_at", [id]),
        comments: all(`SELECT c.id, c.body, c.created_at, u.name AS author, u.role, c.hidden, c.user_id
       FROM report_comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.report_id = ? AND c.hidden = 0 ORDER BY c.created_at ASC`, [id]),
        history: all(`SELECT id, from_status, to_status, note, actor_label, actor_role, created_at
       FROM report_status_history WHERE report_id = ? ORDER BY created_at ASC`, [id]),
        verifications: all(`SELECT v.id, v.stage, v.decision, v.note, v.created_at, u.name AS actor
       FROM report_verifications v LEFT JOIN users u ON u.id = v.actor_id
       WHERE v.report_id = ? ORDER BY v.created_at ASC`, [id]),
        responses: all(`SELECT a.id, a.body, a.progress, a.eta, a.created_at, d.name AS department, u.name AS official
       FROM authority_responses a
       JOIN departments d ON d.id = a.department_id
       JOIN users u ON u.id = a.user_id
       WHERE a.report_id = ? ORDER BY a.created_at ASC`, [id]),
        assignment: get(`SELECT aa.department_id, d.name AS department, aa.created_at AS assigned_at
       FROM authority_assignments aa JOIN departments d ON d.id = aa.department_id
       WHERE aa.report_id = ?`, [id]),
        supporters: all(`SELECT u.name, 0 AS anonymous FROM report_support s JOIN users u ON u.id = s.user_id
       WHERE s.report_id = ? ORDER BY s.created_at DESC LIMIT 8`, [id]),
        follow_count: get("SELECT COUNT(*) AS n FROM user_follows WHERE report_id = ?", [id])?.n ?? 0,
    };
}
export function supportState(userId, reportId) {
    if (!userId)
        return { supported: false, following: false };
    const supported = !!get("SELECT 1 AS x FROM report_support WHERE report_id = ? AND user_id = ?", [reportId, userId]);
    const following = !!get("SELECT 1 AS x FROM user_follows WHERE report_id = ? AND user_id = ?", [reportId, userId]);
    return { supported, following };
}
function statWhere(f) {
    const clauses = [];
    const params = [];
    if (f.category) {
        clauses.push("category_slug = ?");
        params.push(f.category);
    }
    if (f.severity) {
        clauses.push("severity = ?");
        params.push(f.severity);
    }
    if (f.neighborhood) {
        clauses.push("neighborhood = ?");
        params.push(f.neighborhood);
    }
    if (f.from) {
        clauses.push("created_at >= ?");
        params.push(f.from);
    }
    if (f.to) {
        clauses.push("created_at <= ?");
        params.push(f.to);
    }
    if (f.status) {
        clauses.push("status = ?");
        params.push(f.status);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}
export function overview(f = {}) {
    const { where, params } = statWhere(f);
    const submitted = get(`SELECT COUNT(*) AS n FROM reports ${where}`, params)?.n ?? 0;
    const verified = get(`SELECT COUNT(*) AS n FROM verified_reports ${where}`, params)?.n ?? 0;
    const resolved = get(`SELECT COUNT(*) AS n FROM verified_reports ${where ? `${where} AND` : "WHERE"} status = 'resolved'`, params)?.n ?? 0;
    const rejected = get(`SELECT COUNT(*) AS n FROM reports ${where ? `${where} AND` : "WHERE"} status = 'rejected'`, params)?.n ?? 0;
    const communities = get("SELECT COUNT(DISTINCT neighborhood) AS n FROM reports WHERE neighborhood IS NOT NULL")?.n ?? 0;
    const demoRows = get("SELECT COUNT(*) AS n FROM reports WHERE is_demo = 1")?.n ?? 0;
    const avg = get(`SELECT AVG((julianday(ar.created_at) - julianday(r.created_at))) AS d
     FROM authority_responses ar JOIN reports r ON r.id = ar.report_id`)?.d;
    const unresolved = Math.max(submitted - resolved - rejected, 0);
    return {
        submitted,
        verified,
        resolved,
        unresolved,
        rejected,
        communities,
        avgResponseDays: avg === null || avg === undefined ? null : Math.round(avg * 10) / 10,
        resolutionRate: verified ? Math.round((resolved / verified) * 100) : 0,
        demoRows,
    };
}
export function byCategory(f = {}) {
    const { where, params } = statWhere(f);
    return all(`SELECT category_slug,
            COUNT(*) AS total,
            SUM(CASE WHEN verification IN ('community_verified','officially_confirmed') THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
     FROM reports ${where} GROUP BY category_slug ORDER BY total DESC`, params);
}
export function byNeighborhood(f = {}) {
    const { where, params } = statWhere(f);
    return all(`SELECT COALESCE(neighborhood,'Unassigned') AS neighborhood,
            COUNT(*) AS total,
            SUM(CASE WHEN verification IN ('community_verified','officially_confirmed') THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical
     FROM reports ${where} GROUP BY neighborhood ORDER BY total DESC`, params);
}
export function bySeverity(f = {}) {
    const { where, params } = statWhere(f);
    return all(`SELECT severity, COUNT(*) AS total, SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
     FROM reports ${where} GROUP BY severity`, params);
}
export function monthlyTrend(f = {}) {
    const { where, params } = statWhere(f);
    return all(`SELECT substr(created_at, 1, 7) AS month,
            COUNT(*) AS submitted,
            SUM(CASE WHEN verification IN ('community_verified','officially_confirmed') THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
     FROM reports ${where} GROUP BY month ORDER BY month ASC`, params);
}
export function statusBreakdown(f = {}) {
    const { where, params } = statWhere(f);
    return all(`SELECT status, COUNT(*) AS n FROM reports ${where} GROUP BY status`, params);
}
export function responsePerformance() {
    return all(`SELECT d.name AS department,
            (SELECT COUNT(*) FROM reports r WHERE r.department_id = d.id) AS assigned,
            (SELECT COUNT(DISTINCT ar.report_id) FROM authority_responses ar WHERE ar.department_id = d.id) AS responded,
            (SELECT AVG(julianday(ar.created_at) - julianday(r.created_at))
               FROM authority_responses ar JOIN reports r ON r.id = ar.report_id
               WHERE ar.department_id = d.id) AS avg_days,
            (SELECT COUNT(*) FROM reports r WHERE r.department_id = d.id AND r.status = 'resolved') AS resolved
     FROM departments d ORDER BY assigned DESC`);
}
export function recentReports(limit = 6) {
    return listReports({ pageSize: limit, sort: "latest" }).items;
}
export function mapPoints(f = {}) {
    return listReports({ ...f, pageSize: 400 }).items.map((r) => ({
        id: r.id,
        title: r.title,
        lat: r.lat,
        lng: r.lng,
        severity: r.severity,
        status: r.status,
        verification: r.verification,
        category: r.category_slug,
        neighborhood: r.neighborhood,
        supporters: r.supporters,
    }));
}
export function myReports(userId) {
    return all(`${BASE_SELECT} WHERE r.user_id = ? ORDER BY r.created_at DESC`, [userId]);
}
export function myDashboard(userId) {
    const rows = myReports(userId);
    return {
        rows,
        totals: {
            total: rows.length,
            underReview: rows.filter((r) => r.status === "submitted" || r.status === "under_review").length,
            awaitingAuthority: rows.filter((r) => r.status === "community_verified" || r.status === "authority_notified").length,
            resolved: rows.filter((r) => r.status === "resolved").length,
            inProgress: rows.filter((r) => r.status === "in_progress").length,
        },
    };
}
export function authorityQueue(departmentId, isAdmin) {
    const rows = all(`${BASE_SELECT} ORDER BY r.created_at DESC`).filter((r) => isAdmin || r.department_id === departmentId);
    return {
        rows,
        assigned: rows.filter((r) => r.department_id),
        unassigned: rows.filter((r) => !r.department_id),
        critical: rows.filter((r) => r.severity === "critical" && r.status !== "resolved"),
        overdue: rows.filter((r) => r.response_count === 0 &&
            r.status !== "resolved" &&
            Date.now() - new Date(r.created_at).getTime() > 7 * 86_400_000),
        investigating: rows.filter((r) => r.status === "under_review"),
        resolved: rows.filter((r) => r.status === "resolved"),
    };
}
export function moderationQueue() {
    const pending = all(`${BASE_SELECT} WHERE r.verification IN ('unverified','pending_review') ORDER BY
     CASE r.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
     r.created_at ASC`);
    const flagged = all(`SELECT f.id, f.target_type, f.target_id, f.reason, f.created_at, u.name AS reporter, r.title
     FROM abuse_flags f
     LEFT JOIN users u ON u.id = f.reporter_id
     LEFT JOIN reports r ON r.id = f.target_id
     ORDER BY f.created_at DESC LIMIT 25`);
    const duplicateCandidates = all(`SELECT a.id, a.title, a.neighborhood,
            (SELECT COUNT(*) FROM reports b
              WHERE b.id <> a.id AND b.category_slug = a.category_slug
                AND ABS(b.lat - a.lat) < 0.002 AND ABS(b.lng - a.lng) < 0.002) AS d
     FROM reports a WHERE a.status IN ('submitted','under_review') AND d > 0
     ORDER BY d DESC LIMIT 10`);
    return { pending, flagged, duplicateCandidates };
}
export function notificationsFor(userId) {
    return all("SELECT id, type, title, body, report_id, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]);
}
export function adminUsers() {
    return all(`SELECT u.id, u.name, u.email, u.role, d.name AS department_name, u.suspended,
            u.email_verified, u.created_at, u.is_demo,
            (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) AS report_count
     FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.deleted_at IS NULL ORDER BY u.created_at ASC`);
}
export function auditLogs(limit = 60) {
    return all("SELECT id, actor_label, actor_role, action, target_type, target_id, detail, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?", [limit]);
}
export function departments() {
    return all("SELECT id, name, jurisdiction FROM departments ORDER BY name");
}
export function verifiedCountForExport() {
    return VERIFIED_STATES;
}
