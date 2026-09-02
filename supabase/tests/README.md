# Database integration checks

`transactional_command_integrity.sql` exercises the real database gateways with isolated fixtures and always rolls back. It verifies duplicate replay, optimistic stale-write rejection, failure rollback, and exact fulfilment audit evidence.

Run it only after all migrations have been applied to a non-production database. A future CI database job can execute this file unchanged once the repository provisions an isolated PostgreSQL/Supabase service.
