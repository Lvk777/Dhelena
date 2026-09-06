import { base44 } from "@/api/base44Client";

// Frontend helper for admin audit logging.
// Calls the logAdminAction backend function which validates admin role server-side
// and creates an AuditLog record with sensitive data masked.
// Never throws — audit logging should not break the main operation.
export async function logAdminAction(action, entityType = "", entityId = "", entityName = "", details = "", before = null, after = null) {
    try {
        await base44.functions.invoke("logAdminAction", {
            action,
            entity_type: entityType,
            entity_id: entityId,
            entity_name: entityName,
            details,
            before,
            after,
        });
    } catch (e) {
        console.error("Audit log failed:", e.message);
    }
}