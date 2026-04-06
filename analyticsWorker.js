const INCLUDED_SEASONS = new Set([2023, 2024, 2025]);
const TEAM_ALIASES = {
  "Delhi Daredevils": "Delhi Capitals",
  "Kings XI Punjab": "Punjab Kings",
  "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
  "Kolkata Knight Respn_iders": "Kolkata Knight Riders",
  "Rising Pune Supergiants": "Rising Pune Supergiant",
};

const PLAYER_WICKET_EXCLUSIONS = new Set([
  "run out",
  "retired hurt",
  "retired out",
  "obstructing the field",
]);

const TEAM_URLS = {
  "Chennai Super Kings": "https://www.iplt20.com/teams/chennai-super-kings",
  "Delhi Capitals": "https://www.iplt20.com/teams/delhi-capitals",
  "Gujarat Titans": "https://www.iplt20.com/teams/gujarat-titans",
  "Kolkata Knight Riders": "https://www.iplt20.com/teams/kolkata-knight-riders",
  "Lucknow Super Giants": "https://www.iplt20.com/teams/lucknow-super-giants",
  "Mumbai Indians": "https://www.iplt20.com/teams/mumbai-indians",
  "Punjab Kings": "https://www.iplt20.com/teams/punjab-kings",
  "Rajasthan Royals": "https://www.iplt20.com/teams/rajasthan-royals",
  "Royal Challengers Bengaluru": "https://www.iplt20.com/teams/royal-challengers-bangalore",
  "Sunrisers Hyderabad": "https://www.iplt20.com/teams/sunrisers-hyderabad",
};

self.addEventListener("message", async () => {
  try {
    self.postMessage({ type: "status", message: "Loading match data..." });

    const [matchText, ballText, playerText] = await Promise.all([
      fetch("csv/Match_Info.csv").then((response) => response.text()),
      fetch("csv/Ball_By_Ball_Match_Data.csv").then((response) => response.text()),
      fetch("csv/2024_players_details.csv").then((response) => response.text()),
    ]);

    self.postMessage({ type: "status", message: "Building online player directory..." });
    const playerDirectory = buildPlayerDirectory(playerText);

    self.postMessage({ type: "status", message: "Filtering matches from 2023 to 2025..." });
    const matchState = buildMatchState(matchText);

    self.postMessage({ type: "status", message: "Crunching ball-by-ball player stats..." });
    const computed = buildPerformanceState(ballText, matchState, playerDirectory);

    self.postMessage({
      type: "ready",
      payload: {
        seasons: Array.from(INCLUDED_SEASONS).sort(),
        teams: Array.from(matchState.teams).sort(),
        seasonResults: computed.seasonResults,
        teamStats: computed.teamStats,
        playerStats: computed.playerStats,
        teamUrls: TEAM_URLS,
      },
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

function buildPlayerDirectory(csvText) {
  const directory = new Map();
  let headers = null;

  parseCsv(csvText, (row) => {
    if (!headers) {
      headers = row;
      return;
    }
    const record = objectFromRow(headers, row);
    const payload = {
      longName: record.longName || record.Name || "",
      shortName: record.Name || record.longName || "",
      imageUrl: record.imgUrl || "",
      espnUrl: record.espn_url || "",
      battingStyle: record.longBattingStyles || "",
      bowlingStyle: record.longBowlingStyles || "",
      playingRole: deriveRole(record),
    };

    [record.Name, record.longName, record.battingName, record.fieldingName].forEach((name) => {
      const key = playerKey(name);
      if (key && !directory.has(key)) {
        directory.set(key, payload);
      }
    });
  });

  return directory;
}

function deriveRole(record) {
  const batting = normalizeText(record.longBattingStyles);
  const bowling = normalizeText(record.longBowlingStyles);
  if (batting && bowling && bowling !== "na") {
    return "All-rounder";
  }
  if (bowling && bowling !== "na") {
    return "Bowler";
  }
  return "Batter";
}

function buildMatchState(csvText) {
  let headers = null;
  const matches = new Map();
  const teams = new Set();
  const teamSeasonSummaries = new Map();
  const seasonFinals = new Map();

  parseCsv(csvText, (row) => {
    if (!headers) {
      headers = row;
      return;
    }

    const record = objectFromRow(headers, row);
    const season = parseSeason(record.match_date);
    if (!INCLUDED_SEASONS.has(season)) {
      return;
    }

    const team1 = canonicalTeam(record.team1);
    const team2 = canonicalTeam(record.team2);
    const matchId = Number(record.match_number);
    const winner = canonicalTeam(record.winner);
    const result = normalizeText(record.result);
    const matchDate = record.match_date;

    matches.set(matchId, {
      matchId,
      season,
      team1,
      team2,
      winner,
      result,
      matchDate,
      venue: record.venue || "",
    });

    teams.add(team1);
    teams.add(team2);

    ensureTeamSeason(teamSeasonSummaries, season, team1);
    ensureTeamSeason(teamSeasonSummaries, season, team2);

    const team1Summary = teamSeasonSummaries.get(teamSeasonKey(season, team1));
    const team2Summary = teamSeasonSummaries.get(teamSeasonKey(season, team2));
    team1Summary.matches += 1;
    team2Summary.matches += 1;

    if (result === "no result") {
      team1Summary.noResults += 1;
      team2Summary.noResults += 1;
      team1Summary.points += 1;
      team2Summary.points += 1;
    } else if (winner === team1) {
      team1Summary.wins += 1;
      team2Summary.losses += 1;
      team1Summary.points += 2;
    } else if (winner === team2) {
      team2Summary.wins += 1;
      team1Summary.losses += 1;
      team2Summary.points += 2;
    } else {
      team1Summary.ties += 1;
      team2Summary.ties += 1;
      team1Summary.points += 1;
      team2Summary.points += 1;
    }

    registerLineup(teamSeasonSummaries, season, team1, matchId, record.team1_players);
    registerLineup(teamSeasonSummaries, season, team2, matchId, record.team2_players);

    const existingFinal = seasonFinals.get(season);
    if (!existingFinal || matchDate > existingFinal.matchDate) {
      seasonFinals.set(season, {
        season,
        matchDate,
        winner,
        finalist1: team1,
        finalist2: team2,
      });
    }
  });

  return { matches, teams, teamSeasonSummaries, seasonFinals };
}

function buildPerformanceState(ballText, matchState, playerDirectory) {
  const inningsTotals = new Map();
  const playerStats = new Map();

  let headers = null;
  parseCsv(ballText, (row, rowIndex) => {
    if (!headers) {
      headers = row;
      return;
    }
    if (rowIndex > 0 && rowIndex % 80000 === 0) {
      self.postMessage({
        type: "status",
        message: `Processing deliveries... ${rowIndex.toLocaleString()} rows read`,
      });
    }

    const record = objectFromRow(headers, row);
    const matchId = Number(record.ID);
    const match = matchState.matches.get(matchId);
    if (!match) {
      return;
    }

    const season = match.season;
    const battingTeam = canonicalTeam(record.BattingTeam);
    const bowlingTeam = battingTeam === match.team1 ? match.team2 : match.team1;
    const batter = normalizePlayerName(record.Batter);
    const nonStriker = normalizePlayerName(record.NonStriker);
    const bowler = normalizePlayerName(record.Bowler);
    const totalRun = numberValue(record.TotalRun);
    const batsmanRun = numberValue(record.BatsmanRun);
    const extraType = normalizeText(record.ExtraType);
    const isLegalForBowling = !isIllegalBall(extraType);
    const countsAsBatterBall = extraType !== "wide" && extraType !== "wides";
    const wicketsLost = numberValue(record.IsWicketDelivery);
    const kind = normalizeText(record.Kind);
    const playerOut = normalizePlayerName(record.PlayerOut);

    ensurePlayerStat(playerStats, season, battingTeam, batter, playerDirectory);
    ensurePlayerStat(playerStats, season, battingTeam, nonStriker, playerDirectory);
    ensurePlayerStat(playerStats, season, bowlingTeam, bowler, playerDirectory);

    const battingRecord = ensurePlayerStat(playerStats, season, battingTeam, batter, playerDirectory);
    const bowlingRecord = ensurePlayerStat(playerStats, season, bowlingTeam, bowler, playerDirectory);

    battingRecord.runs += batsmanRun;
    if (countsAsBatterBall) {
      battingRecord.balls += 1;
    }
    if (batsmanRun === 4) battingRecord.fours += 1;
    if (batsmanRun === 6) battingRecord.sixes += 1;
    battingRecord.matchIds.add(matchId);

    bowlingRecord.runsConceded += totalRun;
    if (isLegalForBowling) {
      bowlingRecord.ballsBowled += 1;
      if (totalRun === 0) {
        bowlingRecord.dotBalls += 1;
      }
    }
    bowlingRecord.matchIds.add(matchId);

    const inningsKey = `${matchId}|${record.Innings}|${battingTeam}`;
    let innings = inningsTotals.get(inningsKey);
    if (!innings) {
      innings = {
        season,
        battingTeam,
        bowlingTeam,
        runs: 0,
        wickets: 0,
        legalBalls: 0,
      };
      inningsTotals.set(inningsKey, innings);
    }

    innings.runs += totalRun;
    if (isLegalForBowling) {
      innings.legalBalls += 1;
    }
    if (wicketsLost && playerOut) {
      innings.wickets += 1;
    }

    if (wicketsLost && playerOut === batter) {
      battingRecord.dismissals += 1;
    }

    if (wicketsLost && playerOut && !PLAYER_WICKET_EXCLUSIONS.has(kind)) {
      bowlingRecord.wickets += 1;
    }

    if (record.FieldersInvolved && normalizeText(record.FieldersInvolved) !== "na") {
      splitFielders(record.FieldersInvolved).forEach((fielder) => {
        const fieldingRecord = ensurePlayerStat(playerStats, season, bowlingTeam, fielder, playerDirectory);
        fieldingRecord.fieldingDismissals += 1;
        fieldingRecord.matchIds.add(matchId);
      });
    }
  });

  matchState.teamSeasonSummaries.forEach((summary) => {
    summary.players.forEach((playerName) => {
      const playerRecord = ensurePlayerStat(playerStats, summary.season, summary.team, playerName, playerDirectory);
      const matchIds = summary.playerMatchMap[playerName] || new Set();
      matchIds.forEach((matchId) => playerRecord.matchIds.add(matchId));
    });
  });

  const teamStats = finalizeTeamStats(matchState.teamSeasonSummaries, inningsTotals);
  const playerRows = finalizePlayerStats(playerStats);
  const seasonResults = Array.from(matchState.seasonFinals.values()).sort((a, b) => a.season - b.season);
  return { teamStats, playerStats: playerRows, seasonResults };
}

function finalizeTeamStats(teamSeasonSummaries, inningsTotals) {
  inningsTotals.forEach((innings) => {
    const battingSummary = teamSeasonSummaries.get(teamSeasonKey(innings.season, innings.battingTeam));
    const bowlingSummary = teamSeasonSummaries.get(teamSeasonKey(innings.season, innings.bowlingTeam));

    if (battingSummary) {
      battingSummary.inningsBatted += 1;
      battingSummary.runsScored += innings.runs;
      battingSummary.ballsFaced += innings.legalBalls;
      battingSummary.wicketsLost += innings.wickets;
    }

    if (bowlingSummary) {
      bowlingSummary.inningsBowled += 1;
      bowlingSummary.runsConceded += innings.runs;
      bowlingSummary.ballsBowled += innings.legalBalls;
      bowlingSummary.wicketsTaken += innings.wickets;
    }
  });

  return Array.from(teamSeasonSummaries.values()).map((summary) => {
    const oversFaced = summary.ballsFaced / 6;
    const oversBowled = summary.ballsBowled / 6;
    return {
      ...summary,
      players: Array.from(summary.players).sort(),
      avgScore: summary.inningsBatted ? summary.runsScored / summary.inningsBatted : 0,
      runRate: oversFaced ? summary.runsScored / oversFaced : 0,
      battingStrikeRate: summary.ballsFaced ? (summary.runsScored / summary.ballsFaced) * 100 : 0,
      avgConceded: summary.inningsBowled ? summary.runsConceded / summary.inningsBowled : 0,
      bowlingEconomy: oversBowled ? summary.runsConceded / oversBowled : 0,
      wicketRate: summary.matches ? summary.wicketsTaken / summary.matches : 0,
      winRate: summary.matches ? (summary.wins / summary.matches) * 100 : 0,
    };
  });
}

function finalizePlayerStats(playerStats) {
  return Array.from(playerStats.values()).map((player) => {
    const oversBowled = player.ballsBowled / 6;
    return {
      ...player,
      matches: player.matchIds.size,
      battingAverage: player.dismissals ? player.runs / player.dismissals : player.runs,
      strikeRate: player.balls ? (player.runs / player.balls) * 100 : 0,
      economy: oversBowled ? player.runsConceded / oversBowled : 0,
      dotRate: player.ballsBowled ? (player.dotBalls / player.ballsBowled) * 100 : 0,
      oversBowled: oversBowled,
      impactScore:
        player.runs * 0.8 +
        player.wickets * 22 +
        player.fieldingDismissals * 6 +
        player.dotBalls * 0.35,
    };
  });
}

function registerLineup(teamSeasonSummaries, season, team, matchId, lineupText) {
  if (!lineupText) {
    return;
  }
  const summary = teamSeasonSummaries.get(teamSeasonKey(season, team));
  splitLineup(lineupText).forEach((player) => {
    if (!player) {
      return;
    }
    summary.players.add(player);
    summary.playerMatchMap[player] = summary.playerMatchMap[player] || new Set();
    summary.playerMatchMap[player].add(matchId);
  });
}

function ensureTeamSeason(store, season, team) {
  const key = teamSeasonKey(season, team);
  if (!store.has(key)) {
    store.set(key, {
      season,
      team,
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
      playerMatchMap: {},
    });
  }
}

function ensurePlayerStat(playerStats, season, team, playerName, playerDirectory) {
  if (!playerName) {
    return {
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
    };
  }
  const key = `${season}|${team}|${playerName}`;
  if (!playerStats.has(key)) {
    const profile = playerDirectory.get(playerKey(playerName)) || null;
    playerStats.set(key, {
      season,
      team,
      player: playerName,
      longName: profile?.longName || playerName,
      shortName: profile?.shortName || playerName,
      imageUrl: profile?.imageUrl || "",
      espnUrl: profile?.espnUrl || "",
      role: profile?.playingRole || "Player",
      battingStyle: profile?.battingStyle || "",
      bowlingStyle: profile?.bowlingStyle || "",
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
    });
  }
  return playerStats.get(key);
}

function teamSeasonKey(season, team) {
  return `${season}|${team}`;
}

function canonicalTeam(teamName) {
  const cleaned = normalizeText(teamName, false);
  if (!cleaned || cleaned.toUpperCase() === "NA") {
    return "";
  }
  return TEAM_ALIASES[cleaned] || cleaned;
}

function normalizeText(value, lowerCase = true) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return lowerCase ? text.toLowerCase() : text;
}

function parseSeason(matchDate) {
  return Number(String(matchDate || "").slice(0, 4));
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePlayerName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function playerKey(name) {
  return normalizePlayerName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isIllegalBall(extraType) {
  return extraType === "wide" || extraType === "wides" || extraType === "no ball" || extraType === "noball";
}

function splitLineup(value) {
  return String(value || "")
    .split(",")
    .map((part) => normalizePlayerName(part))
    .filter(Boolean);
}

function splitFielders(value) {
  return String(value || "")
    .split(",")
    .map((part) => normalizePlayerName(part))
    .filter(Boolean);
}

function objectFromRow(headers, row) {
  const record = {};
  headers.forEach((header, index) => {
    record[header] = row[index] ?? "";
  });
  return record;
}

function parseCsv(text, onRow) {
  let field = "";
  let row = [];
  let inQuotes = false;
  let rowIndex = 0;

  for (let i = 0; i <= text.length; i += 1) {
    const char = i === text.length ? "\n" : text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (!(row.length === 1 && row[0] === "")) {
        onRow(row, rowIndex);
        rowIndex += 1;
      }
      row = [];
      field = "";
    } else if (char === "\r") {
      continue;
    } else {
      field += char;
    }
  }
}
