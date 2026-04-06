const state = {
  data: null,
  live: null,
  selectedSeason: "all",
  selectedTeam: "",
  fanBets: null,
  auth: {
    initialized: false,
    mode: "signin",
    session: null,
    user: null,
    leaderboard: [],
  },
};

const elements = {
  seasonSelect: document.getElementById("seasonSelect"),
  teamSelect: document.getElementById("teamSelect"),
  dataStatus: document.getElementById("dataStatus"),
  liveStatusBanner: document.getElementById("liveStatusBanner"),
  liveSummaryGrid: document.getElementById("liveSummaryGrid"),
  liveTable: document.getElementById("liveTable"),
  liveSpotlight: document.getElementById("liveSpotlight"),
  liveOddsPanel: document.getElementById("liveOddsPanel"),
  liveMatchPanel: document.getElementById("liveMatchPanel"),
  livePlayerTable: document.getElementById("livePlayerTable"),
  livePlayerSectionTitle: document.getElementById("livePlayerSectionTitle"),
  resultsBand: document.getElementById("resultsBand"),
  summaryGrid: document.getElementById("summaryGrid"),
  teamTable: document.getElementById("teamTable"),
  teamSpotlight: document.getElementById("teamSpotlight"),
  insightPanel: document.getElementById("insightPanel"),
  playerTable: document.getElementById("playerTable"),
  playerSectionTitle: document.getElementById("playerSectionTitle"),
  loadingTemplate: document.getElementById("loadingTemplate"),
  oddsTeamSelect: document.getElementById("oddsTeamSelect"),
  fanBetsBalance: document.getElementById("fanBetsBalance"),
  fanBetsLeaderboard: document.getElementById("fanBetsLeaderboard"),
  fanBetsScoreboard: document.getElementById("fanBetsScoreboard"),
  fanBetsMarkets: document.getElementById("fanBetsMarkets"),
  fanBetsActive: document.getElementById("fanBetsActive"),
  fanBetsResults: document.getElementById("fanBetsResults"),
  authIdentity: document.getElementById("authIdentity"),
  authSignInButton: document.getElementById("authSignInButton"),
  authRegisterButton: document.getElementById("authRegisterButton"),
  authModal: document.getElementById("authModal"),
  authCloseButton: document.getElementById("authCloseButton"),
  authModalTitle: document.getElementById("authModalTitle"),
  authModalCopy: document.getElementById("authModalCopy"),
  authForm: document.getElementById("authForm"),
  authDisplayNameField: document.getElementById("authDisplayNameField"),
  authDisplayNameInput: document.getElementById("authDisplayName"),
  authEmailInput: document.getElementById("authEmail"),
  authPasswordInput: document.getElementById("authPassword"),
  authSubmitButton: document.getElementById("authSubmitButton"),
  authFeedback: document.getElementById("authFeedback"),
  authSwitchButton: document.getElementById("authSwitchButton"),
};

const FAN_BETS_STORAGE_PREFIX = "ipl-fan-bets-v2";
const LEGACY_FAN_BETS_STORAGE_KEY = "ipl-fan-bets-v1";
const FAN_BETS_STARTING_POINTS = 1000;
const FAN_BETS_DEFAULT_STAKE = 100;
const PROFILE_KDF_ITERATIONS = 210000;
const LEADERBOARD_LIMIT = 5;
const FAN_BETS_LEADERBOARD_SEED = [
  { name: "Powerplay Pro", points: 1980 },
  { name: "Yorker Queen", points: 1840 },
  { name: "Midwicket Mind", points: 1710 },
  { name: "Chase Master", points: 1635 },
];
let fanBetsSyncQueue = Promise.resolve();

bootstrap();

function bootstrap() {
  state.fanBets = loadFanBetsState();
  setupFanBetsInteractions();
  setupAuthInteractions();
  renderAuthNav();

  if (window.IPLLiveLayer) {
    window.IPLLiveLayer.init({
      state,
      elements,
      onTeamSelect: (team) => {
        state.selectedTeam = team;
        if (elements.teamSelect) {
          elements.teamSelect.value = team;
        }
        if (elements.oddsTeamSelect) {
          elements.oddsTeamSelect.value = team;
        }
        render();
      },
      onRefresh: render,
    });
  }

  setupNavigation();
  render();
  void initializeAuth();

  const worker = new Worker("analyticsWorker.js?v=" + Date.now());
  worker.onerror = (e) => {
    elements.dataStatus.textContent = `Worker failed to launch: ${e.message || "Unknown error"}`;
  };
  worker.postMessage({ type: "load" });

  worker.addEventListener("message", (event) => {
    const { type, payload, message } = event.data;
    if (type === "status") {
      elements.dataStatus.textContent = message;
      return;
    }

    if (type === "error") {
      elements.dataStatus.textContent = `Unable to load analytics: ${message}`;
      elements.teamSpotlight.innerHTML = `<p class="narrative">${message}</p>`;
      return;
    }

    if (type === "ready") {
      state.data = payload;
      state.selectedTeam = state.selectedTeam || payload.teams[0];
      setupControls();
      render();
      elements.dataStatus.textContent = "Analytics ready. Switch season views or focus on any team.";
    }
  });
}

function setupControls() {
  const seasonOptions = [
    { value: "all", label: "All seasons (2023-2025)" },
    ...state.data.seasons.map((season) => ({ value: String(season), label: String(season) })),
  ];
  elements.seasonSelect.innerHTML = seasonOptions
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  const teamOptions = state.data.teams
    .map((team) => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`)
    .join("");
  
  elements.teamSelect.innerHTML = teamOptions;
  if (elements.oddsTeamSelect) {
    elements.oddsTeamSelect.innerHTML = teamOptions;
    elements.oddsTeamSelect.value = state.selectedTeam || state.data.teams[0];
  }

  elements.seasonSelect.addEventListener("change", (event) => {
    state.selectedSeason = event.target.value;
    render();
  });

  elements.teamSelect.addEventListener("change", (event) => {
    state.selectedTeam = event.target.value;
    if (elements.oddsTeamSelect) elements.oddsTeamSelect.value = state.selectedTeam;
    render();
  });

  if (elements.oddsTeamSelect) {
    elements.oddsTeamSelect.addEventListener("change", (event) => {
      state.selectedTeam = event.target.value;
      if (elements.teamSelect) elements.teamSelect.value = state.selectedTeam;
      render();
    });
  }
}

function setupNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });
}

function getFanBetsStorageKey(userId) {
  return `${FAN_BETS_STORAGE_PREFIX}:${userId || "guest"}`;
}

function loadFanBetsState(userId = null) {
  try {
    const raw =
      window.localStorage.getItem(getFanBetsStorageKey(userId)) ||
      (!userId ? window.localStorage.getItem(LEGACY_FAN_BETS_STORAGE_KEY) : null);
    if (!raw) {
      return createDefaultFanBetsState();
    }
    const parsed = JSON.parse(raw);
    return {
      user: {
        ...createDefaultFanBetsState().user,
        ...(parsed.user || {}),
      },
      bets: Array.isArray(parsed.bets) ? parsed.bets.map(normalizeFanBetSlip) : [],
      settled: Array.isArray(parsed.settled) ? parsed.settled.map(normalizeFanBetSlip) : [],
      marketBaselines: parsed.marketBaselines && typeof parsed.marketBaselines === "object" ? parsed.marketBaselines : {},
    };
  } catch (error) {
    return createDefaultFanBetsState();
  }
}

function createDefaultFanBetsState(userOverride = {}) {
  return {
    user: {
      id: userOverride.id || null,
      name: userOverride.name || "Guest",
      balance: FAN_BETS_STARTING_POINTS,
      registeredAt: Date.now(),
      totalPlaced: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      ...userOverride,
    },
    bets: [],
    settled: [],
    marketBaselines: {},
  };
}

function saveFanBetsState(targetState = state.fanBets, userId = state.auth.user?.id || null) {
  if (!targetState) {
    return;
  }
  window.localStorage.setItem(getFanBetsStorageKey(userId), JSON.stringify(targetState));
}

function normalizeFanBetSlip(slip) {
  return {
    id: slip.id,
    marketId: slip.marketId,
    matchId: slip.matchId,
    matchName: slip.matchName,
    title: slip.title,
    optionId: slip.optionId,
    optionLabel: slip.optionLabel,
    stake: numberValue(slip.stake),
    payoutMultiplier: numberValue(slip.payoutMultiplier || 1),
    placedAt: numberValue(slip.placedAt || Date.now()),
    status: slip.status || "active",
    badge: slip.badge || "Fan Bet",
    result: slip.result || null,
    payout: numberValue(slip.payout),
    netPoints: numberValue(slip.netPoints),
    resolvedAt: slip.resolvedAt ? numberValue(slip.resolvedAt) : null,
    resultLabel: slip.resultLabel || "",
    marketType: slip.marketType || "custom",
  };
}

function setupFanBetsInteractions() {
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-place-bet]");
    if (!trigger) {
      return;
    }
    void placeFanBet(
      trigger.getAttribute("data-market-id"),
      trigger.getAttribute("data-option-id"),
      numberValue(trigger.getAttribute("data-stake") || FAN_BETS_DEFAULT_STAKE)
    );
  });

  document.addEventListener("click", (event) => {
    const authTrigger = event.target.closest("[data-open-auth]");
    if (!authTrigger) {
      return;
    }
    openAuthModal(authTrigger.getAttribute("data-open-auth") || "register");
  });
}

function setupAuthInteractions() {
  elements.authSignInButton?.addEventListener("click", () => {
    if (state.auth.user) {
      void signOutCurrentUser();
      return;
    }
    openAuthModal("signin");
  });
  elements.authRegisterButton?.addEventListener("click", () => openAuthModal("register"));
  elements.authCloseButton?.addEventListener("click", closeAuthModal);
  elements.authSwitchButton?.addEventListener("click", () => {
    setAuthMode(state.auth.mode === "signin" ? "register" : "signin");
  });
  elements.authForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitAuthForm();
  });
  elements.authModal?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.authClose === "true") {
      closeAuthModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.authModal && !elements.authModal.hidden) {
      closeAuthModal();
    }
  });
}

function openAuthModal(mode = "signin") {
  if (!elements.authModal) {
    return;
  }
  setAuthMode(mode);
  setAuthFeedback("");
  elements.authModal.hidden = false;
  requestAnimationFrame(() => {
    if (state.auth.mode === "register") {
      elements.authDisplayNameInput?.focus();
    } else {
      elements.authEmailInput?.focus();
    }
  });
}

function closeAuthModal() {
  if (!elements.authModal) {
    return;
  }
  elements.authModal.hidden = true;
  setAuthFeedback("");
}

function setAuthMode(mode) {
  state.auth.mode = mode === "register" ? "register" : "signin";
  const registering = state.auth.mode === "register";
  if (elements.authDisplayNameField) {
    elements.authDisplayNameField.hidden = !registering;
  }
  if (elements.authModalTitle) {
    elements.authModalTitle.textContent = registering ? "Register your fan wallet" : "Sign in to your wallet";
  }
  if (elements.authModalCopy) {
    elements.authModalCopy.textContent = registering
      ? "Create an account to claim 1,000 fan points. Your profile payload is encrypted before it is saved in Supabase."
      : "Sign back in to sync your points, active slips, and settled results from Supabase.";
  }
  if (elements.authSubmitButton) {
    elements.authSubmitButton.textContent = registering ? "Create account" : "Sign in";
  }
  if (elements.authSwitchButton) {
    elements.authSwitchButton.textContent = registering ? "Already registered? Sign in" : "New here? Create an account";
  }
  if (elements.authPasswordInput) {
    elements.authPasswordInput.autocomplete = registering ? "new-password" : "current-password";
  }
}

function setAuthFeedback(message, tone = "") {
  if (!elements.authFeedback) {
    return;
  }
  elements.authFeedback.textContent = message;
  elements.authFeedback.className = "auth-feedback";
  if (tone) {
    elements.authFeedback.classList.add(`is-${tone}`);
  }
}

function setAuthBusy(busy) {
  if (elements.authSubmitButton) elements.authSubmitButton.disabled = busy;
  if (elements.authEmailInput) elements.authEmailInput.disabled = busy;
  if (elements.authPasswordInput) elements.authPasswordInput.disabled = busy;
  if (elements.authDisplayNameInput) elements.authDisplayNameInput.disabled = busy;
}

function renderAuthNav() {
  if (!elements.authIdentity || !elements.authSignInButton || !elements.authRegisterButton) {
    return;
  }

  if (state.auth.user) {
    elements.authIdentity.innerHTML = `
      <strong>${escapeHtml(state.fanBets?.user?.name || deriveDisplayName(state.auth.user.email))}</strong>
      <small>${formatPoints(state.fanBets?.user?.balance)} synced to Supabase</small>
    `;
    elements.authSignInButton.textContent = "Sign out";
    elements.authRegisterButton.hidden = true;
    return;
  }

  elements.authIdentity.innerHTML = `
    <strong>Guest mode</strong>
    <small>Register to claim ${formatPoints(FAN_BETS_STARTING_POINTS)}</small>
  `;
  elements.authSignInButton.textContent = "Sign in";
  elements.authRegisterButton.hidden = false;
}

function getSupabaseClient() {
  return window.supabaseClient || null;
}

async function initializeAuth() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient?.auth) {
    setAuthFeedback("Supabase is not available in this browser session.", "error");
    state.auth.leaderboard = FAN_BETS_LEADERBOARD_SEED.map((entry) => ({ ...entry }));
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("Unable to restore the Supabase session.", error);
  }

  try {
    if (data?.session?.user) {
      await hydrateAuthenticatedUser(data.session.user);
    } else {
      await refreshLeaderboard();
      renderAuthNav();
      render();
    }
  } catch (sessionError) {
    handleAuthSyncFailure(sessionError);
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    void handleSupabaseSessionChange(session);
  });
  state.auth.initialized = true;
}

async function handleSupabaseSessionChange(session) {
  if (session?.user) {
    try {
      await hydrateAuthenticatedUser(session.user);
    } catch (sessionError) {
      handleAuthSyncFailure(sessionError);
    }
    return;
  }

  state.auth.session = null;
  state.auth.user = null;
  state.fanBets = loadFanBetsState();
  renderAuthNav();
  await refreshLeaderboard();
  render();
}

function handleAuthSyncFailure(error) {
  console.error("Supabase auth sync failed.", error);
  state.auth.session = null;
  state.auth.user = null;
  state.fanBets = loadFanBetsState();
  state.auth.leaderboard = FAN_BETS_LEADERBOARD_SEED.map((entry) => ({ ...entry }));
  renderAuthNav();
  render();
  setAuthFeedback("Supabase is reachable, but the Fan Bets tables are missing. Run supabase/fan_bets_schema.sql in your project first.", "error");
}

async function hydrateAuthenticatedUser(authUser) {
  state.auth.user = authUser;
  state.auth.session = { user: authUser };
  await ensureRemoteUserProfile(authUser);
  state.fanBets = await fetchRemoteFanBetsState(authUser);
  saveFanBetsState(state.fanBets, authUser.id);
  renderAuthNav();
  await refreshLeaderboard();
  render();
}

async function submitAuthForm() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient?.auth) {
    setAuthFeedback("Supabase auth is not available right now.", "error");
    return;
  }

  const email = String(elements.authEmailInput?.value || "").trim().toLowerCase();
  const password = String(elements.authPasswordInput?.value || "");
  const displayName = String(elements.authDisplayNameInput?.value || "").trim();
  const registering = state.auth.mode === "register";

  if (!email || !password) {
    setAuthFeedback("Email and password are required.", "error");
    return;
  }
  if (registering && !displayName) {
    setAuthFeedback("Choose the display name you want on the leaderboard.", "error");
    return;
  }

  setAuthBusy(true);
  setAuthFeedback(registering ? "Creating your fan wallet..." : "Signing you in...");

  try {
    if (registering) {
      const encryptedProfile = await encryptProfilePayload(
        {
          displayName,
          email,
          createdAt: new Date().toISOString(),
        },
        password
      );

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
            encrypted_profile: encryptedProfile.ciphertext,
            profile_iv: encryptedProfile.iv,
            profile_salt: encryptedProfile.salt,
            profile_kdf_iterations: PROFILE_KDF_ITERATIONS,
          },
        },
      });

      if (error) {
        throw error;
      }

      if (data.session?.user) {
        await hydrateAuthenticatedUser(data.session.user);
        closeAuthModal();
      } else {
        setAuthFeedback("Account created. Confirm your email if Supabase asks for it, then sign in.", "success");
        setAuthMode("signin");
        if (elements.authEmailInput) elements.authEmailInput.value = email;
        if (elements.authPasswordInput) elements.authPasswordInput.value = "";
        return;
      }
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        throw error;
      }
      closeAuthModal();
    }
  } catch (error) {
    setAuthFeedback(error.message || "Unable to complete the auth request.", "error");
    return;
  } finally {
    setAuthBusy(false);
  }

  elements.authForm?.reset();
  setAuthMode("signin");
}

async function signOutCurrentUser() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient?.auth) {
    return;
  }
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    window.alert(error.message || "Unable to sign out right now.");
  }
}

async function ensureRemoteUserProfile(authUser) {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !authUser?.id) {
    return null;
  }

  const { data: existing, error } = await supabaseClient
    .from("users")
    .select("id, display_name, username, points, total_placed, total_bets, wins, losses, pushes, created_at")
    .eq("id", authUser.id)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (existing) {
    return existing;
  }

  const metadata = authUser.user_metadata || {};
  const displayName = metadata.display_name || deriveDisplayName(authUser.email);
  const payload = {
    id: authUser.id,
    username: displayName,
    email: authUser.email || "",
    display_name: displayName,
    email_hash: await sha256Hex(String(authUser.email || "").toLowerCase()),
    encrypted_profile: metadata.encrypted_profile || "",
    profile_iv: metadata.profile_iv || "",
    profile_salt: metadata.profile_salt || "",
    profile_kdf_iterations: Number(metadata.profile_kdf_iterations) || PROFILE_KDF_ITERATIONS,
    points: FAN_BETS_STARTING_POINTS,
    total_placed: 0,
    total_bets: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
  };

  const { error: insertError } = await supabaseClient.from("users").upsert(payload, { onConflict: "id" });
  if (insertError) {
    throw insertError;
  }

  return payload;
}

async function fetchRemoteFanBetsState(authUser) {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !authUser?.id) {
    return createDefaultFanBetsState();
  }

  const [{ data: userRow, error: userError }, { data: slipRows, error: slipError }] = await Promise.all([
    supabaseClient
      .from("users")
      .select("id, display_name, username, points, total_placed, total_bets, wins, losses, pushes, created_at")
      .eq("id", authUser.id)
      .single(),
    supabaseClient
      .from("fan_bet_slips")
      .select("*")
      .eq("user_id", authUser.id)
      .order("placed_at", { ascending: false }),
  ]);

  if (userError) {
    throw userError;
  }
  if (slipError) {
    throw slipError;
  }

  const nextState = createDefaultFanBetsState({
    id: authUser.id,
    name: userRow.display_name || userRow.username || deriveDisplayName(authUser.email),
    balance: numberValue(userRow.points || FAN_BETS_STARTING_POINTS),
    registeredAt: Date.parse(userRow.created_at || "") || Date.now(),
    totalPlaced: numberValue(userRow.total_placed ?? userRow.total_bets),
    wins: numberValue(userRow.wins),
    losses: numberValue(userRow.losses),
    pushes: numberValue(userRow.pushes),
  });

  const slips = Array.isArray(slipRows) ? slipRows.map(mapRemoteSlipToLocal) : [];
  nextState.bets = slips
    .filter((slip) => slip.status === "active")
    .sort((a, b) => b.placedAt - a.placedAt);
  nextState.settled = slips
    .filter((slip) => slip.status !== "active")
    .sort((a, b) => numberValue(b.resolvedAt || b.placedAt) - numberValue(a.resolvedAt || a.placedAt));

  return nextState;
}

function mapRemoteSlipToLocal(row) {
  return normalizeFanBetSlip({
    id: row.id,
    marketId: row.market_id,
    matchId: row.match_id,
    matchName: row.match_name,
    title: row.market_title,
    optionId: row.option_id,
    optionLabel: row.option_label,
    stake: row.stake,
    payoutMultiplier: row.payout_multiplier,
    placedAt: Date.parse(row.placed_at || "") || Date.now(),
    status: row.status,
    badge: row.market_badge,
    payout: row.payout,
    netPoints: row.net_points,
    resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : null,
    result: row.status === "active" ? null : row.status,
    resultLabel: buildResultLabel(row.status, row.payout, row.stake),
    marketType: row.market_type,
  });
}

function buildRemoteSlipPayload(bet) {
  return {
    id: bet.id,
    user_id: state.auth.user.id,
    market_id: bet.marketId,
    match_id: bet.matchId,
    match_name: bet.matchName,
    market_type: bet.marketType || "custom",
    market_title: bet.title,
    market_badge: bet.badge,
    option_id: bet.optionId,
    option_label: bet.optionLabel,
    stake: Math.round(numberValue(bet.stake)),
    payout_multiplier: numberValue(bet.payoutMultiplier),
    payout: Math.round(numberValue(bet.payout)),
    net_points: Math.round(numberValue(bet.netPoints)),
    status: bet.status,
    placed_at: new Date(numberValue(bet.placedAt)).toISOString(),
    resolved_at: bet.resolvedAt ? new Date(numberValue(bet.resolvedAt)).toISOString() : null,
  };
}

function buildRemoteUserPayload(authUser, fanUser) {
  return {
    id: authUser.id,
    username: fanUser.name,
    email: authUser.email || "",
    display_name: fanUser.name,
    points: Math.round(numberValue(fanUser.balance)),
    total_placed: Math.round(numberValue(fanUser.totalPlaced)),
    total_bets: Math.round(numberValue(fanUser.totalPlaced)),
    wins: Math.round(numberValue(fanUser.wins)),
    losses: Math.round(numberValue(fanUser.losses)),
    pushes: Math.round(numberValue(fanUser.pushes)),
    updated_at: new Date().toISOString(),
  };
}

async function refreshLeaderboard() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    state.auth.leaderboard = FAN_BETS_LEADERBOARD_SEED.map((entry) => ({ ...entry }));
    return;
  }

  const { data, error } = await supabaseClient
    .from("users")
    .select("id, display_name, username, points")
    .order("points", { ascending: false })
    .limit(LEADERBOARD_LIMIT);

  if (error || !data?.length) {
    state.auth.leaderboard = FAN_BETS_LEADERBOARD_SEED.map((entry) => ({ ...entry }));
    return;
  }

  state.auth.leaderboard = data.map((entry) => ({
    name: entry.display_name || entry.username || "Fan Player",
    points: numberValue(entry.points),
    isUser: entry.id === state.auth.user?.id,
  }));
}

function queueFanBetsSync(reason) {
  if (!state.auth.user) {
    saveFanBetsState();
    return Promise.resolve();
  }

  fanBetsSyncQueue = fanBetsSyncQueue
    .catch(() => null)
    .then(() => persistFanBetsState(reason));
  return fanBetsSyncQueue;
}

async function persistFanBetsState(_reason) {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !state.auth.user || !state.fanBets) {
    saveFanBetsState();
    return;
  }

  const slips = state.fanBets.bets.concat(state.fanBets.settled).map(buildRemoteSlipPayload);
  const operations = [
    supabaseClient.from("users").upsert(buildRemoteUserPayload(state.auth.user, state.fanBets.user), { onConflict: "id" }),
  ];
  if (slips.length) {
    operations.push(supabaseClient.from("fan_bet_slips").upsert(slips, { onConflict: "id" }));
  }

  const results = await Promise.all(operations);
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw failed.error;
  }

  saveFanBetsState(state.fanBets, state.auth.user.id);
  await refreshLeaderboard();
}

async function encryptProfilePayload(payload, password) {
  const encoder = new TextEncoder();
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await window.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PROFILE_KDF_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt"]
  );

  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoder.encode(JSON.stringify(payload))
  );

  return {
    ciphertext: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
  };
}

async function sha256Hex(value) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function arrayBufferToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function deriveDisplayName(email) {
  return String(email || "Fan Player")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Fan Player";
}

function cloneFanBetsState(fanBets) {
  return JSON.parse(JSON.stringify(fanBets));
}

function renderFanBets() {
  if (!elements.fanBetsBalance) {
    return;
  }

  const experience = buildFanBetsExperience(state.live);
  const settledBets = settleFanBetSlips(experience.marketMap);
  if (settledBets.length) {
    saveFanBetsState();
    void queueFanBetsSync("settled-slips").catch((error) => {
      console.error("Unable to sync settled slips to Supabase.", error);
    });
  }

  renderFanBetsBalance(experience);
  renderFanBetsLeaderboard();
  renderFanBetsScoreboard(experience);
  renderFanBetsMarkets(experience);
  renderFanBetsActive();
  renderFanBetsResults();
}

function buildFanBetsExperience(live) {
  const sortedMatches = live
    ? live.matches
        .slice()
        .sort(compareFanBetMatches)
    : [];
  const scoreboardMatches = sortedMatches.slice(0, 4);
  const featuredMatch = scoreboardMatches[0] || null;
  const markets = [];
  const marketMatches = new Map();

  scoreboardMatches.forEach((match) => {
    marketMatches.set(match.matchId, match);
  });
  state.fanBets.bets.forEach((bet) => {
    const source = sortedMatches.find((match) => match.matchId === bet.matchId);
    if (source) {
      marketMatches.set(source.matchId, source);
    }
  });

  Array.from(marketMatches.values()).forEach((match) => {
    markets.push(...buildMarketsForMatch(match, live));
  });
  state.fanBets.bets.forEach((bet) => {
    if (!markets.find((market) => market.id === bet.marketId)) {
      const trackedMarket = buildTrackedMarketForActiveBet(bet, live);
      if (trackedMarket) {
        markets.push(trackedMarket);
      }
    }
  });

  const marketMap = new Map(markets.map((market) => [market.id, market]));
  return {
    featuredMatch,
    scoreboardMatches,
    markets,
    marketMap,
  };
}

function compareFanBetMatches(a, b) {
  const rank = { Live: 0, UpComing: 1, Post: 2 };
  const delta = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
  if (delta !== 0) {
    return delta;
  }
  return numberValue(a.startTime) - numberValue(b.startTime);
}

function buildMarketsForMatch(match, live) {
  const markets = [];
  const teamAData = live?.table?.find((row) => row.team === match.teamA) || null;
  const teamBData = live?.table?.find((row) => row.team === match.teamB) || null;
  const topA = getTopLivePlayer(live, match.teamA);
  const topB = getTopLivePlayer(live, match.teamB);
  const firstScore = parseScoreSummary(match.firstSummary);
  const secondScore = parseScoreSummary(match.secondSummary);
  const totalRunsLine = generateTotalRunsLine(match, teamAData, teamBData);
  const totalRuns = numberValue(firstScore?.runs) + numberValue(secondScore?.runs);
  const winnerOutcome = resolveWinnerOutcome(match, firstScore, secondScore);
  const totalOutcome =
    match.status === "Post"
      ? totalRuns > totalRunsLine
        ? "over"
        : totalRuns < totalRunsLine
          ? "under"
          : "push"
      : null;

  markets.push({
    id: `winner-${match.matchId}`,
    matchId: match.matchId,
    matchName: match.matchName,
    type: "winner",
    title: `Who wins ${match.teamACode || initials(match.teamA)} vs ${match.teamBCode || initials(match.teamB)}?`,
    subtitle: "Locks when the first ball is bowled.",
    status: match.status === "UpComing" ? "open" : "locked",
    statusLabel: match.status === "UpComing" ? "Open" : winnerOutcome ? "Settled" : "Locked",
    lockNote: match.status === "UpComing" ? "Pre-match market" : "Match already underway",
    options: [
      { id: match.teamA, label: match.teamA, payoutMultiplier: 1.9 },
      { id: match.teamB, label: match.teamB, payoutMultiplier: 1.9 },
    ],
    outcome: winnerOutcome,
    badge: "Match Winner",
  });

  markets.push({
    id: `total-runs-${match.matchId}`,
    matchId: match.matchId,
    matchName: match.matchName,
    type: "total",
    title: `Total runs over or under ${totalRunsLine}?`,
    subtitle: "Calculated from recent scoring trends and live strength signals.",
    status: match.status === "UpComing" ? "open" : "locked",
    statusLabel: match.status === "UpComing" ? "Open" : totalOutcome ? "Settled" : "Locked",
    lockNote: match.status === "UpComing" ? "Pre-match total" : "Innings already started",
    options: [
      { id: "over", label: `Over ${totalRunsLine}`, payoutMultiplier: 1.85 },
      { id: "under", label: `Under ${totalRunsLine}`, payoutMultiplier: 1.85 },
    ],
    outcome: totalOutcome,
    badge: "Total Runs",
  });

  if (topA && topB) {
    const duelMarketId = `duel-${match.matchId}`;
    const duelBaseline =
      state.fanBets.marketBaselines[duelMarketId] ||
      createPlayerDuelBaseline(duelMarketId, topA, topB, live, match.status);
    const duelOutcome = resolvePlayerDuelOutcome(duelBaseline, live, match.status);

    markets.push({
      id: duelMarketId,
      matchId: match.matchId,
      matchName: match.matchName,
      type: "duel",
      title: "Who adds more match runs?",
      subtitle: `${topA.player} vs ${topB.player}`,
      status: match.status === "UpComing" ? "open" : "locked",
      statusLabel: match.status === "UpComing" ? "Open" : duelOutcome ? "Settled" : "Locked",
      lockNote: match.status === "UpComing" ? "Player duel" : "Lineups are live",
      options: [
        { id: duelBaseline.playerAKey, label: topA.player, payoutMultiplier: 2 },
        { id: duelBaseline.playerBKey, label: topB.player, payoutMultiplier: 2 },
      ],
      outcome: duelOutcome,
      badge: "Player Duel",
    });
  }

  const livePropMarket = buildNextWicketMarket(match);
  if (livePropMarket) {
    markets.push(livePropMarket);
  }

  return markets;
}

function createPlayerDuelBaseline(marketId, playerA, playerB, live, matchStatus) {
  const baseline = {
    type: "duel",
    playerAKey: buildPlayerKey(playerA.team, playerA.player),
    playerBKey: buildPlayerKey(playerB.team, playerB.player),
    playerAStartRuns: getPlayerRunsByKey(live, buildPlayerKey(playerA.team, playerA.player)),
    playerBStartRuns: getPlayerRunsByKey(live, buildPlayerKey(playerB.team, playerB.player)),
    createdAt: Date.now(),
    createdWhile: matchStatus,
  };
  state.fanBets.marketBaselines[marketId] = baseline;
  return baseline;
}

function buildNextWicketMarket(match) {
  if (match.status !== "Live") {
    return null;
  }

  const liveSummary = pickCurrentInningsSummary(match);
  if (!liveSummary || liveSummary.wickets >= 10 || liveSummary.overs >= 20) {
    return null;
  }

  const targetOver = Math.min(20, Math.ceil(liveSummary.overs || 0) + 2);
  const targetBalls = targetOver * 6;
  const marketId = `next-wicket-${match.matchId}-${match.currentInnings || 1}-${targetOver}`;
  const baseline =
    state.fanBets.marketBaselines[marketId] ||
    {
      type: "next-wicket",
      innings: match.currentInnings || 1,
      startWickets: liveSummary.wickets,
      startBalls: liveSummary.balls,
      targetOver,
      targetBalls,
      createdAt: Date.now(),
    };
  state.fanBets.marketBaselines[marketId] = baseline;

  const outcome = resolveNextWicketOutcome(match, baseline);
  const stillOpen = !outcome && liveSummary.balls < baseline.targetBalls;

  return {
    id: marketId,
    matchId: match.matchId,
    matchName: match.matchName,
    type: "live-prop",
    title: `When does the next wicket fall?`,
    subtitle: `Current over ${formatNumber(liveSummary.overs, 1)}. Predict the wicket window.`,
    status: stillOpen ? "open" : "locked",
    statusLabel: stillOpen ? "Live" : outcome ? "Settled" : "Locked",
    lockNote: stillOpen ? `Window closes at ${targetOver}.0 overs` : "Live window closed",
    options: [
      { id: "before", label: `Before ${targetOver}.0 overs`, payoutMultiplier: 2.1 },
      { id: "after", label: `${targetOver}.0 overs or later`, payoutMultiplier: 2.1 },
    ],
    outcome,
    badge: "Live Prop",
  };
}

function buildTrackedMarketForActiveBet(bet, live) {
  if (!bet || !String(bet.marketId).startsWith("next-wicket-")) {
    return null;
  }
  const match = (live?.matches || []).find((entry) => entry.matchId === bet.matchId);
  const baseline = state.fanBets.marketBaselines[bet.marketId];
  if (!match || !baseline) {
    return null;
  }
  return {
    id: bet.marketId,
    matchId: bet.matchId,
    matchName: bet.matchName,
    type: "live-prop",
    title: bet.title,
    subtitle: `Tracked live prop from ${formatDateTime(bet.placedAt)}.`,
    status: "locked",
    statusLabel: resolveNextWicketOutcome(match, baseline) ? "Settled" : "Locked",
    lockNote: `Window closed at ${baseline.targetOver}.0 overs`,
    options: [
      { id: "before", label: `Before ${baseline.targetOver}.0 overs`, payoutMultiplier: 2.1 },
      { id: "after", label: `${baseline.targetOver}.0 overs or later`, payoutMultiplier: 2.1 },
    ],
    outcome: resolveNextWicketOutcome(match, baseline),
    badge: "Live Prop",
  };
}

function resolveWinnerOutcome(match, firstScore, secondScore) {
  if (match.status !== "Post" || !firstScore || !secondScore) {
    return null;
  }
  if (secondScore.runs > firstScore.runs) {
    return match.teamB;
  }
  if (secondScore.runs < firstScore.runs) {
    return match.teamA;
  }
  return "push";
}

function resolvePlayerDuelOutcome(baseline, live, matchStatus) {
  if (!baseline || matchStatus !== "Post") {
    return null;
  }
  const aDelta = getPlayerRunsByKey(live, baseline.playerAKey) - numberValue(baseline.playerAStartRuns);
  const bDelta = getPlayerRunsByKey(live, baseline.playerBKey) - numberValue(baseline.playerBStartRuns);
  if (aDelta > bDelta) {
    return baseline.playerAKey;
  }
  if (bDelta > aDelta) {
    return baseline.playerBKey;
  }
  return "push";
}

function resolveNextWicketOutcome(match, baseline) {
  if (!baseline) {
    return null;
  }
  const summary = pickCurrentInningsSummary(match, baseline.innings);
  if (!summary) {
    return match.status === "Post" ? "after" : null;
  }
  if (summary.wickets > baseline.startWickets && summary.balls <= baseline.targetBalls) {
    return "before";
  }
  if (summary.balls >= baseline.targetBalls && summary.wickets === baseline.startWickets) {
    return "after";
  }
  if ((match.currentInnings || 1) > baseline.innings || match.status === "Post") {
    return summary.wickets > baseline.startWickets && summary.balls <= baseline.targetBalls ? "before" : "after";
  }
  if (summary.wickets > baseline.startWickets && summary.balls > baseline.targetBalls) {
    return "after";
  }
  return null;
}

async function placeFanBet(marketId, optionId, stake) {
  const experience = buildFanBetsExperience(state.live);
  const market = experience.marketMap.get(marketId);
  const fanBets = state.fanBets;

  if (!state.auth.user) {
    openAuthModal("register");
    setAuthFeedback("Register or sign in to place bets with your 1,000 starting points.", "success");
    return;
  }
  if (!market || market.status !== "open") {
    window.alert("That market is locked or no longer available.");
    return;
  }
  if (fanBets.bets.some((bet) => bet.marketId === marketId && bet.status === "active")) {
    window.alert("You already have an active slip on this market.");
    return;
  }
  if (fanBets.user.balance < stake) {
    window.alert("Not enough fan points for that pick yet.");
    return;
  }

  const option = market.options.find((entry) => entry.id === optionId);
  if (!option) {
    return;
  }

  const previousState = cloneFanBetsState(fanBets);
  fanBets.user.balance -= stake;
  fanBets.user.totalPlaced += 1;
  fanBets.bets.unshift({
    id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    marketId,
    matchId: market.matchId,
    matchName: market.matchName,
    title: market.title,
    optionId,
    optionLabel: option.label,
    stake,
    payoutMultiplier: option.payoutMultiplier,
    placedAt: Date.now(),
    status: "active",
    badge: market.badge,
    marketType: market.type,
  });
  saveFanBetsState();
  render();

  try {
    await queueFanBetsSync("place-bet");
  } catch (error) {
    state.fanBets = previousState;
    saveFanBetsState();
    render();
    window.alert(error.message || "Unable to save that bet to Supabase.");
  }
}

function settleFanBetSlips(marketMap) {
  const settled = [];

  state.fanBets.bets.forEach((bet) => {
    if (bet.status !== "active") {
      return;
    }
    const market = marketMap.get(bet.marketId);
    if (!market || !market.outcome) {
      return;
    }

    const result =
      market.outcome === "push"
        ? "push"
        : market.outcome === bet.optionId
          ? "win"
          : "loss";
    const payout =
      result === "win"
        ? Math.round(bet.stake * numberValue(bet.payoutMultiplier))
        : result === "push"
          ? bet.stake
          : 0;

    if (payout) {
      state.fanBets.user.balance += payout;
    }
    if (result === "win") {
      state.fanBets.user.wins += 1;
    } else if (result === "loss") {
      state.fanBets.user.losses += 1;
    } else {
      state.fanBets.user.pushes += 1;
    }

    const settledBet = {
      ...bet,
      resolvedAt: Date.now(),
      result,
      status: result,
      payout,
      netPoints: payout - bet.stake,
      resultLabel: buildResultLabel(result, payout, bet.stake),
    };
    state.fanBets.settled.unshift(settledBet);
    bet.status = result;
    settled.push(settledBet);
  });

  if (settled.length) {
    state.fanBets.bets = state.fanBets.bets.filter((bet) => bet.status === "active");
  }

  return settled;
}

function buildResultLabel(result, payout, stake) {
  if (result === "win") {
    return `Won ${formatPoints(payout)}`;
  }
  if (result === "push") {
    return `Push refunded ${formatPoints(payout)}`;
  }
  return `Lost ${formatPoints(stake)}`;
}

function renderFanBetsBalance(experience) {
  const user = state.fanBets.user;
  const liveCount = experience.scoreboardMatches.filter((match) => match.status === "Live").length;
  elements.fanBetsBalance.innerHTML = `
    <div class="fan-bets-balance-head">
      <div>
        <p class="section-kicker">Fan Wallet</p>
        <h2>${formatPoints(user.balance)}</h2>
      </div>
      <span class="fan-bet-chip">${liveCount ? `${liveCount} live market${liveCount > 1 ? "s" : ""}` : "Fun mode"}</span>
    </div>
    <p class="narrative">${state.auth.user
      ? `${escapeHtml(user.name)} is signed in. Your fan points, slips, and results are now synced to Supabase.`
      : `Every new account starts with ${formatPoints(FAN_BETS_STARTING_POINTS)}. Register to save your wallet, bets, and results in Supabase.`}</p>
    <div class="fan-bets-stat-row">
      <div class="mini-stat">
        <span>Slips placed</span>
        <strong>${user.totalPlaced}</strong>
      </div>
      <div class="mini-stat">
        <span>Wins</span>
        <strong>${user.wins}</strong>
      </div>
      <div class="mini-stat">
        <span>Losses</span>
        <strong>${user.losses}</strong>
      </div>
    </div>
    <div class="wallet-cta-row">
      ${state.auth.user
        ? `<span class="wallet-status-pill">Account synced</span><small>Encrypted profile data lives in Supabase while your fan wallet stays linked to this login.</small>`
        : `<button class="wallet-cta-btn" type="button" data-open-auth="register">Register and unlock ${formatPoints(FAN_BETS_STARTING_POINTS)}</button><small>Sign in is required before you can place or sync Fan Bets.</small>`}
    </div>
  `;
}

function renderFanBetsLeaderboard() {
  const leaders = (state.auth.leaderboard?.length
    ? state.auth.leaderboard
    : FAN_BETS_LEADERBOARD_SEED.map((entry) => ({ ...entry })))
    .slice(0, LEADERBOARD_LIMIT);

  elements.fanBetsLeaderboard.innerHTML = `
    <p class="section-kicker">Leaderboard</p>
    <h2>Fan points table</h2>
    <ol class="fan-leaderboard-list">
      ${leaders
        .map(
          (entry, index) => `
            <li class="${entry.isUser ? "is-user" : ""}">
              <span>${index + 1}. ${escapeHtml(entry.name)}</span>
              <strong>${formatPoints(entry.points)}</strong>
            </li>
          `
        )
        .join("")}
    </ol>
  `;
}

function renderFanBetsScoreboard(experience) {
  const featured = experience.featuredMatch;
  if (!featured) {
    elements.fanBetsScoreboard.innerHTML = `
      <p class="section-kicker">Live Board</p>
      <h2>Waiting for the official feed</h2>
      <p class="narrative">Fan Bets wakes up as soon as live or upcoming IPL fixtures arrive in the current season feed.</p>
    `;
    return;
  }

  elements.fanBetsScoreboard.innerHTML = `
    <div class="fan-bets-scoreboard-main">
      <div>
        <p class="section-kicker">Live Board</p>
        <h2>${escapeHtml(featured.matchName)}</h2>
        <p class="narrative">${escapeHtml(buildFanBetScoreline(featured))}</p>
      </div>
      <div class="fan-score-pill-group">
        <span class="fan-bet-chip">${escapeHtml(featured.status === "UpComing" ? "Upcoming" : featured.status === "Post" ? "Completed" : "Live")}</span>
        <span class="fan-bet-chip fan-bet-chip-soft">${escapeHtml(featured.status === "UpComing" ? formatDateTime(featured.startTime) : featured.comments || featured.venue || "Official feed")}</span>
      </div>
    </div>
    <div class="fan-bets-mini-board">
      ${experience.scoreboardMatches
        .slice(0, 3)
        .map(
          (match) => `
            <article class="fan-mini-match">
              <strong>${escapeHtml(match.teamACode || initials(match.teamA))} vs ${escapeHtml(match.teamBCode || initials(match.teamB))}</strong>
              <p>${escapeHtml(buildFanBetScoreline(match))}</p>
              <small>${escapeHtml(match.status === "UpComing" ? formatDateTime(match.startTime) : match.comments || match.venue || "")}</small>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFanBetsMarkets(experience) {
  const markets = experience.markets.filter((market) => market.status === "open" || market.status === "locked");
  if (!markets.length) {
    elements.fanBetsMarkets.innerHTML = `<p class="narrative">No live or upcoming fun markets are available yet. When a match feed appears, Fan Bets will create prop cards automatically.</p>`;
    return;
  }

  elements.fanBetsMarkets.innerHTML = markets
    .map((market) => {
      const isOpen = market.status === "open";
      const canBet = isOpen && Boolean(state.auth.user);
      return `
        <article class="bet-card ${isOpen ? "is-open" : "is-locked"}">
          <div class="bet-card-head">
            <span class="fan-bet-chip">${escapeHtml(market.badge)}</span>
            <span class="bet-status">${escapeHtml(market.statusLabel)}</span>
          </div>
          <h3>${escapeHtml(market.title)}</h3>
          <p>${escapeHtml(market.subtitle)}</p>
          <small>${escapeHtml(market.lockNote)}</small>
          <div class="bet-options">
            ${market.options
              .map(
                (option) => `
                  <button
                    class="bet-option-btn"
                    type="button"
                    ${canBet ? `data-place-bet="true" data-market-id="${escapeHtml(market.id)}" data-option-id="${escapeHtml(option.id)}" data-stake="${FAN_BETS_DEFAULT_STAKE}"` : isOpen ? `data-open-auth="register"` : ""}
                    ${isOpen ? "" : "disabled"}
                  >
                    <span>${escapeHtml(option.label)}</span>
                    <strong>${!isOpen ? "Locked" : state.auth.user ? `Bet ${formatPoints(FAN_BETS_DEFAULT_STAKE)}` : "Sign in to bet"}</strong>
                    <small>${!isOpen
                      ? market.outcome === option.id ? "Winning side" : "Waiting to settle"
                      : state.auth.user
                        ? `Returns ${formatPoints(Math.round(FAN_BETS_DEFAULT_STAKE * numberValue(option.payoutMultiplier)))}`
                        : `Register to unlock ${formatPoints(FAN_BETS_STARTING_POINTS)}`}</small>
                  </button>
                `
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderFanBetsActive() {
  if (!state.auth.user) {
    elements.fanBetsActive.innerHTML = `<p class="narrative">Sign in first, then every live slip will be written to Supabase and follow you across sessions.</p>`;
    return;
  }
  if (!state.fanBets.bets.length) {
    elements.fanBetsActive.innerHTML = `<p class="narrative">No active slips yet. Pick any open market to start playing with your fan points.</p>`;
    return;
  }

  elements.fanBetsActive.innerHTML = `
    <ul class="fan-bet-list">
      ${state.fanBets.bets
        .slice(0, 8)
        .map(
          (bet) => `
            <li>
              <div>
                <strong>${escapeHtml(bet.title)}</strong>
                <p>${escapeHtml(bet.optionLabel)} on ${escapeHtml(bet.matchName)}</p>
              </div>
              <div class="fan-bet-list-meta">
                <span>${formatPoints(bet.stake)} stake</span>
                <small>Potential ${formatPoints(Math.round(bet.stake * numberValue(bet.payoutMultiplier)))}</small>
              </div>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function renderFanBetsResults() {
  if (!state.auth.user) {
    elements.fanBetsResults.innerHTML = `<p class="narrative">Recent results will show up here after you sign in and start placing synced Fan Bets.</p>`;
    return;
  }
  if (!state.fanBets.settled.length) {
    elements.fanBetsResults.innerHTML = `<p class="narrative">Settled slips will appear here as soon as live events or match results come through.</p>`;
    return;
  }

  elements.fanBetsResults.innerHTML = `
    <ul class="fan-bet-list fan-bet-results-list">
      ${state.fanBets.settled
        .slice(0, 8)
        .map(
          (bet) => `
            <li class="is-${escapeHtml(bet.result)}">
              <div>
                <strong>${escapeHtml(bet.title)}</strong>
                <p>${escapeHtml(bet.optionLabel)} on ${escapeHtml(bet.matchName)}</p>
              </div>
              <div class="fan-bet-list-meta">
                <span>${escapeHtml(bet.resultLabel)}</span>
                <small>${escapeHtml(formatDateTime(bet.resolvedAt))}</small>
              </div>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function buildFanBetScoreline(match) {
  if (match.status === "Live" || match.status === "Post") {
    return `${match.firstSummary || "-"} | ${match.secondSummary || "-"}`;
  }
  return match.venue || `${match.teamA} vs ${match.teamB}`;
}

function getTopLivePlayer(live, team) {
  return (live?.players || [])
    .filter((player) => player.team === team)
    .slice()
    .sort((a, b) => b.runs - a.runs || b.impactScore - a.impactScore)[0] || null;
}

function buildPlayerKey(team, player) {
  return `${team}::${player}`;
}

function getPlayerRunsByKey(live, key) {
  const [team, player] = String(key || "").split("::");
  const row = (live?.players || []).find((entry) => entry.team === team && entry.player === player);
  return numberValue(row?.runs);
}

function generateTotalRunsLine(match, teamAData, teamBData) {
  const historicalBase =
    getHistoricalAverageForTeam(match.teamA) + getHistoricalAverageForTeam(match.teamB);
  const liveBoost =
    numberValue(teamAData?.netRunRate) * 4 + numberValue(teamBData?.netRunRate) * 4;
  return roundToNearest5(Math.max(300, historicalBase + liveBoost));
}

function getHistoricalAverageForTeam(team) {
  if (!state.data?.teamStats) {
    return 172;
  }
  const rows = state.data.teamStats.filter((row) => row.team === team);
  const innings = rows.reduce((sum, row) => sum + numberValue(row.inningsBatted), 0);
  const runs = rows.reduce((sum, row) => sum + numberValue(row.runsScored), 0);
  return innings ? runs / innings : 172;
}

function roundToNearest5(value) {
  return Math.round(numberValue(value) / 5) * 5;
}

function pickCurrentInningsSummary(match, preferredInnings) {
  const innings = preferredInnings || match.currentInnings || 1;
  if (innings >= 2 && parseScoreSummary(match.secondSummary)) {
    return parseScoreSummary(match.secondSummary);
  }
  return parseScoreSummary(match.firstSummary);
}

function parseScoreSummary(summary) {
  const match = String(summary || "").match(/(\d+)\/(\d+)\s*\(([\d.]+)\s*Ov/i);
  if (!match) {
    return null;
  }
  return {
    runs: numberValue(match[1]),
    wickets: numberValue(match[2]),
    overs: numberValue(match[3]),
    balls: oversToBalls(match[3]),
  };
}

function oversToBalls(overs) {
  const [whole, fraction] = String(overs || "0").split(".");
  return numberValue(whole) * 6 + numberValue(fraction);
}

function formatPoints(value) {
  return `${Math.round(numberValue(value)).toLocaleString("en-IN")} pts`;
}

function render() {
  if (window.IPLLiveLayer) {
    window.IPLLiveLayer.render({ state, elements });
  }
  renderFanBets();

  if (!state.data) {
    return;
  }

  const seasonFilter = getSelectedSeasons();
  const filteredTeamStats = state.data.teamStats.filter((row) => seasonFilter.has(row.season));
  const filteredPlayerStats = state.data.playerStats.filter((row) => seasonFilter.has(row.season));
  const aggregatedTeams = aggregateTeamStats(filteredTeamStats);
  const aggregatedPlayers = aggregatePlayerStats(filteredPlayerStats);
  const selectedTeamRows = aggregatedPlayers
    .filter((row) => row.team === state.selectedTeam)
    .sort((a, b) => b.impactScore - a.impactScore || b.runs - a.runs || b.wickets - a.wickets);
  const selectedTeam = aggregatedTeams.find((row) => row.team === state.selectedTeam) || aggregatedTeams[0];

  if (!selectedTeam) {
    return;
  }

  renderResultsBand();
  renderSummaryGrid(aggregatedTeams);
  renderTeamTable(aggregatedTeams);
  renderSpotlight(selectedTeam, selectedTeamRows);
  renderInsights(aggregatedTeams, selectedTeam, selectedTeamRows);
  renderPlayerTable(selectedTeamRows);
  elements.playerSectionTitle.textContent = `${selectedTeam.team} player contribution`;
}

function renderResultsBand() {
  elements.resultsBand.innerHTML = state.data.seasonResults
    .map((result) => `
      <article class="result-card">
        <span>${result.season} champion</span>
        <strong>${escapeHtml(result.winner || "Unknown")}</strong>
        <p>${escapeHtml(result.finalist1)} vs ${escapeHtml(result.finalist2)}</p>
      </article>
    `)
    .join("");
}

function renderSummaryGrid(teams) {
  const bestWinRate = teams.reduce((best, row) => (row.winRate > best.winRate ? row : best), teams[0]);
  const bestBatting = teams.reduce((best, row) => (row.avgScore > best.avgScore ? row : best), teams[0]);
  const bestBowling = teams.reduce((best, row) => (row.bowlingEconomy < best.bowlingEconomy ? row : best), teams[0]);
  const bestWicketSide = teams.reduce((best, row) => (row.wicketRate > best.wicketRate ? row : best), teams[0]);

  elements.summaryGrid.innerHTML = `
    <article class="summary-card">
      <span>Best win rate</span>
      <strong>${escapeHtml(bestWinRate.team)}</strong>
      <p>${formatPercent(bestWinRate.winRate)} across the selected view</p>
    </article>
    <article class="summary-card">
      <span>Best batting output</span>
      <strong>${escapeHtml(bestBatting.team)}</strong>
      <p>${formatNumber(bestBatting.avgScore, 1)} runs per innings</p>
    </article>
    <article class="summary-card">
      <span>Tightest bowling</span>
      <strong>${escapeHtml(bestBowling.team)}</strong>
      <p>${formatNumber(bestBowling.bowlingEconomy, 2)} economy rate</p>
    </article>
    <article class="summary-card">
      <span>Most wickets per match</span>
      <strong>${escapeHtml(bestWicketSide.team)}</strong>
      <p>${formatNumber(bestWicketSide.wicketRate, 2)} wickets each game</p>
    </article>
  `;
}

function renderTeamTable(teams) {
  const sorted = [...teams].sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.points !== a.points) return b.points - a.points;
    if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
    return a.team.localeCompare(b.team);
  });

  const maxWinRate = Math.max(...sorted.map((row) => row.winRate), 1);

  elements.teamTable.querySelector("thead").innerHTML = `
    <tr>
      <th>Rank</th>
      <th>Team</th>
      <th>Matches</th>
      <th>Wins</th>
      <th>Win %</th>
      <th>Avg score</th>
      <th>Bat SR</th>
      <th>Bowl econ</th>
      <th>Wkts/match</th>
      <th>Players used</th>
    </tr>
  `;

  elements.teamTable.querySelector("tbody").innerHTML = sorted
    .map((row, index) => `
      <tr>
        <td><span class="rank-chip">${index + 1}</span></td>
        <td>
          <button class="link-button" data-team="${escapeHtml(row.team)}">${escapeHtml(row.team)}</button>
        </td>
        <td>${row.matches}</td>
        <td>${row.wins}</td>
        <td class="bar-cell">
          ${formatPercent(row.winRate)}
          <div class="bar-track"><div class="bar-fill" style="width:${(row.winRate / maxWinRate) * 100}%"></div></div>
        </td>
        <td>${formatNumber(row.avgScore, 1)}</td>
        <td>${formatNumber(row.battingStrikeRate, 1)}</td>
        <td>${formatNumber(row.bowlingEconomy, 2)}</td>
        <td>${formatNumber(row.wicketRate, 2)}</td>
        <td>${row.players.size}</td>
      </tr>
    `)
    .join("");

  elements.teamTable.querySelectorAll("[data-team]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTeam = button.dataset.team;
      elements.teamSelect.value = state.selectedTeam;
      render();
    });
  });
}

function renderSpotlight(team, players) {
  const topBatter = [...players].sort((a, b) => b.runs - a.runs)[0];
  const topBowler = [...players].sort((a, b) => b.wickets - a.wickets)[0];
  const mostImpact = players[0];
  const officialUrl = state.data.teamUrls[team.team];

  elements.teamSpotlight.innerHTML = `
    <div class="team-title-row">
      <div>
        <p class="section-kicker">Team Spotlight</p>
        <h2>${escapeHtml(team.team)}</h2>
      </div>
      ${officialUrl ? `<a class="metric-pill" href="${officialUrl}" target="_blank" rel="noreferrer">Official team page</a>` : ""}
    </div>

    <div class="team-meta-grid">
      <div class="mini-stat">
        <span>Record</span>
        <strong>${team.wins}-${team.losses}${team.noResults ? `-${team.noResults}` : ""}</strong>
      </div>
      <div class="mini-stat">
        <span>Points</span>
        <strong>${team.points}</strong>
      </div>
      <div class="mini-stat">
        <span>Batting rate</span>
        <strong>${formatNumber(team.runRate, 2)}</strong>
      </div>
      <div class="mini-stat">
        <span>Bowling economy</span>
        <strong>${formatNumber(team.bowlingEconomy, 2)}</strong>
      </div>
    </div>

    <div class="top-player-grid">
      ${renderTopPlayerCard("Top scorer", topBatter, `${topBatter ? topBatter.runs : 0} runs`)}
      ${renderTopPlayerCard("Top wicket-taker", topBowler, `${topBowler ? topBowler.wickets : 0} wickets`)}
      ${renderTopPlayerCard("Highest impact", mostImpact, `${mostImpact ? formatNumber(mostImpact.impactScore, 0) : 0} impact`)}
      <div class="top-player-card">
        <span>Squad depth</span>
        <strong>${team.players.size} players</strong>
        <p>${team.players.size > 22 ? "Heavy rotation across the selected window." : "Relatively stable playing core across the selected window."}</p>
      </div>
    </div>

    <p class="narrative">${buildNarrative(team, topBatter, topBowler)}</p>
  `;
}

function renderInsights(teams, selectedTeam, players) {
  const sortedByWins = [...teams].sort((a, b) => b.winRate - a.winRate);
  const battingRank = getRank(teams, selectedTeam.team, (row) => row.avgScore, true);
  const bowlingRank = getRank(teams, selectedTeam.team, (row) => row.bowlingEconomy, false);
  const topStrikeRate = players
    .filter((player) => player.balls >= 25)
    .sort((a, b) => b.strikeRate - a.strikeRate)[0];
  const topEconomy = players
    .filter((player) => player.oversBowled >= 8)
    .sort((a, b) => a.economy - b.economy)[0];

  elements.insightPanel.innerHTML = `
    <p class="section-kicker">Analysis Result</p>
    <h2>${escapeHtml(selectedTeam.team)} in context</h2>
    <ul class="insight-list">
      <li>${escapeHtml(sortedByWins[0].team)} has the strongest win rate in the selected view at ${formatPercent(sortedByWins[0].winRate)}.</li>
      <li>${escapeHtml(selectedTeam.team)} ranks ${battingRank} in batting output and ${bowlingRank} in bowling economy among the current teams.</li>
      <li>${topStrikeRate ? `${escapeHtml(topStrikeRate.player)} is the quickest scorer in this squad view with a strike rate of ${formatNumber(topStrikeRate.strikeRate, 1)}.` : "No batter crossed the strike-rate sample threshold in this view."}</li>
      <li>${topEconomy ? `${escapeHtml(topEconomy.player)} offers the most control with an economy of ${formatNumber(topEconomy.economy, 2)} over ${formatNumber(topEconomy.oversBowled, 1)} overs.` : "No bowler crossed the bowling sample threshold in this view."}</li>
    </ul>
  `;
}

function renderPlayerTable(players) {
  elements.playerTable.querySelector("thead").innerHTML = `
    <tr>
      <th>Player</th>
      <th>Matches</th>
      <th>Role</th>
      <th>Runs</th>
      <th>Avg</th>
      <th>SR</th>
      <th>4s</th>
      <th>6s</th>
      <th>Overs</th>
      <th>Wkts</th>
      <th>Econ</th>
      <th>Dots %</th>
      <th>Fielding</th>
      <th>Online</th>
    </tr>
  `;

  elements.playerTable.querySelector("tbody").innerHTML = players
    .map((player) => `
      <tr>
        <td>${renderPlayerCell(player)}</td>
        <td>${player.matches}</td>
        <td>${escapeHtml(player.role)}</td>
        <td>${player.runs}</td>
        <td>${formatNumber(player.battingAverage, 2)}</td>
        <td>${formatNumber(player.strikeRate, 1)}</td>
        <td>${player.fours}</td>
        <td>${player.sixes}</td>
        <td>${formatNumber(player.oversBowled, 1)}</td>
        <td>${player.wickets}</td>
        <td>${player.oversBowled ? formatNumber(player.economy, 2) : "-"}</td>
        <td>${player.ballsBowled ? formatPercent(player.dotRate) : "-"}</td>
        <td>${player.fieldingDismissals}</td>
        <td>${player.espnUrl ? `<a href="${player.espnUrl}" target="_blank" rel="noreferrer">Profile</a>` : "-"}</td>
      </tr>
    `)
    .join("");
}

function aggregateTeamStats(rows) {
  const store = new Map();
  rows.forEach((row) => {
    let aggregate = store.get(row.team);
    if (!aggregate) {
      aggregate = {
        team: row.team,
        matches: 0,
        wins: 0,
        losses: 0,
        noResults: 0,
        ties: 0,
        points: 0,
        inningsBatted: 0,
        inningsBowled: 0,
        runsScored: 0,
        ballsFaced: 0,
        wicketsLost: 0,
        runsConceded: 0,
        ballsBowled: 0,
        wicketsTaken: 0,
        players: new Set(),
      };
      store.set(row.team, aggregate);
    }

    [
      "matches", "wins", "losses", "noResults", "ties", "points", "inningsBatted",
      "inningsBowled", "runsScored", "ballsFaced", "wicketsLost", "runsConceded",
      "ballsBowled", "wicketsTaken",
    ].forEach((field) => {
      aggregate[field] += row[field];
    });

    row.players.forEach((player) => aggregate.players.add(player));
  });

  return Array.from(store.values()).map((row) => {
    const oversFaced = row.ballsFaced / 6;
    const oversBowled = row.ballsBowled / 6;
    return {
      ...row,
      avgScore: row.inningsBatted ? row.runsScored / row.inningsBatted : 0,
      runRate: oversFaced ? row.runsScored / oversFaced : 0,
      battingStrikeRate: row.ballsFaced ? (row.runsScored / row.ballsFaced) * 100 : 0,
      avgConceded: row.inningsBowled ? row.runsConceded / row.inningsBowled : 0,
      bowlingEconomy: oversBowled ? row.runsConceded / oversBowled : 0,
      wicketRate: row.matches ? row.wicketsTaken / row.matches : 0,
      winRate: row.matches ? (row.wins / row.matches) * 100 : 0,
    };
  });
}

function aggregatePlayerStats(rows) {
  const store = new Map();
  rows.forEach((row) => {
    const key = `${row.team}|${row.player}`;
    let aggregate = store.get(key);
    if (!aggregate) {
      aggregate = {
        team: row.team,
        player: row.player,
        longName: row.longName,
        shortName: row.shortName,
        imageUrl: row.imageUrl,
        espnUrl: row.espnUrl,
        role: row.role,
        battingStyle: row.battingStyle,
        bowlingStyle: row.bowlingStyle,
        matchIds: new Set(),
        runs: 0,
        balls: 0,
        dismissals: 0,
        fours: 0,
        sixes: 0,
        ballsBowled: 0,
        runsConceded: 0,
        wickets: 0,
        dotBalls: 0,
        fieldingDismissals: 0,
        impactScore: 0,
      };
      store.set(key, aggregate);
    }

    [
      "runs", "balls", "dismissals", "fours", "sixes", "ballsBowled",
      "runsConceded", "wickets", "dotBalls", "fieldingDismissals", "impactScore",
    ].forEach((field) => {
      aggregate[field] += row[field];
    });
    row.matchIds.forEach((matchId) => aggregate.matchIds.add(matchId));
  });

  return Array.from(store.values()).map((row) => {
    const oversBowled = row.ballsBowled / 6;
    return {
      ...row,
      matches: row.matchIds.size,
      battingAverage: row.dismissals ? row.runs / row.dismissals : row.runs,
      strikeRate: row.balls ? (row.runs / row.balls) * 100 : 0,
      oversBowled,
      economy: oversBowled ? row.runsConceded / oversBowled : 0,
      dotRate: row.ballsBowled ? (row.dotBalls / row.ballsBowled) * 100 : 0,
    };
  });
}

function getSelectedSeasons() {
  if (state.selectedSeason === "all") {
    return new Set(state.data.seasons);
  }
  return new Set([Number(state.selectedSeason)]);
}

function getRank(rows, teamName, metric, descending) {
  const sorted = [...rows].sort((a, b) => {
    const delta = metric(a) - metric(b);
    return descending ? -delta : delta;
  });
  return sorted.findIndex((row) => row.team === teamName) + 1;
}

function buildNarrative(team, topBatter, topBowler) {
  const battingLean = team.avgScore >= 175
    ? "a high-output batting side"
    : team.avgScore >= 165
      ? "a solid batting unit"
      : "a bowling-reliant side";
  const bowlingLean = team.bowlingEconomy <= 8.6
    ? "keeps pressure on opponents well"
    : team.bowlingEconomy <= 9.2
      ? "stays competitive with the ball"
      : "needs bigger contributions from its bowling group";

  return `${team.team} profiles as ${battingLean}. Across the selected seasons it has won ${team.wins} of ${team.matches} matches, scoring ${formatNumber(team.avgScore, 1)} per innings and conceding ${formatNumber(team.avgConceded, 1)}. ${topBatter ? `${topBatter.player} leads the run production with ${topBatter.runs} runs,` : ""} ${topBowler ? `while ${topBowler.player} drives the wicket column with ${topBowler.wickets} wickets.` : ""} Overall, the side ${bowlingLean}`;
}

function renderTopPlayerCard(label, player, statText) {
  if (!player) {
    return `
      <div class="top-player-card">
        <span>${label}</span>
        <strong>No sample</strong>
      </div>
    `;
  }

  return `
    <div class="top-player-card">
      <span>${label}</span>
      <strong>${escapeHtml(player.player)}</strong>
      <p>${escapeHtml(statText)}</p>
    </div>
  `;
}

function renderPlayerCell(player) {
  const avatar = player.imageUrl
    ? `<img class="avatar" src="${player.imageUrl}" alt="${escapeHtml(player.player)}">`
    : `<div class="avatar-fallback">${escapeHtml(initials(player.player))}</div>`;
  return `
    <div class="player-cell">
      ${avatar}
      <div class="player-meta">
        <strong>${escapeHtml(player.player)}</strong>
        <small>${escapeHtml(player.battingStyle || player.role)}</small>
      </div>
    </div>
  `;
}

function formatPercent(value) {
  return `${formatNumber(value, 1)}%`;
}

function formatDateTime(value) {
  const date = new Date(numberValue(value) || value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "Official feed";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatNumber(value, digits) {
  return Number(value || 0).toFixed(digits);
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function initials(name) {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
