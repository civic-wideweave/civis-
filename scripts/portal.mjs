import { all, get } from "@/lib/db";
export function authoritySummary(departmentId, isAdmin) {
    const where = isAdmin ? "1 = 1" : "r.department_id = ?";
    const params = isAdmin ? [] : [departmentId];
    const row = get(`SELECT COUNT(*) AS total,
            SUM(CASE WHEN r.status = 'submitted' THEN 1 ELSE 0 END) AS new_reports,
            SUM(CASE WHEN r.status = 'under_review' THEN 1 ELSE 0 END) AS pending_review,
            SUM(CASE WHEN r.status IN ('community_verified','authority_notified') THEN 1 ELSE 0 END) AS investigating,
            SUM(CASE WHEN r.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
            SUM(CASE WHEN r.severity = 'critical' AND r.status NOT IN ('resolved','rejected') THEN 1 ELSE 0 END) AS urgent,
            SUM(CASE WHEN r.routing_state = 'awaiting_assignment' THEN 1 ELSE 0 END) AS awaiting
     FROM reports r WHERE ${where}`, params);
    return {
        total: row?.total ?? 0,
        newReports: row?.new_reports ?? 0,
        pendingReview: row?.pending_review ?? 0,
        investigating: row?.investigating ?? 0,
        inProgress: row?.in_progress ?? 0,
        resolved: row?.resolved ?? 0,
        urgent: row?.urgent ?? 0,
        awaitingAssignment: row?.awaiting ?? 0,
    };
}
export function applicationQueue(status) {
    const clause = status ? "WHERE a.status = ?" : "";
    return all(`SELECT a.id, a.department_id, d.name AS organisation_name, d.type AS organisation_type,
            d.official_email, d.phone, d.address, d.division, d.district, d.website,
            a.rep_name, a.rep_designation, a.rep_email, a.rep_phone, a.rep_role,
            a.documents, a.status, a.review_notes, a.submitted_at, a.reviewed_at,
            d.verification_status
     FROM department_applications a
     JOIN departments d ON d.id = a.department_id
     ${clause}
     ORDER BY a.submitted_at DESC`, status ? [status] : []);
}
export function searchPlaces(query, limit = 8) {
    const term = query.trim();
    if (term.length < 2)
        return [];
    const like = `%${term}%`;
    const starts = `${term}%`;
    return all(`SELECT id, name, name_bn, kind, lat, lng, division, district, country
     FROM places
     WHERE name LIKE ? COLLATE NOCASE OR name_bn LIKE ? OR district LIKE ? COLLATE NOCASE
     ORDER BY CASE WHEN name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
              CASE kind WHEN 'division' THEN 0 WHEN 'city' THEN 1 WHEN 'district' THEN 2 ELSE 3 END,
              name
     LIMIT ?`, [like, like, like, starts, limit]);
}
export function facilitiesInBbox(bbox, types) {
    const typeClause = types.length ? `AND type IN (${types.map(() => "?").join(",")})` : "";
    return all(`SELECT id, name, type, lat, lng, address, phone, is_demo
     FROM facilities
     WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ${typeClause}
     ORDER BY name LIMIT 600`, [bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, ...types]);
}
export function organisationMembers(departmentId) {
    return all(`SELECT m.id, m.user_id, u.name, u.email, m.member_role, m.status,
            (SELECT COUNT(*) FROM reports r WHERE r.assignee_id = m.user_id
              AND r.status NOT IN ('resolved','rejected')) AS open_reports
     FROM department_members m JOIN users u ON u.id = m.user_id
     WHERE m.department_id = ? AND m.status != 'removed'
     ORDER BY m.member_role, u.name`, [departmentId]);
}
export function orgRole(userId, departmentId) {
    if (!departmentId)
        return null;
    const row = get("SELECT member_role FROM department_members WHERE user_id = ? AND department_id = ? AND status = 'active'", [userId, departmentId]);
    return row?.member_role ?? null;
}
