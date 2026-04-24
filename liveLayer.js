(function () {
  const LIVE_REFRESH_MS = 10000;
  const LIVE_COMPETITION_FEED =
    "https://ipl-stats-sports-mechanic.s3.ap-south-1.amazonaws.com/ipl/mc/competition.js";

  const JSONP_CALLBACKS = {
    competition: "oncomptetion",
    standings: "ongroupstandings",
    schedule: "MatchSchedule",
    topRuns: "ontoprunsscorers",
    topWickets: "onmostwickets",
    squad: "onCompetitionSquad",
    innings: "OverHistory",
  };


  const layerState = {
    sharedState: null,
    elements: null,
    onTeamSelect: null,
    onRefresh: null,
    refreshTimer: null,
  };

  function init(config) {
    layerState.sharedState = config.state;
    layerState.elements = config.elements;
    layerState.onTeamSelect = config.onTeamSelect;
    layerState.onRefresh = config.onRefresh;
    renderLoading("Fetching official IPL live feeds...");
    refreshLiveData();

    if (layerState.refreshTimer) {
      window.clearInterval(layerState.refreshTimer);
    }
    layerState.refreshTimer = window.setInterval(() => {
      refreshLiveData(true);
    }, LIVE_REFRESH_MS);
  }

  function render() {
    const live = layerState.sharedState?.live;
    if (!live) {
      return;
    }

    const selectedTeam =
      live.table.find((row) => row.team === layerState.sharedState.selectedTeam) ||
      live.table[0];
    if (!selectedTeam) {
      return;
    }

    const selectedPlayers = live.players
      .filter((player) => player.team === selectedTeam.team)
      .sort((a, b) => b.impactScore - a.impactScore || b.runs - a.runs || b.wickets - a.wickets);

    layerState.elements.livePlayerSectionTitle.textContent =
      selectedTeam.team + " current squad stats";

    renderStatusBanner(live);
    renderSummaryGrid(live);
    renderLiveTable(live);
    renderLiveSpotlight(live, selectedTeam, selectedPlayers);
    renderLiveOddsPanel(live, selectedTeam);
    renderLiveMatchPanel(live, selectedTeam);
    renderLivePlayerTable(selectedPlayers);
  }

  async function refreshLiveData(silent) {
    if (!silent) {
      renderLoading("Fetching official IPL live feeds...");
    }

    try {
      const competitionPayload = await loadJsonp(
        LIVE_COMPETITION_FEED,
        JSONP_CALLBACKS.competition
      );
      const competition = pickCurrentCompetition(competitionPayload);
      const baseFeed = String(competition.statsFeed || competition.feedsource || "").replace(
        /\/$/,
        ""
      );
      const statsCid = String(competition.statsCID || competition.CompetitionID || "");

      const [
        standingsPayload,
        schedulePayload,
        topRunsPayload,
        topWicketsPayload,
        squadPayload,
      ] = await Promise.all([
        loadJsonp(baseFeed + "/stats/" + statsCid + "-groupstandings.js", JSONP_CALLBACKS.standings),
        loadJsonp(baseFeed + "/" + statsCid + "-matchschedule.js", JSONP_CALLBACKS.schedule),
        loadJsonp(baseFeed + "/stats/" + statsCid + "-toprunsscorers.js", JSONP_CALLBACKS.topRuns),
        loadJsonp(
          baseFeed + "/stats/" + statsCid + "-mostwickets.js",
          JSONP_CALLBACKS.topWickets
        ),
        loadJsonp(
          baseFeed + "/squads/" + statsCid + "-competitionsquad.js",
          JSONP_CALLBACKS.squad
        ),
      ]);

      const liveState = buildLiveState({
        competition: competition,
        standingsPayload: standingsPayload,
        schedulePayload: schedulePayload,
        topRunsPayload: topRunsPayload,
        topWicketsPayload: topWicketsPayload,
        squadPayload: squadPayload,
      });

      // Fetch current-over ball-by-ball data for any live match
      const liveMatches = liveState.matches.filter(function (m) { return m.status === 'Live'; });
      if (liveMatches.length > 0) {
        await Promise.all(liveMatches.map(async function (match) {
          try {
            const inningsNo = match.currentInnings || 1;
            const inningsUrl = "https://scores.iplt20.com/ipl/feeds/" + match.matchId + "-Innings" + inningsNo + ".js";
            const inningsPayload = await loadJsonpSilent(inningsUrl, JSONP_CALLBACKS.innings);
            const balls = Array.isArray(inningsPayload) ? inningsPayload : [];
            // Find the highest completed OverNo in the data
            const validBalls = balls.filter(function (b) { return b.BallID && b.OverNo; });
            if (validBalls.length === 0) return;
            const maxOver = Math.max.apply(null, validBalls.map(function (b) { return Number(b.OverNo); }));
            const currentOverBalls = validBalls
              .filter(function (b) { return Number(b.OverNo) === maxOver; })
              .sort(function (a, b) { return Number(a.SNO) - Number(b.SNO); })
              .map(function (b) {
                return {
                  label: b.IsWicket === '1' ? 'W' : b.IsWide === '1' ? 'wd' : b.IsNoBall === '1' ? 'nb' : String(b.BallRuns || '0'),
                  isWicket: b.IsWicket === '1',
                  isExtra: b.IsWide === '1' || b.IsNoBall === '1',
                  isFour: b.IsFour === '1',
                  isSix: b.IsSix === '1',
                };
              });
            match.currentOverBalls = currentOverBalls;
            match.currentOverNo = maxOver;
          } catch (e) {
            // silently ignore — ball data is enhancement only
          }
        }));
      }

      layerState.sharedState.live = liveState;
      if (!layerState.sharedState.selectedTeam && liveState.teams.length) {
        layerState.sharedState.selectedTeam = liveState.teams[0];
      }
      if (typeof layerState.onRefresh === "function") {
        layerState.onRefresh();
      }
    } catch (error) {
      renderError(error instanceof Error ? error.message : String(error));
    }
  }

  function renderLoading(message) {
    const elements = layerState.elements;
    if (!elements?.liveStatusBanner) {
      return;
    }
    elements.liveStatusBanner.innerHTML =
      '<div class="status-stack"><span class="status-dot loading"></span><div><p class="section-kicker">Live Feed</p><h2>Loading current IPL season</h2><p class="narrative">' +
      escapeHtml(message) +
      "</p></div></div>";
    elements.liveSummaryGrid.innerHTML = "";
    renderEmptyTable(
      elements.liveTable,
      ["Rank", "Team", "M", "W", "L", "Pts", "NRR", "Form", "Winner odds", "Top 4", "Avg finish"],
      "Waiting for official standings..."
    );
    renderEmptyTable(
      elements.livePlayerTable,
      ["Player", "Role", "Matches", "Runs", "Avg", "SR", "4s", "6s", "Overs", "Wkts", "Econ", "Dots %", "Catches", "Stumpings", "Impact", "Online"],
      "Waiting for current squad stats..."
    );
    elements.liveSpotlight.innerHTML =
      '<p class="narrative">Live team spotlight will appear here once the feed loads.</p>';
    elements.liveOddsPanel.innerHTML =
      '<p class="narrative">Title odds will appear here once the simulator finishes.</p>';
    elements.liveMatchPanel.innerHTML =
      '<p class="narrative">Live and upcoming fixtures will appear here once the schedule loads.</p>';
  }

  function renderError(message) {
    const elements = layerState.elements;
    if (!elements?.liveStatusBanner) {
      return;
    }
    elements.liveStatusBanner.innerHTML =
      '<div class="status-stack"><span class="status-dot error"></span><div><p class="section-kicker">Live Feed</p><h2>Unable to load the current IPL season</h2><p class="narrative">' +
      escapeHtml(message) +
      "</p></div></div>";
    elements.liveSummaryGrid.innerHTML = "";
  }

  function buildLiveState(payload) {
    const standings = (payload.standingsPayload.points || []).map(function (row) {
      return {
        competitionId: String(row.CompetitionID || ""),
        teamId: String(row.TeamID || ""),
        teamCode: String(row.TeamCode || ""),
        team: canonicalTeam(row.TeamName || ""),
        logoUrl: row.TeamLogo || "",
        matches: numberValue(row.Matches),
        wins: numberValue(row.Wins),
        losses: numberValue(row.Loss),
        noResults: numberValue(row.NoResult),
        points: numberValue(row.Points),
        netRunRate: numberValue(row.NetRunRate),
        form: String(row.Performance || "").replaceAll(",", " "),
        currentRank: numberValue(row.OrderNo),
      };
    });

    const players = buildLivePlayerRows(
      payload.squadPayload.squads || [],
      payload.topRunsPayload.toprunsscorers || [],
      payload.topWicketsPayload.mostwickets || []
    );
    const matches = normalizeLiveMatches(payload.schedulePayload.Matchsummary || []);

    const table = standings.map(function (teamRow) {
      const teamPlayers = players.filter(function (player) {
        return player.team === teamRow.team;
      });
      const topBatter = teamPlayers
        .slice()
        .sort(function (a, b) {
          return b.runs - a.runs;
        })[0];
      const topBowler = teamPlayers
        .slice()
        .sort(function (a, b) {
          return b.wickets - a.wickets;
        })[0];

      return {
        competitionId: teamRow.competitionId,
        teamId: teamRow.teamId,
        teamCode: teamRow.teamCode,
        team: teamRow.team,
        logoUrl: teamRow.logoUrl,
        matches: teamRow.matches,
        wins: teamRow.wins,
        losses: teamRow.losses,
        noResults: teamRow.noResults,
        points: teamRow.points,
        netRunRate: teamRow.netRunRate,
        form: teamRow.form,
        currentRank: teamRow.currentRank,
        topBatter: topBatter || null,
        topBowler: topBowler || null,
      };
    });

    const projections = simulateWinnerOdds(table, matches);
    const enrichedTable = table.map(function (row) {
      const extra = projections.get(row.team) || {};
      return Object.assign({}, row, extra);
    });

    return {
      competitionName:
        payload.competition.CompetitionName ||
        ("IPL " + extractSeasonName(payload.competition.CompetitionName)),
      season:
        payload.competition.SeasonName ||
        extractSeasonName(payload.competition.CompetitionName),
      lastUpdated: Date.now(),
      teams: enrichedTable.map(function (row) { return row.team; }).sort(),
      table: enrichedTable,
      players: players,
      matches: matches,
      simulationCount:
        enrichedTable.length && enrichedTable[0].simulationCount
          ? enrichedTable[0].simulationCount
          : 0,
    };
  }

  function renderStatusBanner(live) {
    const elements = layerState.elements;
    const liveMatches = live.matches.filter(function (match) {
      return match.status === "Live";
    });
    const nextMatch = live.matches
      .filter(function (match) {
        return match.status === "UpComing";
      })
      .sort(function (a, b) {
        return a.startTime - b.startTime;
      })[0];

    const tossMatches = live.matches.filter(function (match) {
      return match.status !== "Live" && match.status !== "Post" && match.isTossCompleted;
    });

    elements.liveStatusBanner.innerHTML =
      '<div class="status-stack"><span class="status-dot ' +
      (liveMatches.length ? "live" : tossMatches.length ? "warning" : "ok") +
      '"></span><div><p class="section-kicker">Live Feed</p><h2>' +
      escapeHtml(live.competitionName) +
      "</h2><p class=\"narrative\">Official standings, squads, batting stats, bowling stats, and fixtures loaded successfully. Last refresh: " +
      escapeHtml(formatDateTime(live.lastUpdated)) +
      ". " +
      escapeHtml(
        liveMatches.length
          ? liveMatches.length + " live match" + (liveMatches.length > 1 ? "es are" : " is") + " underway."
          : tossMatches.length
            ? tossMatches.length + " match" + (tossMatches.length > 1 ? "es have" : " has") + " completed the toss and will start soon."
            : nextMatch
              ? "Next scheduled match: " + nextMatch.matchName + "."
              : "No upcoming matches were found in the current feed."
      ) +
      "</p></div></div>";
  }

  function renderSummaryGrid(live) {
    const currentLeader = live.table
      .slice()
      .sort(function (a, b) {
        if (b.points !== a.points) return b.points - a.points;
        return b.netRunRate - a.netRunRate;
      })[0];
    const topOdds = live.table
      .slice()
      .sort(function (a, b) {
        return b.winnerOdds - a.winnerOdds;
      })[0];
    const topBatter = live.players
      .slice()
      .sort(function (a, b) {
        return b.runs - a.runs;
      })[0];
    const topBowler = live.players
      .slice()
      .sort(function (a, b) {
        return b.wickets - a.wickets;
      })[0];

    function getTeamLogoUrl(teamName) {
      const row = live.table.find(function (r) { return r.team === teamName; });
      return row ? (row.logoUrl || "") : "";
    }

    function buildTeamSummaryCard(label, teamName, body, logoUrl) {
      const theme = teamThemeSlug(teamName);
      const logoStyle = logoUrl ? " style=\"--row-hover-logo:url('" + logoUrl.replace(/'/g, "\\'") + "')\"" : "";
      return (
        "<article class=\"summary-card summary-card--team\" data-team-theme=\"" + theme + "\"" + logoStyle + ">" +
        "<span>" + escapeHtml(label) + "</span>" +
        "<strong>" + escapeHtml(teamName) + "</strong>" +
        "<p>" + body + "</p>" +
        "</article>"
      );
    }

    function buildPlayerSummaryCard(label, playerName, body, playerImgUrl, logoUrl) {
      const safePlayer = (playerImgUrl || "").replace(/'/g, "\\'");
      const safeLogo = (logoUrl || "").replace(/'/g, "\\'");
      const imgStyle = playerImgUrl
        ? " style=\"--player-img:url('" + safePlayer + "');--team-logo:url('" + safeLogo + "')\""
        : "";
      return (
        "<article class=\"summary-card summary-card--player\"" + imgStyle + ">" +
        "<span>" + escapeHtml(label) + "</span>" +
        "<strong>" + escapeHtml(playerName) + "</strong>" +
        "<p>" + body + "</p>" +
        "</article>"
      );
    }

    layerState.elements.liveSummaryGrid.innerHTML =
      buildTeamSummaryCard(
        "Current table leader",
        currentLeader.team,
        currentLeader.points + " points, " + escapeHtml(formatSignedNumber(currentLeader.netRunRate, 3)) + " NRR",
        currentLeader.logoUrl || getTeamLogoUrl(currentLeader.team)
      ) +
      buildTeamSummaryCard(
        "Strongest title odds",
        topOdds.team,
        formatPercent(topOdds.winnerOdds) + " simulated winner chance",
        topOdds.logoUrl || getTeamLogoUrl(topOdds.team)
      ) +
      buildPlayerSummaryCard(
        "Top scorer right now",
        topBatter.player,
        topBatter.runs + " runs for " + escapeHtml(topBatter.team),
        topBatter.imageUrl || "",
        getTeamLogoUrl(topBatter.team)
      ) +
      buildPlayerSummaryCard(
        "Top wicket-taker right now",
        topBowler.player,
        topBowler.wickets + " wickets for " + escapeHtml(topBowler.team),
        topBowler.imageUrl || "",
        getTeamLogoUrl(topBowler.team)
      );
  }


  function renderLiveTable(live) {
    const elements = layerState.elements;
    const sorted = live.table
      .slice()
      .sort(function (a, b) {
        if (a.currentRank !== b.currentRank) return a.currentRank - b.currentRank;
        if (b.points !== a.points) return b.points - a.points;
        return b.netRunRate - a.netRunRate;
      });

    elements.liveTable.querySelector("thead").innerHTML =
      "<tr><th>Rank</th><th>Team</th><th>M</th><th>W</th><th>L</th><th>Pts</th><th>NRR</th><th>Form</th><th>Winner odds</th><th>Top 4</th><th>Avg finish</th></tr>";
    elements.liveTable.querySelector("tbody").innerHTML = sorted
      .map(function (row) {
        return (
          "<tr class=\"live-team-row\"" +
          rowHoverLogoStyle(row.logoUrl) +
          ' data-team-theme="' +
          teamThemeSlug(row.team) +
          "\"><td><span class=\"rank-chip\">" +
          row.currentRank +
          '</span></td><td><button class="link-button" data-live-team="' +
          escapeHtml(row.team) +
          '">' +
          escapeHtml(row.team) +
          "</button></td><td>" +
          row.matches +
          "</td><td>" +
          row.wins +
          "</td><td>" +
          row.losses +
          "</td><td>" +
          row.points +
          '</td><td class="' +
          (row.netRunRate >= 0 ? "positive-text" : "negative-text") +
          '">' +
          escapeHtml(formatSignedNumber(row.netRunRate, 3)) +
          "</td><td>" +
          escapeHtml(row.form || "-") +
          "</td><td>" +
          formatPercent(row.winnerOdds) +
          "</td><td>" +
          formatPercent(row.topFourOdds) +
          "</td><td>" +
          escapeHtml(formatOrdinalNumber(row.avgFinish)) +
          "</td></tr>"
        );
      })
      .join("");

    elements.liveTable.querySelectorAll("[data-live-team]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (typeof layerState.onTeamSelect === "function") {
          layerState.onTeamSelect(button.dataset.liveTeam);
        }
      });
    });

    const liveLayout = elements.liveTable.closest(".layout.live-layout");
    const drawer = liveLayout ? liveLayout.querySelector(".side-column") : null;

    elements.liveTable.querySelectorAll("tbody tr").forEach(function (tr) {
      tr.addEventListener("mouseenter", function () {
        const btn = tr.querySelector("[data-live-team]");
        if (!btn) return;
        const teamName = btn.dataset.liveTeam;
        
        const team = live.table.find(function (r) { return r.team === teamName; });
        if (!team) return;
        
        const players = live.players
          .filter(function (player) { return player.team === teamName; })
          .sort(function(a, b) { return b.impactScore - a.impactScore || b.runs - a.runs || b.wickets - a.wickets; });
          
        renderLiveSpotlight(live, team, players);
        renderLiveOddsPanel(live, team);
        renderLiveMatchPanel(live, team);
        
        if (drawer) {
          drawer.classList.add("active");
        }
      });
    });

    if (liveLayout && !liveLayout.dataset.hoverBound) {
      liveLayout.dataset.hoverBound = "true";
      liveLayout.addEventListener("mouseleave", function () {
        if (drawer) {
          drawer.classList.remove("active");
        }
      });
    }
  }

  function renderLiveSpotlight(live, team, players) {
    layerState.elements.liveSpotlight.setAttribute("data-team-theme", teamThemeSlug(team.team));

    const topBatter = players
      .slice()
      .sort(function (a, b) {
        return b.runs - a.runs;
      })[0];
    const topBowler = players
      .slice()
      .sort(function (a, b) {
        return b.wickets - a.wickets;
      })[0];
    const nextMatch = live.matches
      .filter(function (match) {
        return (
          match.status === "UpComing" &&
          (match.teamA === team.team || match.teamB === team.team)
        );
      })
      .sort(function (a, b) {
        return a.startTime - b.startTime;
      })[0];

    layerState.elements.liveSpotlight.innerHTML =
      '<div class="team-title-row"><div><p class="section-kicker">Live Team View</p><h2>' +
      escapeHtml(team.team) +
      "</h2></div>" +
      (team.logoUrl
        ? '<img class="team-badge" src="' + team.logoUrl + '" alt="' + escapeHtml(team.team) + '">'
        : "") +
      '</div><div class="team-meta-grid"><div class="mini-stat"><span>Current rank</span><strong>' +
      team.currentRank +
      '</strong></div><div class="mini-stat"><span>Record</span><strong>' +
      team.wins +
      "-" +
      team.losses +
      (team.noResults ? "-" + team.noResults : "") +
      '</strong></div><div class="mini-stat"><span>Points</span><strong>' +
      team.points +
      '</strong></div><div class="mini-stat"><span>NRR</span><strong>' +
      escapeHtml(formatSignedNumber(team.netRunRate, 3)) +
      '</strong></div></div><div class="top-player-grid">' +
      renderTopPlayerCard("Current top scorer", topBatter, (topBatter ? topBatter.runs : 0) + " runs") +
      renderTopPlayerCard("Current top bowler", topBowler, (topBowler ? topBowler.wickets : 0) + " wickets") +
      '<div class="top-player-card"><span>Winner odds</span><strong>' +
      formatPercent(team.winnerOdds) +
      "</strong><p>" +
      formatPercent(team.topFourOdds) +
      " top-four chance from the simulation.</p></div>" +
      '<div class="top-player-card"><span>Next fixture</span><strong>' +
      escapeHtml(
        nextMatch ? (team.team === nextMatch.teamA ? nextMatch.teamBCode : nextMatch.teamACode) : "TBD"
      ) +
      "</strong><p>" +
      escapeHtml(nextMatch ? formatDateTime(nextMatch.startTime) : "No upcoming fixture found in the current feed.") +
      "</p></div></div><p class=\"narrative\">" +
      escapeHtml(
        team.team +
          " currently sits " +
          ordinalWord(team.currentRank) +
          " in the live table with " +
          team.points +
          " points. The model blends 2023-2025 historical team strength with current 2026 form, then simulates the remaining league and playoff path to estimate title odds and likely finishing position."
      ) +
      "</p>";
  }

  function renderLiveOddsPanel(live, team) {
    const sorted = live.table
      .slice()
      .sort(function (a, b) {
        return b.winnerOdds - a.winnerOdds;
      })
      .slice(0, 5);

    layerState.elements.liveOddsPanel.innerHTML =
      '<p class="section-kicker">Winner Odds</p><h2>Simulated finish outlook</h2><div class="odds-card-grid"><div class="mini-stat"><span>' +
      escapeHtml(team.team) +
      ' title odds</span><strong>' +
      formatPercent(team.winnerOdds) +
      '</strong></div><div class="mini-stat"><span>' +
      escapeHtml(team.team) +
      ' top 4 odds</span><strong>' +
      formatPercent(team.topFourOdds) +
      '</strong></div><div class="mini-stat"><span>Average finish</span><strong>' +
      escapeHtml(formatOrdinalNumber(team.avgFinish)) +
      '</strong></div><div class="mini-stat"><span>Projected points</span><strong>' +
      formatNumber(team.projectedPoints, 1) +
      '</strong></div></div><ul class="compact-list">' +
      sorted
        .map(function (row) {
          const logo = row.logoUrl
            ? '<img src="' + escapeHtml(row.logoUrl) + '" alt="" loading="lazy">'
            : '<span>' + escapeHtml(initials(row.team)) + "</span>";
          return (
            '<li class="entity-hover-card team-entity"' +
            cardThemeAttrs(row.team, row.logoUrl) +
            '><div class="entity-media">' +
            logo +
            '</div><div class="entity-body"><strong>' +
            escapeHtml(row.team) +
            "</strong><span>" +
            formatPercent(row.winnerOdds) +
            " winner odds, " +
            formatPercent(row.topFourOdds) +
            " top 4</span></div></li>"
          );
        })
        .join("") +
      '</ul><p class="narrative">The simulation runs ' +
      live.simulationCount.toLocaleString("en-IN") +
      " seasons using the live table, remaining fixtures, and team-strength estimates from both the current campaign and the last three local seasons.</p>";
  }

  function renderLiveMatchPanel(live, team) {
    const liveMatches = live.matches.filter(function (match) {
      return match.status === "Live" || (match.status === "UpComing" && match.isTossCompleted);
    }).slice(0, 2);

    const upcomingMatches = live.matches
      .filter(function (match) {
        return match.status === "UpComing" && !match.isTossCompleted;
      })
      .sort(function (a, b) {
        return a.startTime - b.startTime;
      })
      .slice(0, 3);

    layerState.elements.liveMatchPanel.innerHTML =
      '<p class="section-kicker">Fixtures</p><h2>Live and upcoming schedule</h2>' +
      (liveMatches.length
        ? '<div class="match-stack">' + liveMatches.map(renderMatchCard).join("") + "</div>"
        : '<p class="narrative">No match is live at this exact refresh.</p>') +

      (upcomingMatches.length
        ? '<p class="section-kicker subtle-kicker">Next upcoming fixtures</p><div class="match-stack">' +
          upcomingMatches.map(renderMatchCard).join("") +
          "</div>"
        : '<p class="narrative">No upcoming fixtures were found in the current feed.</p>');
  }

  function renderLivePlayerTable(players) {
    const elements = layerState.elements;
    const profileLookup = getProfileLookup();
    elements.livePlayerTable.querySelector("thead").innerHTML =
      "<tr><th>Player</th><th>Role</th><th>Matches</th><th>Runs</th><th>Avg</th><th>SR</th><th>4s</th><th>6s</th><th>Overs</th><th>Wkts</th><th>Econ</th><th>Dots %</th><th>Catches</th><th>Stumpings</th><th>Impact</th><th>Online</th></tr>";
    elements.livePlayerTable.querySelector("tbody").innerHTML = players
      .map(function (player) {
        const profile = profileLookup.get(playerNameKey(player.player));
        const profileUrl = profile && profile.espnUrl ? profile.espnUrl : "";
        return (
          "<tr><td>" +
          renderPlayerCell({
            player: player.player,
            imageUrl: player.imageUrl || (profile ? profile.imageUrl : ""),
            battingStyle: player.battingStyle || player.role,
            role: player.role,
          }) +
          "</td><td>" +
          escapeHtml(player.role) +
          "</td><td>" +
          player.matches +
          "</td><td>" +
          player.runs +
          "</td><td>" +
          (player.runs ? formatNumber(player.battingAverage, 2) : "-") +
          "</td><td>" +
          (player.balls ? formatNumber(player.strikeRate, 1) : "-") +
          "</td><td>" +
          player.fours +
          "</td><td>" +
          player.sixes +
          "</td><td>" +
          (player.ballsBowled ? formatOvers(player.ballsBowled) : "-") +
          "</td><td>" +
          player.wickets +
          "</td><td>" +
          (player.ballsBowled ? formatNumber(player.economy, 2) : "-") +
          "</td><td>" +
          (player.ballsBowled ? formatPercent(player.dotRate) : "-") +
          "</td><td>" +
          player.catches +
          "</td><td>" +
          player.stumpings +
          "</td><td>" +
          formatNumber(player.impactScore, 0) +
          "</td><td>" +
          (profileUrl
            ? '<a href="' + profileUrl + '" target="_blank" rel="noreferrer">Profile</a>'
            : "-") +
          "</td></tr>"
        );
      })
      .join("");
  }
  function simulateWinnerOdds(liveTable, matches) {
    const historicalMap = buildHistoricalTeamMap();
    const ratingMap = buildTeamRatings(liveTable, historicalMap);
    const baseTable = new Map(
      liveTable.map(function (team) {
        return [
          team.team,
          {
            team: team.team,
            points: team.points,
            wins: team.wins,
            losses: team.losses,
            noResults: team.noResults,
            matches: team.matches,
            nrr: team.netRunRate,
          },
        ];
      })
    );
    const remainingLeagueMatches = matches.filter(function (match) {
      return match.rowNo <= 70 && match.status !== "Post";
    });
    const iterations = remainingLeagueMatches.length > 45 ? 5000 : 7000;
    const summary = new Map();

    liveTable.forEach(function (team) {
      summary.set(team.team, {
        winnerCount: 0,
        topFourCount: 0,
        finishTotal: 0,
        pointsTotal: 0,
        simulationCount: iterations,
      });
    });

    for (let index = 0; index < iterations; index += 1) {
      const simTable = new Map();
      baseTable.forEach(function (row, team) {
        simTable.set(team, Object.assign({}, row));
      });

      remainingLeagueMatches.forEach(function (match) {
        const teamA = simTable.get(match.teamA);
        const teamB = simTable.get(match.teamB);
        if (!teamA || !teamB) {
          return;
        }

        const probabilityTeamA = resolveMatchProbability(match, ratingMap);
        const teamAWins = Math.random() < probabilityTeamA;
        const winner = teamAWins ? teamA : teamB;
        const loser = teamAWins ? teamB : teamA;
        const ratingGap = Math.abs((ratingMap.get(match.teamA) || 0) - (ratingMap.get(match.teamB) || 0));
        const nrrSwing = 0.05 + Math.random() * 0.22 + ratingGap * 0.04;

        winner.matches += 1;
        winner.wins += 1;
        winner.points += 2;
        winner.nrr += nrrSwing;

        loser.matches += 1;
        loser.losses += 1;
        loser.nrr -= nrrSwing;
      });

      const orderedTable = Array.from(simTable.values()).sort(function (a, b) {
        if (b.points !== a.points) return b.points - a.points;
        if (b.nrr !== a.nrr) return b.nrr - a.nrr;
        return (ratingMap.get(b.team) || 0) - (ratingMap.get(a.team) || 0);
      });

      orderedTable.forEach(function (row, finishIndex) {
        const entry = summary.get(row.team);
        entry.finishTotal += finishIndex + 1;
        entry.pointsTotal += row.points;
        if (finishIndex < 4) {
          entry.topFourCount += 1;
        }
      });

      const champion = simulatePlayoffs(orderedTable.slice(0, 4), ratingMap);
      if (summary.has(champion)) {
        summary.get(champion).winnerCount += 1;
      }
    }

    liveTable.forEach(function (team) {
      const entry = summary.get(team.team);
      entry.winnerOdds = (entry.winnerCount / iterations) * 100;
      entry.topFourOdds = (entry.topFourCount / iterations) * 100;
      entry.avgFinish = entry.finishTotal / iterations;
      entry.projectedPoints = entry.pointsTotal / iterations;
    });

    return summary;
  }

  function buildLivePlayerRows(squadRows, battingRows, bowlingRows) {
    const playerMap = new Map();

    squadRows.forEach(function (row) {
      const player = ensureLivePlayer(playerMap, {
        teamId: String(row.TeamID || ""),
        teamCode: String(row.TeamCode || ""),
        team: canonicalTeam(row.TeamName || ""),
        playerId: String(row.PlayerID || ""),
        player: cleanLivePlayerName(row.PlayerName || ""),
        imageUrl: row.PlayerImage || "",
        role: row.PlayerSkill || "Player",
        battingStyle: row.BattingType || "",
        bowlingStyle: row.BowlingProficiency || "",
      });
      player.isCaptain = row.IsCaptain === "1";
      player.isWicketKeeper = row.IsWK === "1" || row.IsWicketKeeper === "1";
    });

    battingRows.forEach(function (row) {
      const player = ensureLivePlayer(playerMap, {
        teamId: String(row.TeamID || row.TTeamID || ""),
        teamCode: String(row.TeamCode || ""),
        team: canonicalTeam(row.TeamName || ""),
        playerId: String(row.StrikerID || row.TStrikerID || ""),
        player: cleanLivePlayerName(row.StrikerName || ""),
        clientPlayerId: String(row.ClientPlayerID || ""),
      });
      player.matches = Math.max(player.matches, numberValue(row.Matches));
      player.runs = numberValue(row.TotalRuns);
      player.balls = numberValue(row.Balls);
      player.dismissals = numberValue(row.Outs);
      player.fours = numberValue(row.Fours);
      player.sixes = numberValue(row.Sixes);
      player.catches = numberValue(row.Catches);
      player.stumpings = numberValue(row.Stumpings);
      player.strikeRate = numberValue(row.StrikeRate);
      player.battingAverage = parseAverage(row.BattingAverage, player.runs, player.dismissals);
    });

    bowlingRows.forEach(function (row) {
      const player = ensureLivePlayer(playerMap, {
        teamId: String(row.TeamID || ""),
        teamCode: String(row.TeamCode || ""),
        team: canonicalTeam(row.TeamName || ""),
        playerId: String(row.BowlerID || ""),
        player: cleanLivePlayerName(row.BowlerName || ""),
        clientPlayerId: String(row.ClientPlayerID || ""),
      });
      player.matches = Math.max(player.matches, numberValue(row.Matches));
      player.wickets = numberValue(row.Wickets);
      player.ballsBowled = numberValue(row.LegalBallsBowled);
      player.runsConceded = numberValue(row.TotalRunsConceded);
      player.dotBalls = numberValue(row.DotBallsBowled);
      player.economy = numberValue(row.EconomyRate);
      player.dotRate = numberValue(row.DotBallPercent);
    });

    return Array.from(playerMap.values())
      .map(function (player) {
        const oversBowled = player.ballsBowled / 6;
        return {
          teamId: player.teamId,
          teamCode: player.teamCode,
          team: player.team,
          playerId: player.playerId,
          clientPlayerId: player.clientPlayerId,
          player: player.player,
          imageUrl: player.imageUrl,
          role:
            player.role ||
            (player.wickets && player.runs
              ? "All Rounder"
              : player.wickets
                ? "Bowler"
                : "Batter"),
          battingStyle: player.battingStyle,
          bowlingStyle: player.bowlingStyle,
          matches: player.matches,
          runs: player.runs,
          balls: player.balls,
          dismissals: player.dismissals,
          battingAverage:
            player.battingAverage || (player.dismissals ? player.runs / player.dismissals : player.runs),
          strikeRate: player.strikeRate || (player.balls ? (player.runs / player.balls) * 100 : 0),
          fours: player.fours,
          sixes: player.sixes,
          wickets: player.wickets,
          ballsBowled: player.ballsBowled,
          runsConceded: player.runsConceded,
          economy: player.economy || (oversBowled ? player.runsConceded / oversBowled : 0),
          dotBalls: player.dotBalls,
          dotRate: player.dotRate || (player.ballsBowled ? (player.dotBalls / player.ballsBowled) * 100 : 0),
          catches: player.catches,
          stumpings: player.stumpings,
          impactScore:
            player.runs * 0.75 +
            player.wickets * 22 +
            player.catches * 5 +
            player.stumpings * 7 +
            player.dotBalls * 0.28,
        };
      })
      .sort(function (a, b) {
        if (a.team !== b.team) {
          return a.team.localeCompare(b.team);
        }
        return b.impactScore - a.impactScore || b.runs - a.runs || b.wickets - a.wickets;
      });
  }

  function normalizeLiveMatches(rows) {
    return rows
      .map(function (row) {
        return {
          matchId: numberValue(row.MatchID),
          rowNo: numberValue(row.RowNo),
          status: String(row.MatchStatus || ""),
          matchName: row.MatchName || "",
          startTime: parseMatchDateTime(row.MATCH_COMMENCE_START_DATE, row.MatchDate, row.MatchTime),
          teamA: canonicalTeam(row.FirstBattingTeamName || row.HomeTeamName || ""),
          teamB: canonicalTeam(row.SecondBattingTeamName || row.AwayTeamName || ""),
          teamACode: row.FirstBattingTeamCode || "",
          teamBCode: row.SecondBattingTeamCode || "",
          homeTeam: canonicalTeam(row.HomeTeamName || row.FirstBattingTeamName || ""),
          awayTeam: canonicalTeam(row.AwayTeamName || row.SecondBattingTeamName || ""),
          venue: row.GroundName || "",
          city: row.city || "",
          comments: stripHtml(row.Comments || row.Commentss || ""),
          chasingText: stripHtml(row.ChasingText || ""),
          matchOrder: row.MatchOrder || "",
          firstSummary: row.FirstBattingSummary || row["1Summary"] || "",
          secondSummary: row.SecondBattingSummary || row["2Summary"] || "",
          currentInnings: numberValue(row.CurrentInnings),
          projectedScore: numberValue(row.ProjectedScore),
          strikerName: row.CurrentStrikerName || "",
          strikerRuns: row.StrikerRuns || 0,
          strikerBalls: row.StrikerBalls || 0,
          nonStrikerName: row.CurrentNonStrikerName || "",
          nonStrikerRuns: row.NonStrikerRuns || 0,
          nonStrikerBalls: row.NonStrikerBalls || 0,
          bowlerName: row.CurrentBowlerName || "",
          bowlerOvers: row.BowlerOvers || "0.0",
          bowlerRuns: row.BowlerRuns || 0,
          bowlerWickets: row.BowlerWickets || 0,
          tossWinner: row.TossWinnerTeamCode || row.TossWinnerTeamId || "",
          tossWinnerName: canonicalTeam(row.TossWinnerTeamName || ""),
          tossTeam: canonicalTeam(row.TossTeam || ""),
          tossDecision: row.TossDecision || "",
          tossText: row.TossText || "",
          isTossCompleted: Boolean(row.TossWinnerTeamCode || row.TossWinnerTeamId || row.TossWinnerTeamName || row.TossTeam || row.TossText),
        };
      })
      .filter(function (match) {
        return match.teamA && match.teamB;
      });
  }

  function buildTeamRatings(liveTable, historicalMap) {
    const metrics = liveTable.map(function (team) {
      const historical = historicalMap.get(team.team);
      return {
        team: team.team,
        historicalWinRate: historical ? historical.winRate : 50,
        historicalNet: historical ? historical.netRating : 0,
        livePointRate: team.matches ? team.points / team.matches : 0,
        liveNrr: team.netRunRate,
        liveTopRuns: team.topBatter ? team.topBatter.runs : 0,
        liveTopWickets: team.topBowler ? team.topBowler.wickets : 0,
      };
    });

    const winZ = zScoreMap(metrics, "historicalWinRate");
    const histNetZ = zScoreMap(metrics, "historicalNet");
    const pointZ = zScoreMap(metrics, "livePointRate");
    const nrrZ = zScoreMap(metrics, "liveNrr");
    const runsZ = zScoreMap(metrics, "liveTopRuns");
    const wicketsZ = zScoreMap(metrics, "liveTopWickets");
    const ratings = new Map();

    metrics.forEach(function (row) {
      ratings.set(
        row.team,
        winZ.get(row.team) * 0.32 +
          histNetZ.get(row.team) * 0.23 +
          pointZ.get(row.team) * 0.2 +
          nrrZ.get(row.team) * 0.15 +
          runsZ.get(row.team) * 0.05 +
          wicketsZ.get(row.team) * 0.05
      );
    });

    return ratings;
  }

  function resolveMatchProbability(match, ratingMap) {
    const ratingA = ratingMap.get(match.teamA) || 0;
    const ratingB = ratingMap.get(match.teamB) || 0;
    const homeBoost =
      match.homeTeam === match.teamA ? 0.08 : match.homeTeam === match.teamB ? -0.08 : 0;
    const baseProbability = clamp(logistic((ratingA - ratingB) * 0.92 + homeBoost), 0.08, 0.92);

    if (match.status !== "Live") {
      return baseProbability;
    }

    const first = parseInningsSummary(match.firstSummary);
    const second = parseInningsSummary(match.secondSummary);

    if (first && second && match.currentInnings >= 2) {
      const target = first.runs + 1;
      const remainingRuns = Math.max(0, target - second.runs);
      const ballsLeft = Math.max(0, 120 - second.balls);
      const wicketsInHand = Math.max(0, 10 - second.wickets);
      let chaseProbability = 0;

      if (remainingRuns === 0) {
        chaseProbability = 1;
      } else if (ballsLeft === 0 || wicketsInHand === 0) {
        chaseProbability = 0;
      } else {
        const requiredRate = remainingRuns / (ballsLeft / 6);
        const currentRate = second.overs ? second.runs / second.overs : 0;
        const baseChaseProbability = 1 - baseProbability;
        const logit =
          (baseChaseProbability - 0.5) * 3.2 +
          (8.4 - requiredRate) * 0.58 +
          (wicketsInHand - 5) * 0.18 +
          (currentRate - requiredRate) * 0.18;
        chaseProbability = clamp(logistic(logit), 0.02, 0.98);
      }

      return 1 - chaseProbability;
    }

    if (first && !second && match.currentInnings === 1) {
      const runRate = first.overs ? first.runs / first.overs : 0;
      const collapsePenalty = Math.max(0, first.wickets - 4) * 0.03;
      const projectedTotal =
        (match.projectedScore || runRate * 20 || first.runs) * (1 - collapsePenalty);
      return clamp(
        logistic((baseProbability - 0.5) * 2.8 + (projectedTotal - 178) / 32),
        0.08,
        0.92
      );
    }

    return baseProbability;
  }

  function simulatePlayoffs(topFourRows, ratingMap) {
    if (topFourRows.length < 4) {
      return topFourRows.length ? topFourRows[0].team : "";
    }
    const seed1 = topFourRows[0];
    const seed2 = topFourRows[1];
    const seed3 = topFourRows[2];
    const seed4 = topFourRows[3];
    const q1Winner = simulateKnockout(seed1.team, seed2.team, ratingMap);
    const q1Loser = q1Winner === seed1.team ? seed2.team : seed1.team;
    const eliminatorWinner = simulateKnockout(seed3.team, seed4.team, ratingMap);
    const q2Winner = simulateKnockout(q1Loser, eliminatorWinner, ratingMap);
    return simulateKnockout(q1Winner, q2Winner, ratingMap);
  }

  function simulateKnockout(teamA, teamB, ratingMap) {
    const probabilityTeamA = clamp(
      logistic(((ratingMap.get(teamA) || 0) - (ratingMap.get(teamB) || 0)) * 0.96),
      0.08,
      0.92
    );
    return Math.random() < probabilityTeamA ? teamA : teamB;
  }

  function loadJsonp(url, callbackName, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const cacheBustedUrl = url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
      const script = document.createElement("script");
      const previousCallback = window[callbackName];
      const timer = window.setTimeout(function () {
        cleanup();
        reject(new Error("Timed out while loading " + url));
      }, timeoutMs || 20000);

      function cleanup() {
        window.clearTimeout(timer);
        script.remove();
        if (previousCallback) {
          window[callbackName] = previousCallback;
        } else {
          delete window[callbackName];
        }
      }

      window[callbackName] = function (payload) {
        cleanup();
        resolve(payload);
      };

      script.src = cacheBustedUrl;
      script.async = true;
      script.onerror = function () {
        cleanup();
        reject(new Error("Failed to load " + url));
      };
      document.head.append(script);
    });
  }

  function pickCurrentCompetition(payload) {
    const competitions = Array.isArray(payload && payload.competition) ? payload.competition : [];
    const current = competitions
      .filter(function (competition) {
        return String(competition.CompetitionName || "").includes("IPL");
      })
      .sort(function (a, b) {
        return numberValue(b.SeasonID) - numberValue(a.SeasonID);
      });

    return (
      current.find(function (competition) {
        return numberValue(competition.live) === 1;
      }) ||
      current[0] ||
      {}
    );
  }

  function buildHistoricalTeamMap() {
    const historicalRows = layerState.sharedState && layerState.sharedState.data
      ? layerState.sharedState.data.teamStats
      : [];
    const teamMap = new Map();

    historicalRows.forEach(function (row) {
      if (!teamMap.has(row.team)) {
        teamMap.set(row.team, {
          matches: 0,
          wins: 0,
          runsScored: 0,
          ballsFaced: 0,
          runsConceded: 0,
          ballsBowled: 0,
        });
      }
      const team = teamMap.get(row.team);
      team.matches += row.matches;
      team.wins += row.wins;
      team.runsScored += row.runsScored;
      team.ballsFaced += row.ballsFaced;
      team.runsConceded += row.runsConceded;
      team.ballsBowled += row.ballsBowled;
    });

    teamMap.forEach(function (row, team) {
      const runRate = row.ballsFaced ? row.runsScored / (row.ballsFaced / 6) : 0;
      const bowlingEconomy = row.ballsBowled ? row.runsConceded / (row.ballsBowled / 6) : 0;
      row.winRate = row.matches ? (row.wins / row.matches) * 100 : 50;
      row.netRating = runRate - bowlingEconomy;
      teamMap.set(team, row);
    });

    return teamMap;
  }

  function getProfileLookup() {
    const lookup = new Map();
    const rows = layerState.sharedState && layerState.sharedState.data
      ? layerState.sharedState.data.playerStats
      : [];

    rows.forEach(function (player) {
      const key = playerNameKey(player.player);
      if (!lookup.has(key)) {
        lookup.set(key, {
          espnUrl: player.espnUrl || "",
          imageUrl: player.imageUrl || "",
        });
      }
    });
    return lookup;
  }

  function ensureLivePlayer(store, payload) {
    const key = payload.playerId
      ? "id:" + payload.playerId
      : "name:" + payload.teamId + ":" + playerNameKey(payload.player);
    if (!store.has(key)) {
      store.set(key, {
        teamId: payload.teamId || "",
        teamCode: payload.teamCode || "",
        team: payload.team || "",
        playerId: payload.playerId || "",
        clientPlayerId: payload.clientPlayerId || "",
        player: payload.player || "",
        imageUrl: payload.imageUrl || "",
        role: payload.role || "",
        battingStyle: payload.battingStyle || "",
        bowlingStyle: payload.bowlingStyle || "",
        matches: 0,
        runs: 0,
        balls: 0,
        dismissals: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        ballsBowled: 0,
        runsConceded: 0,
        dotBalls: 0,
        catches: 0,
        stumpings: 0,
        battingAverage: 0,
        strikeRate: 0,
        economy: 0,
        dotRate: 0,
      });
    }
    const player = store.get(key);
    if (!player.team && payload.team) player.team = payload.team;
    if (!player.teamId && payload.teamId) player.teamId = payload.teamId;
    if (!player.teamCode && payload.teamCode) player.teamCode = payload.teamCode;
    if (!player.player && payload.player) player.player = payload.player;
    if (!player.imageUrl && payload.imageUrl) player.imageUrl = payload.imageUrl;
    if (!player.role && payload.role) player.role = payload.role;
    if (!player.battingStyle && payload.battingStyle) player.battingStyle = payload.battingStyle;
    if (!player.bowlingStyle && payload.bowlingStyle) player.bowlingStyle = payload.bowlingStyle;
    if (!player.clientPlayerId && payload.clientPlayerId) player.clientPlayerId = payload.clientPlayerId;
    return player;
  }

  function zScoreMap(rows, field) {
    const values = rows.map(function (row) {
      return numberValue(row[field]);
    });
    const mean =
      values.reduce(function (sum, value) { return sum + value; }, 0) /
      Math.max(values.length, 1);
    const variance =
      values.reduce(function (sum, value) { return sum + (value - mean) * (value - mean); }, 0) /
      Math.max(values.length, 1);
    const deviation = Math.sqrt(variance) || 1;
    return new Map(
      rows.map(function (row) {
        return [row.team, (numberValue(row[field]) - mean) / deviation];
      })
    );
  }

  function parseInningsSummary(summary) {
    const match = String(summary || "").match(/(\d+)\/(\d+)\s*\(([\d.]+)\s*Ov/i);
    if (!match) {
      return null;
    }
    return {
      runs: numberValue(match[1]),
      wickets: numberValue(match[2]),
      overs: numberValue(match[3]),
      balls: oversStringToBalls(match[3]),
    };
  }

  function oversStringToBalls(value) {
    const parts = String(value || "0").split(".");
    return numberValue(parts[0]) * 6 + numberValue(parts[1]);
  }

  function parseMatchDateTime(dateTimeText, dateText, timeText) {
    if (dateTimeText) {
      return new Date(String(dateTimeText).replace(" ", "T")).getTime();
    }
    if (dateText) {
      return new Date(dateText + "T" + (timeText || "00:00") + ":00").getTime();
    }
    return Date.now();
  }

  function parseAverage(value, fallbackRuns, fallbackDismissals) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return fallbackDismissals ? fallbackRuns / fallbackDismissals : fallbackRuns;
  }

  function extractSeasonName(competitionName) {
    const match = String(competitionName || "").match(/(20\d{2})/);
    return match ? match[1] : "";
  }

  function canonicalTeam(name) {
    const aliases = {
      "Delhi Daredevils": "Delhi Capitals",
      "Kings XI Punjab": "Punjab Kings",
      "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
    };
    const cleaned = String(name || "").replace(/\s+/g, " ").trim();
    return aliases[cleaned] || cleaned;
  }

  function teamThemeSlug(teamName) {
    const map = {
      "Royal Challengers Bengaluru": "rcb",
      "Royal Challengers Bangalore": "rcb",
      "Mumbai Indians": "mi",
      "Chennai Super Kings": "csk",
      "Kolkata Knight Riders": "kkr",
      "Delhi Capitals": "dc",
      "Sunrisers Hyderabad": "srh",
      "Rajasthan Royals": "rr",
      "Punjab Kings": "pbks",
      "Gujarat Titans": "gt",
      "Lucknow Super Giants": "lsg",
    };
    const cleaned = String(teamName || "").replace(/\s+/g, " ").trim();
    return map[cleaned] || "default";
  }

  function rowHoverLogoStyle(logoUrl) {
    if (!logoUrl) {
      return "";
    }
    const safe = String(logoUrl).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return " style=\"--row-hover-logo: url('" + safe + "')\"";
  }

  function cardThemeAttrs(teamName, logoUrl) {
    return (
      ' data-team-theme="' +
      teamThemeSlug(teamName) +
      '"' +
      rowHoverLogoStyle(logoUrl)
    );
  }

  function cleanLivePlayerName(name) {
    return String(name || "")
      .replace(/\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function playerNameKey(name) {
    return cleanLivePlayerName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function stripHtml(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  function renderTopPlayerCard(label, player, statText) {
    if (!player) {
      return '<div class="top-player-card"><span>' + escapeHtml(label) + "</span><strong>No sample</strong></div>";
    }
    const media = player.imageUrl
      ? '<img src="' + escapeHtml(player.imageUrl) + '" alt="" loading="lazy">'
      : '<span>' + escapeHtml(initials(player.player)) + "</span>";
    return (
      '<div class="top-player-card entity-hover-card player-entity"' +
      cardThemeAttrs(player.team, player.imageUrl) +
      '><div class="entity-media">' +
      media +
      '</div><div class="entity-body"><span>' +
      escapeHtml(label) +
      "</span><strong>" +
      escapeHtml(player.player) +
      "</strong><p>" +
      escapeHtml(statText) +
      "</p></div></div>"
    );
  }

  function renderMatchCard(match) {
    const statusText =
      match.status === "Live"
        ? "Live"
        : (match.isTossCompleted && match.status === "UpComing")
          ? "Toss Done"
          : match.status === "Post"
            ? "Completed"
            : formatDateTime(match.startTime);
    let tossFormatted = match.tossText || "";
    if (tossFormatted && match.tossWinner && tossFormatted.trim().toLowerCase().startsWith("won ")) {
      tossFormatted = match.tossWinner + " " + tossFormatted.trim();
    } else if (!tossFormatted && match.tossWinner) {
      let d = "";
      if (match.tossDecision) {
        const lower = match.tossDecision.toLowerCase();
        if (lower.includes("bat")) d = "chose to bat";
        else if (lower.includes("field") || lower.includes("bowl")) d = "chose to bowl";
        else d = "chose to " + match.tossDecision;
      }
      tossFormatted = match.tossWinner + " won the toss" + (d ? " and " + d : "");
    }

    const scoreText =
      match.status === "Post" || match.status === "Live"
        ? (match.firstSummary || "-") + " | " + (match.secondSummary || "-")
        : (match.isTossCompleted && match.status === "UpComing")
          ? tossFormatted
          : match.venue;
    const detailText = match.isTossCompleted
      ? tossFormatted + (match.comments ? " | " + match.comments : "")
      : (match.comments || match.venue || "");

    return (
      '<article class="match-card"><div class="match-head"><strong>' +
      escapeHtml(match.matchName) +
      '</strong><span class="team-tag">' +
      escapeHtml(statusText) +
      "</span></div><p>" +
      escapeHtml(scoreText) +
      "</p><small>" +
      escapeHtml(detailText) +
      "</small></article>"
    );
  }

  function renderPlayerCell(player) {
    const avatar = player.imageUrl
      ? '<img class="avatar" src="' + player.imageUrl + '" alt="' + escapeHtml(player.player) + '">'
      : '<div class="avatar-fallback">' + escapeHtml(initials(player.player)) + "</div>";
    return (
      '<div class="player-cell">' +
      avatar +
      '<div class="player-meta"><strong>' +
      escapeHtml(player.player) +
      "</strong><small>" +
      escapeHtml(player.battingStyle || player.role) +
      "</small></div></div>"
    );
  }

  function logistic(value) {
    return 1 / (1 + Math.exp(-value));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatPercent(value) {
    return formatNumber(value, 1) + "%";
  }

  function formatNumber(value, digits) {
    return numberValue(value).toFixed(digits);
  }

  function formatSignedNumber(value, digits) {
    const number = numberValue(value);
    return (number >= 0 ? "+" : "") + number.toFixed(digits);
  }

  function formatOrdinalNumber(value) {
    const rounded = numberValue(value);
    const whole = Math.floor(rounded);
    const suffix =
      whole % 100 >= 11 && whole % 100 <= 13
        ? "th"
        : whole % 10 === 1
          ? "st"
          : whole % 10 === 2
            ? "nd"
            : whole % 10 === 3
              ? "rd"
              : "th";
    return rounded.toFixed(1) + suffix;
  }

  function formatOvers(balls) {
    const whole = Math.floor(balls / 6);
    return whole + "." + (balls % 6);
  }

  function formatDateTime(timestamp) {
    if (!timestamp || !Number.isFinite(timestamp)) {
      return "-";
    }
    return new Date(timestamp).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });
  }

  function ordinalWord(value) {
    return (
      {
        1: "first",
        2: "second",
        3: "third",
        4: "fourth",
        5: "fifth",
        6: "sixth",
        7: "seventh",
        8: "eighth",
        9: "ninth",
        10: "tenth",
      }[value] || value + "th"
    );
  }

  function initials(name) {
    return String(name || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) { return part[0]; })
      .join("")
      .toUpperCase();
  }

  function renderEmptyTable(table, headers, message) {
    if (!table) {
      return;
    }
    table.querySelector("thead").innerHTML =
      "<tr>" + headers.map(function (header) { return "<th>" + escapeHtml(header) + "</th>"; }).join("") + "</tr>";
    table.querySelector("tbody").innerHTML =
      '<tr><td colspan="' +
      headers.length +
      '"><p class="narrative">' +
      escapeHtml(message) +
      "</p></td></tr>";
  }

  function numberValue(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  window.IPLLiveLayer = {
    init: init,
    render: render,
  };
})();
