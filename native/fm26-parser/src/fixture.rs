use crate::club::ClubIndex;
use crate::contract::GameDate;
use memchr::memchr_iter;
use serde::Serialize;

const RECORD_BYTES: usize = 68;
const MARKER_BACK: usize = 12;
const MARKER_VALUE: u8 = 0x1c;
const FIRST_SENTINEL_OFFSET: usize = 4;
const SECOND_SENTINEL_OFFSET: usize = 11;
const HOME_TEAM_OFFSET: usize = 0;
const AWAY_TEAM_OFFSET: usize = 7;
const KICK_OFF_PACKED_OFFSET: usize = 13;
const KICK_OFF_YEAR_OFFSET: usize = 15;
const STAGE_ID_BACK: usize = 11;
const MATCH_RECORD_ID_OFFSET: usize = 32;
const PLAYED_OFFSET: usize = 55;
const TEAM_MIN: u32 = 1;
const TEAM_MAX: u32 = 2_999_999;
const YEARS_BEFORE: u16 = 7;
const YEARS_AFTER: u16 = 8;
const CLUSTER_GAP_BYTES: usize = 1_048_576;

#[derive(Debug, Clone)]
struct RawFixture {
    span_offset: usize,
    stage_id: Option<u32>,
    home_team_id: u32,
    away_team_id: u32,
    packed_kick_off: u16,
    kick_off_year: u16,
    match_record_id: Option<u32>,
    played: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureRow {
    pub id: String,
    pub date: String,
    pub opponent: String,
    pub opponent_club_uid: Option<u32>,
    pub competition: String,
    pub competition_known: bool,
    pub home: bool,
    pub opponent_strength: u8,
    pub opponent_strength_known: bool,
    pub table_impact: u8,
    pub table_impact_known: bool,
    pub knockout: bool,
    pub knockout_known: bool,
    pub rivalry: bool,
    pub rivalry_known: bool,
    pub rest_days_after: u16,
    pub home_team_id: u32,
    pub away_team_id: u32,
    pub stage_id: Option<u32>,
    pub match_record_id: Option<u32>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureStats {
    pub candidates: usize,
    pub strict_accepted: usize,
    pub clusters: usize,
    pub calendar_records: usize,
    pub managed_upcoming: usize,
}

pub fn managed_upcoming(
    span: &[u8],
    clubs: &ClubIndex,
    managed_club_uid: u32,
    clock: GameDate,
    limit: usize,
) -> (Vec<FixtureRow>, FixtureStats) {
    let (strict, mut stats) = scan_strict(span, clock);
    let (calendar, clusters) = largest_cluster(strict);
    stats.clusters = clusters;
    stats.calendar_records = calendar.len();

    let mut selected: Vec<(RawFixture, GameDate, u16, bool, Option<u32>, String)> = calendar
        .into_iter()
        .filter_map(|fixture| {
            if fixture.played {
                return None;
            }
            let date = fixture_date(&fixture)?;
            if date < clock {
                return None;
            }

            let home_club = clubs.resolve_team(fixture.home_team_id).map(|r| r.club_uid);
            let away_club = clubs.resolve_team(fixture.away_team_id).map(|r| r.club_uid);
            let home = home_club == Some(managed_club_uid);
            let away = away_club == Some(managed_club_uid);
            if !home && !away {
                return None;
            }

            let opponent_uid = if home { away_club } else { home_club };
            let opponent_team = if home {
                fixture.away_team_id
            } else {
                fixture.home_team_id
            };
            let opponent = opponent_uid
                .and_then(|uid| clubs.club(uid))
                .map(|club| club.name.clone())
                .unwrap_or_else(|| format!("Team {opponent_team}"));
            let slot = fixture.packed_kick_off >> 9;
            Some((fixture, date, slot, home, opponent_uid, opponent))
        })
        .collect();

    selected.sort_by_key(|(fixture, date, slot, _, _, _)| {
        (date.year, date.day_of_year, *slot, fixture.home_team_id, fixture.away_team_id)
    });
    selected.truncate(limit);
    stats.managed_upcoming = selected.len();

    let mut result = Vec::with_capacity(selected.len());
    for (index, (fixture, date, _slot, home, opponent_uid, opponent)) in
        selected.iter().enumerate()
    {
        let rest_days_after = selected
            .get(index + 1)
            .map(|(_, next, _, _, _, _)| {
                day_number(*next)
                    .saturating_sub(day_number(*date))
                    .min(u16::MAX as i64) as u16
            })
            .unwrap_or(7);

        result.push(FixtureRow {
            id: fixture
                .match_record_id
                .map(|id| format!("match-{id}"))
                .unwrap_or_else(|| {
                    format!(
                        "fixture-{}-{}-{}",
                        date_string(*date),
                        fixture.home_team_id,
                        fixture.away_team_id
                    )
                }),
            date: date_string(*date),
            opponent: opponent.clone(),
            opponent_club_uid: *opponent_uid,
            competition: fixture
                .stage_id
                .map(|id| format!("Stage {id}"))
                .unwrap_or_else(|| "Unknown Competition".to_owned()),
            competition_known: false,
            home: *home,
            opponent_strength: 50,
            opponent_strength_known: false,
            table_impact: 50,
            table_impact_known: false,
            knockout: false,
            knockout_known: false,
            rivalry: false,
            rivalry_known: false,
            rest_days_after,
            home_team_id: fixture.home_team_id,
            away_team_id: fixture.away_team_id,
            stage_id: fixture.stage_id,
            match_record_id: fixture.match_record_id,
        });
    }

    (result, stats)
}

fn scan_strict(span: &[u8], clock: GameDate) -> (Vec<RawFixture>, FixtureStats) {
    let mut fixtures = Vec::new();
    let mut stats = FixtureStats::default();
    let first_year = clock.year.saturating_sub(YEARS_BEFORE);
    let last_year = clock.year.saturating_add(YEARS_AFTER);

    for sentinel_at in memchr_iter(0xff, span) {
        if sentinel_at < FIRST_SENTINEL_OFFSET {
            continue;
        }
        let home_at = sentinel_at - FIRST_SENTINEL_OFFSET;
        if home_at < MARKER_BACK || home_at + RECORD_BYTES > span.len() {
            continue;
        }
        let marker_at = home_at - MARKER_BACK;
        if span[marker_at] != MARKER_VALUE
            || span.get(home_at + SECOND_SENTINEL_OFFSET).copied() != Some(0xff)
        {
            continue;
        }

        stats.candidates += 1;
        let Some(home_team_id) = read_u32(span, home_at + HOME_TEAM_OFFSET) else {
            continue;
        };
        let Some(away_team_id) = read_u32(span, home_at + AWAY_TEAM_OFFSET) else {
            continue;
        };
        if !(TEAM_MIN..=TEAM_MAX).contains(&home_team_id)
            || !(TEAM_MIN..=TEAM_MAX).contains(&away_team_id)
        {
            continue;
        }

        let Some(packed_kick_off) = read_u16(span, home_at + KICK_OFF_PACKED_OFFSET) else {
            continue;
        };
        let Some(kick_off_year) = read_u16(span, home_at + KICK_OFF_YEAR_OFFSET) else {
            continue;
        };
        if !(first_year..=last_year).contains(&kick_off_year) {
            continue;
        }
        let day = packed_kick_off & 0x01ff;
        if !(1..=366).contains(&day) {
            continue;
        }

        let stage_raw = read_u32(span, home_at - STAGE_ID_BACK).unwrap_or(u32::MAX);
        let match_record_raw =
            read_u32(span, home_at + MATCH_RECORD_ID_OFFSET).unwrap_or(u32::MAX);
        fixtures.push(RawFixture {
            span_offset: home_at,
            stage_id: (stage_raw != u32::MAX).then_some(stage_raw),
            home_team_id,
            away_team_id,
            packed_kick_off,
            kick_off_year,
            match_record_id: (match_record_raw != 0 && match_record_raw != u32::MAX)
                .then_some(match_record_raw),
            played: span[home_at + PLAYED_OFFSET] != 0,
        });
        stats.strict_accepted += 1;
    }

    fixtures.sort_by_key(|fixture| fixture.span_offset);
    (fixtures, stats)
}

fn largest_cluster(fixtures: Vec<RawFixture>) -> (Vec<RawFixture>, usize) {
    if fixtures.is_empty() {
        return (Vec::new(), 0);
    }

    let mut bounds = Vec::new();
    let mut start = 0usize;
    for index in 1..fixtures.len() {
        if fixtures[index]
            .span_offset
            .saturating_sub(fixtures[index - 1].span_offset)
            > CLUSTER_GAP_BYTES
        {
            bounds.push((start, index));
            start = index;
        }
    }
    bounds.push((start, fixtures.len()));

    let (best_start, best_end) = bounds
        .iter()
        .copied()
        .max_by_key(|(start, end)| end - start)
        .unwrap_or((0, 0));
    let clusters = bounds.len();
    (fixtures[best_start..best_end].to_vec(), clusters)
}

fn fixture_date(fixture: &RawFixture) -> Option<GameDate> {
    let day = fixture.packed_kick_off & 0x01ff;
    if !(1..=366).contains(&day) || !(1901..=2200).contains(&fixture.kick_off_year) {
        return None;
    }
    Some(GameDate {
        year: fixture.kick_off_year,
        day_of_year: day,
    })
}

fn day_number(date: GameDate) -> i64 {
    let y = date.year as i64 - 1;
    y * 365 + y / 4 - y / 100 + y / 400 + date.day_of_year as i64
}

fn date_string(date: GameDate) -> String {
    let leap = date.year % 400 == 0 || (date.year % 4 == 0 && date.year % 100 != 0);
    let month_days = [31u16, if leap { 29 } else { 28 }, 31,30,31,30,31,31,30,31,30,31];
    let mut day = date.day_of_year.max(1);
    let mut month = 1u8;
    for days in month_days {
        if day <= days {
            return format!("{:04}-{:02}-{:02}", date.year, month, day);
        }
        day -= days;
        month += 1;
    }
    format!("{:04}-12-31", date.year)
}

fn read_u16(buffer: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        buffer.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32(buffer: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        buffer.get(offset..offset + 4)?.try_into().ok()?,
    ))
}
