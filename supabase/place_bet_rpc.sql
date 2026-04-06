-- Secure Database Function to place a bet, ensuring thread-safe points deduction
-- This prevents race conditions if a user clicks rapidly!

CREATE OR REPLACE FUNCTION place_fan_bet(
  p_user_id UUID,
  p_bet_id UUID,
  p_selected_option TEXT,
  p_points_wagered INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated privileges to safely mutate tables
AS $$
DECLARE
  v_user_points INTEGER;
  v_bet_status TEXT;
  v_new_points INTEGER;
BEGIN
  -- 1. Validate Points
  IF p_points_wagered <= 0 THEN
    RAISE EXCEPTION 'Wager must be strictly positive.';
  END IF;

  -- 2. Validate Bet Status
  SELECT status INTO v_bet_status 
  FROM public.bets WHERE id = p_bet_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bet does not exist.';
  END IF;

  IF v_bet_status != 'open' THEN
    RAISE EXCEPTION 'Bet is no longer open (Current status: %).', v_bet_status;
  END IF;

  -- 3. Lock user row to prevent concurrent deduction issues
  SELECT points INTO v_user_points 
  FROM public.users WHERE id = p_user_id FOR UPDATE;

  IF v_user_points < p_points_wagered THEN
    RAISE EXCEPTION 'Insufficient points. Have %, need %.', v_user_points, p_points_wagered;
  END IF;

  -- 4. Deduct Points
  v_new_points := v_user_points - p_points_wagered;
  UPDATE public.users SET points = v_new_points WHERE id = p_user_id;

  -- 5. Insert User Bet
  -- Returns an error automatically ifUNIQUE(user_id, bet_id) is violated
  INSERT INTO public.user_bets(user_id, bet_id, selected_option, points_wagered, status)
  VALUES (p_user_id, p_bet_id, p_selected_option, p_points_wagered, 'pending');

  -- Return Success
  RETURN json_build_object('success', true, 'newBalance', v_new_points);
END;
$$;
