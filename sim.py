from __future__ import annotations

"""
Monte Carlo simulator for IPL title odds and projected table order.

Examples
--------
Project the next season from the historical data in this repo:
    python sim.py --simulations 20000

Project a season from a custom schedule file:
    python sim.py --season 2026 --schedule-csv season_2026_schedule.csv

The optional schedule CSV must contain `team1` and `team2`. It may also include
`match_date`, `venue`, `match_number`/`id`, `winner`, and `result`. If winner or
result columns are filled in for already-played matches, the simulator will seed
the table with those observed outcomes before simulating the remaining fixtures.
"""

import argparse
import csv
import random
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional


LEAGUE_MATCHES_IN_MODERN_IPL = 70
BASE_ELO = 1500.0
FALLBACK_SCORE = 165.0
FALLBACK_SCORE_STDEV = 19.0
TEAM_ALIASES = {
    "Delhi Daredevils": "Delhi Capitals",
    "Kings XI Punjab": "Punjab Kings",
    "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
    "Kolkata Knight Respn_iders": "Kolkata Knight Riders",
    "Rising Pune Supergiants": "Rising Pune Supergiant",
}
NON_LEGAL_EXTRA_TYPES = {"wide", "wides", "no ball", "noball", "noballs"}


@dataclass(frozen=True)
class MatchRecord:
    match_id: int
    season: int
    match_date: date
    team1: str
    team2: str
    winner: Optional[str]
    result: str
    venue: str


@dataclass(frozen=True)
class ScheduledMatch:
    team1: str
    team2: str
    match_date: str = ""
    venue: str = ""
    match_id: Optional[int] = None
    winner: Optional[str] = None
    result: str = ""

    @property
    def is_observed(self) -> bool:
        return self.winner is not None or normalise_result(self.result) in {"tie", "no result"}


@dataclass(frozen=True)
class InningsStat:
    match_id: int
    innings_number: int
    season: int
    batting_team: str
    bowling_team: str
    runs: int
    overs: float


@dataclass
class TeamProfile:
    team: str
    elo: float
    batting_index: float
    bowling_index: float
    score_stdev: float


@dataclass
class ModelState:
    profiles: Dict[str, TeamProfile]
    league_average_score: float
    league_score_stdev: float


@dataclass
class TableRow:
    team: str
    points: int = 0
    wins: int = 0
    losses: int = 0
    no_results: int = 0
    runs_for: float = 0.0
    overs_for: float = 0.0
    runs_against: float = 0.0
    overs_against: float = 0.0

    @property
    def net_run_rate(self) -> float:
        scored = self.runs_for / self.overs_for if self.overs_for else 0.0
        conceded = self.runs_against / self.overs_against if self.overs_against else 0.0
        return scored - conceded


@dataclass(frozen=True)
class MatchOutcome:
    team1: str
    team2: str
    winner: str
    loser: str
    team1_runs: int
    team2_runs: int
    team1_overs: float = 20.0
    team2_overs: float = 20.0


@dataclass
class SimulationSummary:
    simulations: int
    projected_table: List[dict]
    most_likely_table_order: List[str]
    most_likely_table_order_probability: float
    latest_historical_season: int
    training_cutoff_season: int
    target_season: int
    teams: List[str]


def canonical_team(name: Optional[str]) -> Optional[str]:
    if name is None:
        return None
    cleaned = " ".join(str(name).strip().split())
    if not cleaned or cleaned.upper() == "NA":
        return None
    return TEAM_ALIASES.get(cleaned, cleaned)


def normalise_result(result: Optional[str]) -> str:
    if result is None:
        return ""
    cleaned = " ".join(str(result).strip().lower().split())
    return cleaned


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def safe_int(value: Optional[str], default: int = 0) -> int:
    if value is None:
        return default
    text = str(value).strip()
    if not text or text.upper() == "NA":
        return default
    return int(float(text))


def season_weight(season: int, latest_season: int) -> float:
    age = max(0, latest_season - season)
    return 0.88 ** age


def logistic_probability(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def load_match_history(path: Path) -> List[MatchRecord]:
    matches: List[MatchRecord] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            winner = canonical_team(row.get("winner"))
            matches.append(
                MatchRecord(
                    match_id=safe_int(row.get("match_number")),
                    season=parse_date(row["match_date"]).year,
                    match_date=parse_date(row["match_date"]),
                    team1=canonical_team(row["team1"]) or "",
                    team2=canonical_team(row["team2"]) or "",
                    winner=winner,
                    result=normalise_result(row.get("result")),
                    venue=row.get("venue", "").strip(),
                )
            )
    return sorted(matches, key=lambda match: (match.match_date, match.match_id))


def load_schedule_csv(path: Path) -> List[ScheduledMatch]:
    schedule: List[ScheduledMatch] = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = {"team1", "team2"} - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Schedule file is missing required columns: {sorted(missing)}")
        for row in reader:
            team1 = canonical_team(row.get("team1"))
            team2 = canonical_team(row.get("team2"))
            if team1 is None or team2 is None:
                continue
            schedule.append(
                ScheduledMatch(
                    team1=team1,
                    team2=team2,
                    match_date=row.get("match_date", "").strip(),
                    venue=row.get("venue", "").strip(),
                    match_id=safe_int(row.get("match_number") or row.get("id"), default=0) or None,
                    winner=canonical_team(row.get("winner")),
                    result=normalise_result(row.get("result")),
                )
            )
    return schedule


def build_template_schedule(matches: List[MatchRecord], season: int, include_results: bool) -> List[ScheduledMatch]:
    season_matches = [match for match in matches if match.season == season]
    if not season_matches:
        raise ValueError(f"No matches found for season {season}.")
    league_matches = season_matches[: min(LEAGUE_MATCHES_IN_MODERN_IPL, len(season_matches))]
    template: List[ScheduledMatch] = []
    for match in league_matches:
        template.append(
            ScheduledMatch(
                team1=match.team1,
                team2=match.team2,
                match_date=match.match_date.isoformat(),
                venue=match.venue,
                match_id=match.match_id if include_results else None,
                winner=match.winner if include_results else None,
                result=match.result if include_results else "",
            )
        )
    return template


def aggregate_innings(ball_by_ball_path: Path, match_lookup: Dict[int, MatchRecord]) -> Dict[int, List[InningsStat]]:
    accumulators: Dict[tuple, dict] = {}
    with ball_by_ball_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            match_id = safe_int(row.get("ID"))
            match = match_lookup.get(match_id)
            if match is None:
                continue
            batting_team = canonical_team(row.get("BattingTeam"))
            if batting_team is None:
                continue
            innings_number = safe_int(row.get("Innings"), default=1)
            key = (match_id, innings_number, batting_team)
            if key not in accumulators:
                if batting_team == match.team1:
                    bowling_team = match.team2
                elif batting_team == match.team2:
                    bowling_team = match.team1
                else:
                    continue
                accumulators[key] = {
                    "runs": 0,
                    "legal_balls": 0,
                    "season": match.season,
                    "bowling_team": bowling_team,
                }
            accumulators[key]["runs"] += safe_int(row.get("TotalRun"))
            extra_type = normalise_result(row.get("ExtraType"))
            if extra_type not in NON_LEGAL_EXTRA_TYPES:
                accumulators[key]["legal_balls"] += 1

    innings_by_match: Dict[int, List[InningsStat]] = defaultdict(list)
    for (match_id, innings_number, batting_team), values in accumulators.items():
        legal_balls = max(values["legal_balls"], 1)
        overs = legal_balls / 6.0
        innings_by_match[match_id].append(
            InningsStat(
                match_id=match_id,
                innings_number=innings_number,
                season=values["season"],
                batting_team=batting_team,
                bowling_team=values["bowling_team"],
                runs=values["runs"],
                overs=overs,
            )
        )

    for match_id in list(innings_by_match):
        innings_by_match[match_id] = sorted(
            innings_by_match[match_id],
            key=lambda innings: innings.innings_number,
        )
    return dict(innings_by_match)


def weighted_mean(values: Iterable[float], weights: Iterable[float]) -> float:
    total_weight = 0.0
    weighted_total = 0.0
    for value, weight in zip(values, weights):
        total_weight += weight
        weighted_total += value * weight
    if total_weight == 0:
        return 0.0
    return weighted_total / total_weight


def train_elo(
    matches: List[MatchRecord],
    active_teams: List[str],
    training_cutoff_season: int,
) -> Dict[str, float]:
    ratings = {team: BASE_ELO for team in active_teams}
    active_set = set(active_teams)
    for match in matches:
        if match.season > training_cutoff_season:
            continue
        if match.team1 not in active_set or match.team2 not in active_set:
            continue
        if match.result == "no result":
            continue

        if match.winner == match.team1:
            actual_team1 = 1.0
        elif match.winner == match.team2:
            actual_team1 = 0.0
        elif match.result == "tie":
            actual_team1 = 0.5
        else:
            continue

        expected_team1 = logistic_probability(ratings[match.team1], ratings[match.team2])
        k_factor = 24.0 * season_weight(match.season, training_cutoff_season)
        delta = k_factor * (actual_team1 - expected_team1)
        ratings[match.team1] += delta
        ratings[match.team2] -= delta

    for team in list(ratings):
        ratings[team] = BASE_ELO + 0.85 * (ratings[team] - BASE_ELO)
    return ratings


def build_model(
    matches: List[MatchRecord],
    innings_by_match: Dict[int, List[InningsStat]],
    active_teams: List[str],
    training_cutoff_season: int,
) -> ModelState:
    active_set = set(active_teams)
    batting_samples: Dict[str, List[tuple]] = defaultdict(list)
    bowling_samples: Dict[str, List[tuple]] = defaultdict(list)
    team_score_samples: Dict[str, List[int]] = defaultdict(list)
    all_scores: List[int] = []

    for match in matches:
        if match.season > training_cutoff_season:
            continue
        if match.team1 not in active_set or match.team2 not in active_set:
            continue
        for innings in innings_by_match.get(match.match_id, []):
            if innings.batting_team not in active_set or innings.bowling_team not in active_set:
                continue
            weight = season_weight(innings.season, training_cutoff_season)
            adjusted_score = innings.runs / innings.overs * 20.0
            batting_samples[innings.batting_team].append((adjusted_score, weight))
            bowling_samples[innings.bowling_team].append((adjusted_score, weight))
            team_score_samples[innings.batting_team].append(innings.runs)
            all_scores.append(innings.runs)

    league_average_score = statistics.mean(all_scores) if all_scores else FALLBACK_SCORE
    league_score_stdev = statistics.pstdev(all_scores) if len(all_scores) > 1 else FALLBACK_SCORE_STDEV
    league_score_stdev = max(10.0, league_score_stdev)
    ratings = train_elo(matches, active_teams, training_cutoff_season)

    profiles: Dict[str, TeamProfile] = {}
    for team in active_teams:
        batting = batting_samples.get(team, [])
        bowling = bowling_samples.get(team, [])
        batting_index = (
            weighted_mean((value for value, _ in batting), (weight for _, weight in batting))
            if batting
            else league_average_score
        )
        bowling_index = (
            weighted_mean((value for value, _ in bowling), (weight for _, weight in bowling))
            if bowling
            else league_average_score
        )
        team_scores = team_score_samples.get(team, [])
        score_stdev = statistics.pstdev(team_scores) if len(team_scores) > 1 else league_score_stdev
        score_stdev = max(10.0, score_stdev)
        profiles[team] = TeamProfile(
            team=team,
            elo=ratings.get(team, BASE_ELO),
            batting_index=batting_index,
            bowling_index=bowling_index,
            score_stdev=score_stdev,
        )

    return ModelState(
        profiles=profiles,
        league_average_score=league_average_score,
        league_score_stdev=league_score_stdev,
    )


def initialise_table(teams: List[str]) -> Dict[str, TableRow]:
    return {team: TableRow(team=team) for team in teams}


def add_match_scoring_to_table(
    table: Dict[str, TableRow],
    team1: str,
    team2: str,
    team1_runs: float,
    team2_runs: float,
    team1_overs: float = 20.0,
    team2_overs: float = 20.0,
) -> None:
    table[team1].runs_for += team1_runs
    table[team1].overs_for += team1_overs
    table[team1].runs_against += team2_runs
    table[team1].overs_against += team2_overs

    table[team2].runs_for += team2_runs
    table[team2].overs_for += team2_overs
    table[team2].runs_against += team1_runs
    table[team2].overs_against += team1_overs


def apply_observed_match(
    table: Dict[str, TableRow],
    match: ScheduledMatch,
    innings_by_match: Dict[int, List[InningsStat]],
) -> None:
    result = normalise_result(match.result)
    if result == "no result":
        table[match.team1].points += 1
        table[match.team2].points += 1
        table[match.team1].no_results += 1
        table[match.team2].no_results += 1
    elif match.winner == match.team1:
        table[match.team1].points += 2
        table[match.team1].wins += 1
        table[match.team2].losses += 1
    elif match.winner == match.team2:
        table[match.team2].points += 2
        table[match.team2].wins += 1
        table[match.team1].losses += 1
    elif result == "tie":
        table[match.team1].points += 1
        table[match.team2].points += 1
    else:
        return

    if match.match_id is None:
        return
    innings = innings_by_match.get(match.match_id, [])
    if len(innings) < 2:
        return
    score_by_team = {entry.batting_team: entry for entry in innings[:2]}
    if match.team1 in score_by_team and match.team2 in score_by_team:
        add_match_scoring_to_table(
            table=table,
            team1=match.team1,
            team2=match.team2,
            team1_runs=score_by_team[match.team1].runs,
            team2_runs=score_by_team[match.team2].runs,
            team1_overs=score_by_team[match.team1].overs,
            team2_overs=score_by_team[match.team2].overs,
        )


def expected_score(team: str, opponent: str, model: ModelState) -> float:
    profile = model.profiles[team]
    opponent_profile = model.profiles[opponent]
    batting_delta = profile.batting_index - model.league_average_score
    bowling_delta = opponent_profile.bowling_index - model.league_average_score
    elo_delta = profile.elo - opponent_profile.elo
    raw = (
        model.league_average_score
        + 0.60 * batting_delta
        - 0.45 * bowling_delta
        + 0.03 * elo_delta
    )
    return clamp(raw, 110.0, 240.0)


def simulate_match(team1: str, team2: str, model: ModelState, rng: random.Random) -> MatchOutcome:
    mu_team1 = expected_score(team1, team2, model)
    mu_team2 = expected_score(team2, team1, model)
    sigma = max(
        11.0,
        ((model.profiles[team1].score_stdev + model.profiles[team2].score_stdev) / 2.0) * 0.90,
    )

    team1_runs = int(round(clamp(rng.gauss(mu_team1, sigma), 80.0, 260.0)))
    team2_runs = int(round(clamp(rng.gauss(mu_team2, sigma), 80.0, 260.0)))

    if team1_runs == team2_runs:
        win_prob_team1 = logistic_probability(model.profiles[team1].elo, model.profiles[team2].elo)
        if rng.random() < win_prob_team1:
            team1_runs += 1
        else:
            team2_runs += 1

    winner = team1 if team1_runs > team2_runs else team2
    loser = team2 if winner == team1 else team1
    return MatchOutcome(
        team1=team1,
        team2=team2,
        winner=winner,
        loser=loser,
        team1_runs=team1_runs,
        team2_runs=team2_runs,
    )


def apply_simulated_match(table: Dict[str, TableRow], outcome: MatchOutcome) -> None:
    table[outcome.winner].points += 2
    table[outcome.winner].wins += 1
    table[outcome.loser].losses += 1
    add_match_scoring_to_table(
        table=table,
        team1=outcome.team1,
        team2=outcome.team2,
        team1_runs=outcome.team1_runs,
        team2_runs=outcome.team2_runs,
        team1_overs=outcome.team1_overs,
        team2_overs=outcome.team2_overs,
    )


def ranked_table(table: Dict[str, TableRow], model: ModelState) -> List[TableRow]:
    return sorted(
        table.values(),
        key=lambda row: (
            -row.points,
            -row.net_run_rate,
            -row.wins,
            -(row.runs_for - row.runs_against),
            -model.profiles[row.team].elo,
            row.team,
        ),
    )


def simulate_playoffs(qualifiers: List[TableRow], model: ModelState, rng: random.Random) -> str:
    if not qualifiers:
        raise ValueError("At least one team is required to simulate the playoffs.")
    if len(qualifiers) == 1:
        return qualifiers[0].team
    if len(qualifiers) < 4:
        final = simulate_match(qualifiers[0].team, qualifiers[1].team, model, rng)
        return final.winner

    qualifier_1 = simulate_match(qualifiers[0].team, qualifiers[1].team, model, rng)
    eliminator = simulate_match(qualifiers[2].team, qualifiers[3].team, model, rng)
    qualifier_2 = simulate_match(qualifier_1.loser, eliminator.winner, model, rng)
    final = simulate_match(qualifier_1.winner, qualifier_2.winner, model, rng)
    return final.winner


def run_monte_carlo(
    teams: List[str],
    schedule: List[ScheduledMatch],
    innings_by_match: Dict[int, List[InningsStat]],
    model: ModelState,
    simulations: int,
    seed: int,
    latest_historical_season: int,
    training_cutoff_season: int,
    target_season: int,
) -> SimulationSummary:
    observed_matches = [match for match in schedule if match.is_observed]
    pending_matches = [match for match in schedule if not match.is_observed]
    trackers = {
        team: {
            "title_wins": 0,
            "top4_finishes": 0,
            "league_first_finishes": 0,
            "points_total": 0.0,
            "rank_total": 0.0,
            "rank_counts": Counter(),
        }
        for team in teams
    }
    exact_order_counts: Counter = Counter()

    for simulation_index in range(simulations):
        rng = random.Random(seed + simulation_index)
        table = initialise_table(teams)
        for match in observed_matches:
            apply_observed_match(table, match, innings_by_match)
        for match in pending_matches:
            outcome = simulate_match(match.team1, match.team2, model, rng)
            apply_simulated_match(table, outcome)

        ranked = ranked_table(table, model)
        exact_order_counts[tuple(row.team for row in ranked)] += 1
        for position, row in enumerate(ranked, start=1):
            trackers[row.team]["points_total"] += row.points
            trackers[row.team]["rank_total"] += position
            trackers[row.team]["rank_counts"][position] += 1
            if position <= 4:
                trackers[row.team]["top4_finishes"] += 1
            if position == 1:
                trackers[row.team]["league_first_finishes"] += 1

        champion = simulate_playoffs(ranked[:4], model, rng)
        trackers[champion]["title_wins"] += 1

    projected_rows: List[dict] = []
    for team in teams:
        rank_counts = trackers[team]["rank_counts"]
        modal_rank = min(
            rank_counts,
            key=lambda rank: (-rank_counts[rank], rank),
        )
        projected_rows.append(
            {
                "team": team,
                "avg_points": trackers[team]["points_total"] / simulations,
                "avg_rank": trackers[team]["rank_total"] / simulations,
                "title_probability": trackers[team]["title_wins"] / simulations,
                "top4_probability": trackers[team]["top4_finishes"] / simulations,
                "league_first_probability": trackers[team]["league_first_finishes"] / simulations,
                "most_common_finish": modal_rank,
                "finish_distribution": {
                    rank: count / simulations
                    for rank, count in sorted(rank_counts.items())
                },
            }
        )

    projected_rows.sort(
        key=lambda row: (
            row["avg_rank"],
            -row["avg_points"],
            -row["title_probability"],
            row["team"],
        )
    )
    most_likely_order, order_count = exact_order_counts.most_common(1)[0]
    return SimulationSummary(
        simulations=simulations,
        projected_table=projected_rows,
        most_likely_table_order=list(most_likely_order),
        most_likely_table_order_probability=order_count / simulations,
        latest_historical_season=latest_historical_season,
        training_cutoff_season=training_cutoff_season,
        target_season=target_season,
        teams=teams,
    )


def print_summary(summary: SimulationSummary) -> None:
    print()
    print(
        f"Monte Carlo forecast for IPL {summary.target_season} "
        f"using {summary.simulations:,} simulations"
    )
    print(
        f"Historical data available through {summary.latest_historical_season}; "
        f"model trained through {summary.training_cutoff_season}."
    )
    print(
        "Projected table is ordered by average finish; "
        "tie-break estimates use simulated scoring rather than official live NRR."
    )
    print()
    print(
        f"{'Pos':>3}  {'Team':<30} {'Avg Pts':>7} {'Avg Rank':>8} "
        f"{'Top 4 %':>8} {'Title %':>8} {'1st %':>7} {'Mode':>5}"
    )
    print("-" * 85)
    for position, row in enumerate(summary.projected_table, start=1):
        print(
            f"{position:>3}  "
            f"{row['team']:<30} "
            f"{row['avg_points']:>7.2f} "
            f"{row['avg_rank']:>8.2f} "
            f"{row['top4_probability'] * 100:>7.1f}% "
            f"{row['title_probability'] * 100:>7.1f}% "
            f"{row['league_first_probability'] * 100:>6.1f}% "
            f"{row['most_common_finish']:>5}"
        )

    print()
    print("Most likely exact table order")
    print(
        f"  {' > '.join(summary.most_likely_table_order)} "
        f"({summary.most_likely_table_order_probability * 100:.2f}% of simulations)"
    )
    print()
    print("Suggested winner pick")
    best_team = max(summary.projected_table, key=lambda row: row["title_probability"])
    print(
        f"  {best_team['team']} "
        f"with title probability {best_team['title_probability'] * 100:.1f}%"
    )


def determine_default_teams(matches: List[MatchRecord], season: int) -> List[str]:
    teams = {
        match.team1
        for match in matches
        if match.season == season
    } | {
        match.team2
        for match in matches
        if match.season == season
    }
    return sorted(teams)


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Monte Carlo simulator for IPL winner odds and projected table order."
        )
    )
    parser.add_argument(
        "--matches",
        type=Path,
        default=Path("csv/Match_Info.csv"),
        help="Path to the historical match summary CSV.",
    )
    parser.add_argument(
        "--ball-by-ball",
        type=Path,
        default=Path("csv/Ball_By_Ball_Match_Data.csv"),
        help="Path to the historical ball-by-ball CSV.",
    )
    parser.add_argument(
        "--schedule-csv",
        type=Path,
        default=None,
        help=(
            "Optional schedule/results CSV for the target season. "
            "Required columns: team1, team2. Optional: match_date, venue, "
            "match_number/id, winner, result."
        ),
    )
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="Target season to project. Defaults to latest historical season + 1.",
    )
    parser.add_argument(
        "--train-through",
        type=int,
        default=None,
        help=(
            "Last season used for training. Defaults to min(latest historical season, target season - 1)."
        ),
    )
    parser.add_argument(
        "--simulations",
        type=int,
        default=20000,
        help="Number of Monte Carlo seasons to simulate.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=7,
        help="Random seed used to make the simulation reproducible.",
    )
    return parser


def main() -> None:
    parser = build_argument_parser()
    args = parser.parse_args()

    matches = load_match_history(args.matches)
    latest_historical_season = max(match.season for match in matches)
    target_season = args.season or (latest_historical_season + 1)
    training_cutoff = args.train_through
    if training_cutoff is None:
        training_cutoff = min(latest_historical_season, target_season - 1)
    if training_cutoff > latest_historical_season:
        raise ValueError(
            f"Training cutoff {training_cutoff} is after the latest available season {latest_historical_season}."
        )
    if args.simulations <= 0:
        raise ValueError("The number of simulations must be positive.")

    if args.schedule_csv is not None:
        schedule = load_schedule_csv(args.schedule_csv)
        teams = sorted({match.team1 for match in schedule} | {match.team2 for match in schedule})
    elif target_season <= latest_historical_season:
        schedule = build_template_schedule(matches, season=target_season, include_results=True)
        teams = determine_default_teams(matches, target_season)
    else:
        schedule = build_template_schedule(
            matches,
            season=latest_historical_season,
            include_results=False,
        )
        teams = determine_default_teams(matches, latest_historical_season)
    if not teams:
        raise ValueError("No teams were found in the chosen schedule.")
    if not schedule:
        raise ValueError("No matches were found in the chosen schedule.")

    match_lookup = {match.match_id: match for match in matches}
    innings_by_match = aggregate_innings(args.ball_by_ball, match_lookup)
    model = build_model(
        matches=matches,
        innings_by_match=innings_by_match,
        active_teams=teams,
        training_cutoff_season=training_cutoff,
    )
    summary = run_monte_carlo(
        teams=teams,
        schedule=schedule,
        innings_by_match=innings_by_match,
        model=model,
        simulations=args.simulations,
        seed=args.seed,
        latest_historical_season=latest_historical_season,
        training_cutoff_season=training_cutoff,
        target_season=target_season,
    )
    print_summary(summary)


if __name__ == "__main__":
    main()
