use crate::club::ClubIndex;

const SAUDI_ANCHOR_UNIQUE_IDS: [u32; 2] = [102_852, 102_862];

/// Return a nation label only when it can be inferred from stable club database Unique IDs
/// that are present in the current save. We intentionally do not hardcode the save-local
/// small nation id because it is a different id domain from public database Unique IDs.
pub fn inferred_name(nation_id: u32, clubs: &ClubIndex) -> Option<&'static str> {
    if inferred_saudi_nation_id(clubs) == Some(nation_id) {
        Some("Saudi Arabia")
    } else {
        None
    }
}

pub fn inferred_saudi_nation_id(clubs: &ClubIndex) -> Option<u32> {
    let anchors = clubs.clubs.iter()
        .filter(|club| club.unique_id.is_some_and(|id| SAUDI_ANCHOR_UNIQUE_IDS.contains(&id)))
        .collect::<Vec<_>>();

    if anchors.len() != SAUDI_ANCHOR_UNIQUE_IDS.len() {
        return None;
    }
    let first = anchors[0].nation_id;
    anchors.iter().all(|club| club.nation_id == first).then_some(first)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_ids_are_database_ids_not_small_nation_ids() {
        assert_ne!(SAUDI_ANCHOR_UNIQUE_IDS[0], 133);
        assert_ne!(SAUDI_ANCHOR_UNIQUE_IDS[1], 133);
    }
}
