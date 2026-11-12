-- Preserve existing profiles while adding the fields used by account registration.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS cpf text,
    ADD COLUMN IF NOT EXISTS birth_date date;
