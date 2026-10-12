-- Yauga Token (Solana devnet). Treasury secret is service-role only.

ALTER TABLE public.points_ledger DROP CONSTRAINT IF EXISTS points_ledger_reason_check;
ALTER TABLE public.points_ledger ADD CONSTRAINT points_ledger_reason_check
  CHECK (
    reason IN (
      'booked',
      'attended',
      'bonus',
      'adjustment',
      'referral',
      'redemption',
      'share',
      'shop_order',
      'wellness_streak',
      'vitality_verified',
      'daily_workout',
      'meditation',
      'token_conversion'
    )
  );

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS solana_wallet text;

COMMENT ON COLUMN public.user_profiles.solana_wallet IS
  'Verified Solana public key. Set only by the yauga-token edge function.';

CREATE OR REPLACE FUNCTION public.protect_solana_wallet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF NEW.solana_wallet IS NOT NULL AND NEW.solana_wallet IS DISTINCT FROM OLD.solana_wallet THEN
    RAISE EXCEPTION 'Connect a wallet from My Wallet';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_solana_wallet ON public.user_profiles;
CREATE TRIGGER protect_solana_wallet
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_solana_wallet();

INSERT INTO public.settings (key, value, description) VALUES
  ('yauga_token_enabled', 'false', 'When true, members can connect a Solana wallet and convert points on devnet'),
  ('yauga_token_network', 'devnet', 'Phase 1 is devnet only. The edge function rejects any other value'),
  ('yauga_token_points_per_token', '100', 'Whole Yauga points required for 1 token'),
  ('yauga_token_min_points', '500', 'Minimum point balance before a member can convert'),
  ('yauga_token_mint_address', '', 'SPL mint address on devnet. Empty until Create token succeeds'),
  ('yauga_token_treasury_public', '', 'Treasury public key that pays fees and holds mint authority'),
  ('yauga_token_name', 'Yauga', 'On-chain token name (max 32)'),
  ('yauga_token_symbol', 'YAUGA', 'On-chain token symbol (max 10)'),
  ('yauga_token_description', 'Yauga loyalty token. Devnet only.', 'Shown in the metadata JSON wallets fetch'),
  ('yauga_token_image_url', '', 'HTTPS image URL stored in token metadata'),
  ('yauga_token_metadata_uri', '', 'HTTPS JSON metadata URI written on the mint')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.yauga_token_secrets (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret_key text NOT NULL,
  public_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.yauga_token_secrets ENABLE ROW LEVEL SECURITY;
-- No policies. service_role bypasses RLS. The browser cannot read the secret.

CREATE TABLE IF NOT EXISTS public.token_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text NOT NULL,
  tokens integer NOT NULL CHECK (tokens > 0),
  points_spent integer NOT NULL CHECK (points_spent > 0),
  points_per_token integer NOT NULL CHECK (points_per_token > 0),
  destination text NOT NULL,
  mint_address text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'submitted', 'confirmed', 'failed')),
  signature text,
  error text,
  ledger_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_conversions_user_email
  ON public.token_conversions (lower(user_email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_conversions_status
  ON public.token_conversions (status);

DROP TRIGGER IF EXISTS update_token_conversions_updated_at ON public.token_conversions;
CREATE TRIGGER update_token_conversions_updated_at
  BEFORE UPDATE ON public.token_conversions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.token_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own token conversions" ON public.token_conversions;
CREATE POLICY "Users read own token conversions"
  ON public.token_conversions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR lower(user_email) = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "Admins read token conversions" ON public.token_conversions;
CREATE POLICY "Admins read token conversions"
  ON public.token_conversions FOR SELECT
  TO authenticated
  USING (check_user_is_admin());

INSERT INTO storage.buckets (id, name, public)
VALUES ('token-metadata', 'token-metadata', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read token metadata" ON storage.objects;
CREATE POLICY "Public read token metadata"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'token-metadata');

-- Member starts a conversion. Points leave the ledger immediately.
CREATE OR REPLACE FUNCTION public.begin_token_conversion(p_tokens integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_dest text;
  v_enabled text;
  v_network text;
  v_mint text;
  v_rate integer;
  v_min integer;
  v_balance integer;
  v_cost integer;
  v_id uuid;
  v_ledger_id uuid;
BEGIN
  v_user_id := auth.uid();
  v_email := auth.jwt() ->> 'email';
  IF v_user_id IS NULL OR v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_tokens IS NULL OR p_tokens < 1 OR p_tokens > 1000000 THEN
    RAISE EXCEPTION 'Enter a whole number of tokens';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(lower(v_email)), 424242);

  SELECT solana_wallet INTO v_dest
  FROM user_profiles
  WHERE user_id = v_user_id;
  IF v_dest IS NULL OR btrim(v_dest) = '' THEN
    RAISE EXCEPTION 'Connect a wallet first';
  END IF;

  SELECT value INTO v_enabled FROM settings WHERE key = 'yauga_token_enabled';
  IF coalesce(v_enabled, 'false') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Yauga Token is disabled';
  END IF;

  SELECT value INTO v_network FROM settings WHERE key = 'yauga_token_network';
  IF coalesce(v_network, 'devnet') IS DISTINCT FROM 'devnet' THEN
    RAISE EXCEPTION 'Yauga Token is devnet only';
  END IF;

  SELECT nullif(btrim(value), '') INTO v_mint FROM settings WHERE key = 'yauga_token_mint_address';
  IF v_mint IS NULL THEN
    RAISE EXCEPTION 'Yauga Token has not been created';
  END IF;

  SELECT coalesce(nullif(btrim(value), '')::integer, 0) INTO v_rate
  FROM settings WHERE key = 'yauga_token_points_per_token';
  SELECT coalesce(nullif(btrim(value), '')::integer, 500) INTO v_min
  FROM settings WHERE key = 'yauga_token_min_points';
  IF v_rate IS NULL OR v_rate < 1 THEN
    RAISE EXCEPTION 'Exchange rate is not configured';
  END IF;
  IF v_min IS NULL OR v_min < 1 THEN
    v_min := 500;
  END IF;

  v_cost := p_tokens * v_rate;

  SELECT coalesce(sum(delta), 0) INTO v_balance
  FROM points_ledger
  WHERE lower(user_email) = lower(v_email);

  IF v_balance < v_min THEN
    RAISE EXCEPTION 'You need at least % points to convert', v_min;
  END IF;
  IF v_balance < v_cost THEN
    RAISE EXCEPTION 'Insufficient points';
  END IF;

  INSERT INTO token_conversions (
    user_id, user_email, tokens, points_spent, points_per_token, destination, mint_address, status
  ) VALUES (
    v_user_id, v_email, p_tokens, v_cost, v_rate, v_dest, v_mint, 'pending'
  ) RETURNING id INTO v_id;

  INSERT INTO points_ledger (user_id, user_email, event_id, delta, reason, awarded_by, notes)
  VALUES (
    v_user_id,
    v_email,
    NULL,
    -v_cost,
    'token_conversion',
    NULL,
    format('Yauga Token pending: %s tokens to %s', p_tokens, v_dest)
  ) RETURNING id INTO v_ledger_id;

  UPDATE token_conversions SET ledger_entry_id = v_ledger_id WHERE id = v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_token_conversion(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_token_conversion(integer) TO authenticated;

-- Service role only. Moves pending → sending so two workers cannot mint twice.
CREATE OR REPLACE FUNCTION public.claim_token_conversion(p_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.token_conversions;
BEGIN
  UPDATE token_conversions
  SET status = 'sending'
  WHERE id = p_id
    AND user_id = p_user_id
    AND status = 'pending'
  RETURNING * INTO v_row;
  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'row', to_jsonb(v_row));
  END IF;
  SELECT * INTO v_row FROM token_conversions WHERE id = p_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'row', NULL);
  END IF;
  RETURN jsonb_build_object('claimed', false, 'row', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_token_conversion_submitted(p_id uuid, p_signature text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE token_conversions
  SET status = 'submitted', signature = p_signature, error = NULL
  WHERE id = p_id AND status IN ('sending', 'submitted', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_token_conversion(p_id uuid, p_signature text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row token_conversions;
BEGIN
  UPDATE token_conversions
  SET status = 'confirmed', signature = coalesce(p_signature, signature), error = NULL
  WHERE id = p_id AND status IN ('pending', 'sending', 'submitted')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_row.ledger_entry_id IS NOT NULL THEN
    UPDATE points_ledger
    SET notes = format(
      'Yauga Token: %s tokens to %s. %s',
      v_row.tokens,
      v_row.destination,
      coalesce(p_signature, v_row.signature, '')
    )
    WHERE id = v_row.ledger_entry_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_token_conversion(p_id uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row token_conversions;
BEGIN
  UPDATE token_conversions
  SET status = 'failed', error = left(coalesce(p_error, 'Transfer failed'), 500)
  WHERE id = p_id AND status IN ('pending', 'sending')
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- submitted rows have a signature. Do not refund those here.
  INSERT INTO points_ledger (user_id, user_email, event_id, delta, reason, awarded_by, notes)
  VALUES (
    v_row.user_id,
    v_row.user_email,
    NULL,
    v_row.points_spent,
    'token_conversion',
    NULL,
    format('Yauga Token conversion failed — %s points returned', v_row.points_spent)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_token_conversion(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_token_conversion_submitted(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_token_conversion(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_token_conversion(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_token_conversion(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_token_conversion_submitted(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_token_conversion(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_token_conversion(uuid, text) TO service_role;
