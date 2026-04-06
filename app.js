const state = {
  data: null,
  live: null,
  selectedSeason: "all",
  selectedTeam: "",
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
};

bootstrap();

function bootstrap() {
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

function render() {
  if (window.IPLLiveLayer) {
    window.IPLLiveLayer.render({ state, elements });
  }

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

function formatNumber(value, digits) {
  return Number(value || 0).toFixed(digits);
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
