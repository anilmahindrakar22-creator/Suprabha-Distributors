# Database integration checks

`transactional_command_integrity.sql` exercises the real database gateways with isolated fixtures and always rolls back. It verifies duplicate replay, optimistic stale-write rejection, failure rollback, and exact fulfilment audit evidence.

`inventory_ledger_integrity.sql` exercises idempotent goods receipt, authorised adjustment, negative-stock rejection, append-only history, and expired-batch availability. It also always rolls back.

`fefo_allocation_integrity.sql` verifies earliest-expiry-first allocation, full and partial order states, duplicate replay, and automatic release when an allocated order is cancelled.

Run it only after all migrations have been applied to a non-production database. A future CI database job can execute this file unchanged once the repository provisions an isolated PostgreSQL/Supabase service.
