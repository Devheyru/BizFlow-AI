<!-- SPECKIT START -->
# BizFlow AI Agent Guidance

All AI agents and development assistants MUST adhere to the [BizFlow AI Constitution](.specify/memory/constitution.md).

## Non-Negotiable Core Rules:
1. **Multi-Tenancy & RLS**: Every tenant table MUST have `organization_id`. Never trust client-supplied tenant IDs. Always enforce PostgreSQL Row-Level Security.
2. **Financial & Inventory Invariance**: Multi-record operations MUST be atomic. Every stock change MUST produce an audited `stock_movements` record. Completed sales and invoices are immutable.
3. **Type Safety & Validation**: Strict TypeScript without `any`. Validate all inputs with Zod at runtime boundaries.
4. **Server Authorization**: Verify RBAC permissions on the server for all actions/routes. Never expose Supabase service-role keys.
5. **AI Guardrails**: AI suggestions are untrusted. AI models MUST NEVER autonomously execute financial or inventory-mutating operations without human authorization.

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the active plan in [specs/001-auth-organization/plan.md](specs/001-auth-organization/plan.md).
<!-- SPECKIT END -->
