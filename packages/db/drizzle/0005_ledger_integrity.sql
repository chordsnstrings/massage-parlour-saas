-- Ledger integrity: every line is a debit or a credit; entries balance; books are append-only for the app; locked periods reject entries.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_one_side"
  CHECK ("debit_aed" >= 0 AND "credit_aed" >= 0 AND ("debit_aed" = 0) <> ("credit_aed" = 0));--> statement-breakpoint

CREATE OR REPLACE FUNCTION ledger_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT coalesce(sum(debit_aed), 0), coalesce(sum(credit_aed), 0) INTO d, c FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'journal entry % does not balance (debits %, credits %)', NEW.entry_id, d, c USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_entry_balanced();--> statement-breakpoint

CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'spa_app' THEN
    RAISE EXCEPTION 'the ledger is append-only — post a reversal instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(OLD, NEW);
END $$;--> statement-breakpoint
CREATE TRIGGER "journal_entries_append_only" BEFORE UPDATE OR DELETE ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint
CREATE TRIGGER "journal_lines_append_only" BEFORE UPDATE OR DELETE ON "journal_lines" FOR EACH ROW EXECUTE FUNCTION ledger_append_only();--> statement-breakpoint

CREATE OR REPLACE FUNCTION ledger_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM period_locks WHERE tenant_id = NEW.tenant_id AND NEW.entry_date <= locked_through) THEN
    RAISE EXCEPTION 'the books are locked through this date' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "journal_entries_period_open" BEFORE INSERT ON "journal_entries" FOR EACH ROW EXECUTE FUNCTION ledger_period_open();
